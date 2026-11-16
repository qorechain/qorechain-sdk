"""Upgrade-dependent automatic choices read the protocol feature switches first.

Covers the shared classifier (:func:`qorsdk.protocol_features.lookup_protocol_feature`)
and the proof-of-possession decision for ``MsgRegisterPQCKeyV2``
(feature ``pqc-possession-flag``, fallback: the v3.2.3 upgrade plan). The
sign-bytes form (feature ``pqc-sign-bytes-v2``) is covered in test_signbytes.py.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from qorsdk import (
    PQC_POSSESSION_FEATURE,
    FeatureLookup,
    ProofOfPossessionDecisionError,
    ProofOfPossessionResolver,
    ProtocolFeatureQueryError,
    classify_protocol_feature_response,
    clear_pqc_status_cache,
    clear_upgrade_cache,
    decode_any,
    derive_native_account,
    ensure_pqc_registered,
    generate_pqc_keypair,
    lookup_protocol_feature,
    should_attach_proof_of_possession,
)

REST = "http://localhost:1317"
CHAIN_ID = "qorechain-diana"
FEATURES_URL = f"{REST}/qorechain/pqc/v1/protocol_features"
V323_URL = f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.3"
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
)
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
REGISTER_TYPE_URL = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"

POP_ON = {"name": PQC_POSSESSION_FEATURE, "enabled": True, "known": True, "staged": False}
POP_OFF = {"name": PQC_POSSESSION_FEATURE, "enabled": False, "known": True, "staged": False}
OTHER = {"name": "pqc-sign-bytes-v2", "enabled": True, "known": True, "staged": False}


def _features(*features: dict) -> httpx.Response:
    return httpx.Response(200, json={"features": list(features), "height": "120"})


def _connect_error(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("unreachable", request=request)


class _Node:
    """A fake node: a features answer, and the v3.2.3 plan at ``v323_height``."""

    def __init__(self, features_answer, v323_height: str = "0") -> None:
        self.features_answer = features_answer
        self.v323_height = v323_height
        self.feature_calls = 0
        self.plan_calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == FEATURES_URL:
            self.feature_calls += 1
            answer = self.features_answer
            return answer(request) if callable(answer) else answer
        assert url == V323_URL, url
        self.plan_calls += 1
        return httpx.Response(200, json={"height": self.v323_height})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def async_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))


@pytest.fixture(autouse=True)
def _fresh_upgrade_cache():
    clear_upgrade_cache()
    yield
    clear_upgrade_cache()


# --------------------------------------------------------------------------- #
# the shared classifier
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("answer", "state"),
    [
        (_features(OTHER, POP_ON), "enabled"),
        (_features(OTHER, POP_OFF), "disabled"),
        (_features(OTHER), "not_served"),
        (_features(), "not_served"),
        (httpx.Response(200, json={"height": "120"}), "not_served"),
        (httpx.Response(404, json={"code": 12, "message": "Not Implemented"}), "not_served"),
        (httpx.Response(501, json={"code": 12, "message": "Not Implemented"}), "not_served"),
        (httpx.Response(500, json={"code": 13}), "error"),
        (httpx.Response(503, text="unavailable"), "error"),
        (httpx.Response(429, text="slow down"), "error"),
        (httpx.Response(200, text="<html>"), "error"),
        (httpx.Response(200, json=["unexpected"]), "error"),
        (httpx.Response(200, json={"features": {"x": 1}}), "error"),
        (_connect_error, "error"),
    ],
    ids=[
        "enabled",
        "disabled",
        "absent",
        "empty-list",
        "no-list",
        "404",
        "501",
        "500",
        "503",
        "429",
        "not-json",
        "not-an-object",
        "features-not-a-list",
        "connection-error",
    ],
)
def test_lookup_classifies_every_answer(answer, state):
    node = _Node(answer)
    got = lookup_protocol_feature(node.client(), REST + "/", PQC_POSSESSION_FEATURE)
    assert got.state == state
    assert got.found is (state in ("enabled", "disabled"))
    assert got.enabled is (state == "enabled")
    if state in ("not_served", "error"):
        assert got.detail


def test_classifier_reads_the_body_only_for_http_200():
    def explode():
        raise AssertionError("body read for a non-200 answer")

    assert classify_protocol_feature_response(404, explode, "x") == FeatureLookup(
        "not_served", "HTTP 404"
    )
    assert classify_protocol_feature_response(502, explode, "x").state == "error"


def test_decision_error_is_a_protocol_feature_query_error():
    assert issubclass(ProofOfPossessionDecisionError, ProtocolFeatureQueryError)


# --------------------------------------------------------------------------- #
# proof of possession: the resolver
# --------------------------------------------------------------------------- #


def test_possession_feature_name_matches_the_chain():
    assert PQC_POSSESSION_FEATURE == "pqc-possession-flag"


def test_possession_enabled_attaches_without_an_applied_plan():
    node = _Node(_features(OTHER, POP_ON), v323_height="0")
    assert ProofOfPossessionResolver().resolve(CHAIN_ID, REST, client=node.client()) is True
    assert (node.feature_calls, node.plan_calls) == (1, 0)


def test_possession_disabled_does_not_attach_without_an_applied_plan():
    node = _Node(_features(OTHER, POP_OFF), v323_height="8003746")
    assert ProofOfPossessionResolver().resolve(CHAIN_ID, REST, client=node.client()) is False
    assert (node.feature_calls, node.plan_calls) == (1, 0)


@pytest.mark.parametrize(
    "answer",
    [
        _features(OTHER),
        _features(),
        httpx.Response(404, json={"code": 12, "message": "Not Implemented"}),
        httpx.Response(501, json={"code": 12, "message": "Not Implemented"}),
    ],
    ids=["absent", "empty-list", "404", "501"],
)
@pytest.mark.parametrize(("height", "want"), [("8003746", True), ("0", False)])
def test_possession_not_served_falls_back_to_the_v323_plan(answer, height, want):
    node = _Node(answer, v323_height=height)
    assert ProofOfPossessionResolver().resolve(CHAIN_ID, REST, client=node.client()) is want
    assert (node.feature_calls, node.plan_calls) == (1, 1)


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(500, json={"code": 13}),
        httpx.Response(429, text="slow down"),
        httpx.Response(200, text="<html>"),
        _connect_error,
    ],
    ids=["500", "429", "not-json", "connection-error"],
)
def test_possession_unreachable_raises_without_asking_the_plan(answer):
    node = _Node(answer, v323_height="8003746")
    r = ProofOfPossessionResolver()
    with pytest.raises(ProofOfPossessionDecisionError, match="attach_proof_of_possession"):
        r.resolve(CHAIN_ID, REST, client=node.client())
    assert node.plan_calls == 0
    # Errors are not cached: the next call asks again.
    node.features_answer = _features(POP_ON)
    assert r.resolve(CHAIN_ID, REST, client=node.client()) is True
    assert node.feature_calls == 2


def test_possession_cache_hit_within_ttl_and_expiry():
    now = [1000.0]
    node = _Node(_features(POP_OFF))
    r = ProofOfPossessionResolver(ttl=60, clock=lambda: now[0])
    assert r.resolve(CHAIN_ID, REST, client=node.client()) is False
    node.features_answer = _features(POP_ON)
    now[0] += 30
    # Within the TTL (trailing slash is the same key): no request.
    assert r.resolve(CHAIN_ID, REST + "/", client=node.client()) is False
    assert node.feature_calls == 1
    # Another chain id on the same node is its own entry.
    assert r.resolve("qorechain-vladi", REST, client=node.client()) is True
    assert node.feature_calls == 2
    now[0] += 31
    assert r.resolve(CHAIN_ID, REST, client=node.client()) is True
    assert node.feature_calls == 3


async def test_possession_async_enabled_and_fallback():
    node = _Node(_features(POP_ON))
    r = ProofOfPossessionResolver()
    assert await r.resolve_async(CHAIN_ID, REST, client=node.async_client()) is True
    assert node.plan_calls == 0
    old = _Node(httpx.Response(404, json={"code": 12}), v323_height="8003746")
    got = await ProofOfPossessionResolver().resolve_async(CHAIN_ID, REST, client=old.async_client())
    assert got is True
    assert old.plan_calls == 1


async def test_possession_async_unreachable_raises_without_asking_the_plan():
    node = _Node(httpx.Response(502, text="bad gateway"), v323_height="8003746")
    with pytest.raises(ProofOfPossessionDecisionError):
        await ProofOfPossessionResolver().resolve_async(CHAIN_ID, REST, client=node.async_client())
    assert node.plan_calls == 0


@respx.mock
def test_module_level_decision_uses_the_default_cache():
    route = respx.get(FEATURES_URL).mock(return_value=_features(POP_ON))
    assert should_attach_proof_of_possession(CHAIN_ID, REST) is True
    assert should_attach_proof_of_possession(CHAIN_ID, REST) is True
    assert route.call_count == 1


# --------------------------------------------------------------------------- #
# proof of possession: ensure_pqc_registered
# --------------------------------------------------------------------------- #


def _mock_unregistered() -> None:
    clear_pqc_status_cache()
    respx.get(url__regex=rf"{REST}/qorechain/pqc/v1/account/.*").mock(
        return_value=httpx.Response(200, json={"found": False, "account": None})
    )


def _mock_broadcast() -> respx.Route:
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"tx_response": {"code": 0, "txhash": "AB"}})
    )


def _registered_proof(route: respx.Route) -> bytes:
    body_json = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(body_json["tx_bytes"]))
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    (register,) = [
        decode_any(m.type_url, m.value) for m in body.messages if m.type_url == REGISTER_TYPE_URL
    ]
    return bytes(register.proof_of_possession)


def _ensure(**extra):
    return ensure_pqc_registered(
        account=derive_native_account(TEST_MNEMONIC),
        pqc_keypair=generate_pqc_keypair(),
        chain_id=CHAIN_ID,
        account_number=4,
        rest_url=REST,
        fee=FEE,
        sequence=2,
        **extra,
    )


@respx.mock
def test_ensure_attaches_the_proof_when_the_feature_is_on_even_at_plan_height_0():
    _mock_unregistered()
    respx.get(FEATURES_URL).mock(return_value=_features(OTHER, POP_ON))
    plan = respx.get(V323_URL).mock(return_value=httpx.Response(200, json={"height": "0"}))
    route = _mock_broadcast()
    _ensure()
    assert len(_registered_proof(route)) == 4627
    assert plan.call_count == 0


@respx.mock
def test_ensure_leaves_the_proof_off_when_the_feature_is_off():
    _mock_unregistered()
    respx.get(FEATURES_URL).mock(return_value=_features(POP_OFF))
    plan = respx.get(V323_URL).mock(return_value=httpx.Response(200, json={"height": "9"}))
    route = _mock_broadcast()
    _ensure()
    assert _registered_proof(route) == b""
    assert plan.call_count == 0


@respx.mock
def test_ensure_sends_nothing_when_the_features_cannot_be_asked():
    _mock_unregistered()
    respx.get(FEATURES_URL).mock(return_value=httpx.Response(500, text="boom"))
    plan = respx.get(V323_URL).mock(return_value=httpx.Response(200, json={"height": "0"}))
    route = _mock_broadcast()
    with pytest.raises(ProofOfPossessionDecisionError, match="could not be asked"):
        _ensure()
    assert plan.call_count == 0
    assert route.call_count == 0


@respx.mock
@pytest.mark.parametrize(("choice", "proof_len"), [(True, 4627), (False, 0)])
def test_ensure_explicit_choice_asks_no_feature(choice, proof_len):
    _mock_unregistered()
    features = respx.get(FEATURES_URL).mock(return_value=httpx.Response(500))
    plan = respx.get(V323_URL).mock(return_value=httpx.Response(500))
    route = _mock_broadcast()
    _ensure(attach_proof_of_possession=choice)
    assert len(_registered_proof(route)) == proof_len
    assert features.call_count == 0
    assert plan.call_count == 0


@respx.mock
def test_ensure_explicit_proof_is_attached_as_given():
    _mock_unregistered()
    features = respx.get(FEATURES_URL).mock(return_value=httpx.Response(500))
    route = _mock_broadcast()
    _ensure(proof_of_possession=b"\x01\x02")
    assert _registered_proof(route) == b"\x01\x02"
    assert features.call_count == 0


def test_ensure_refuses_a_proof_with_attach_false():
    with pytest.raises(ValueError, match="attach_proof_of_possession"):
        _ensure(proof_of_possession=b"\x01", attach_proof_of_possession=False)
