"""Per-network hybrid sign-bytes v1/v2 (chain v3.1.98).

KAT vectors in ``fixtures/signbytes-kat-v3.1.98.json`` are generated from the
chain's own ``x/pqc`` / ``x/bridge`` functions and must reproduce byte-exact.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx
import pytest
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody

from qorsdk.accounts import derive_native_account
from qorsdk.errors import tx_error_from
from qorsdk.pqc import generate_pqc_keypair, pqc_verify
from qorsdk.sign_eth import sign_hybrid_eth
from qorsdk.signbytes import (
    HYBRID_SIGN_BYTES_DOMAIN,
    SignBytesResolver,
    SignBytesVersionError,
    bridge_attestation_sign_bytes,
    bridge_attestation_sign_bytes_v1,
    bridge_attestation_sign_bytes_v2,
    hybrid_sign_bytes,
    hybrid_sign_bytes_v1,
    hybrid_sign_bytes_v2,
    is_hybrid_signature_rejection,
    migration_sign_bytes,
    migration_sign_bytes_v1,
    migration_sign_bytes_v2,
    pick_build_sign_bytes_version,
    resolve_sign_bytes_version,
    sign_bytes_version_for,
)
from qorsdk.tx import build_hybrid_tx, hybrid_sign_and_broadcast
from qorsdk.unified import derive_unified_account

KAT = json.loads(
    (Path(__file__).parent / "fixtures" / "signbytes-kat-v3.1.98.json").read_text("utf-8")
)

# Public test mnemonic only — never a real one.
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
REST = "http://node.test:1317"
PLAN_URL = f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98"
TXS_URL = f"{REST}/cosmos/tx/v1beta1/txs"


# --------------------------------------------------------------------------- #
# KAT vectors (byte-exact against the chain)
# --------------------------------------------------------------------------- #
def test_kat_vector_counts():
    assert len(KAT["hybrid_v2"]) == 5
    assert len(KAT["migration_v2"]) == 3
    assert len(KAT["bridge_attestation_v2"]) == 3
    assert KAT["hybrid_domain"] == HYBRID_SIGN_BYTES_DOMAIN


@pytest.mark.parametrize("v", KAT["hybrid_v2"], ids=lambda v: v["name"])
def test_kat_hybrid_v2(v):
    b0 = bytes.fromhex(v["body_without_pqc_ext_hex"])
    a = bytes.fromhex(v["auth_info_hex"])
    want = bytes.fromhex(v["sign_bytes_hex"])
    assert hybrid_sign_bytes_v2(v["chain_id"], b0, a) == want
    assert hybrid_sign_bytes("v2", v["chain_id"], b0, a) == want


@pytest.mark.parametrize("v", KAT["migration_v2"], ids=lambda v: v["name"])
def test_kat_migration_v2(v):
    args = (
        v["chain_id"],
        v["account"],
        v["from_algorithm_id"],
        v["to_algorithm_id"],
        v["execution_height"],
        bytes.fromhex(v["old_public_key_hex"]),
        bytes.fromhex(v["new_public_key_hex"]),
    )
    want = bytes.fromhex(v["sign_bytes_hex"])
    assert migration_sign_bytes_v2(*args) == want
    assert migration_sign_bytes("v2", *args) == want


@pytest.mark.parametrize("v", KAT["bridge_attestation_v2"], ids=lambda v: v["name"])
def test_kat_bridge_attestation_v2(v):
    args = (
        v["chain_id"],
        v["chain"],
        v["event_type"],
        v["operation_id"],
        v["tx_hash"],
        v["amount"],
        v["asset"],
    )
    want = bytes.fromhex(v["sign_bytes_hex"])
    assert bridge_attestation_sign_bytes_v2(*args) == want
    assert bridge_attestation_sign_bytes("v2", *args) == want


# --------------------------------------------------------------------------- #
# v1 (legacy) layouts
# --------------------------------------------------------------------------- #
def test_hybrid_v1_layout():
    b0, a = b"\x0a\x01\x02", b"\xff" * 5
    want = b"\x00\x00\x00\x03" + b0 + b"\x00\x00\x00\x05" + a
    assert hybrid_sign_bytes_v1(b0, a) == want
    assert hybrid_sign_bytes("v1", "ignored-by-v1", b0, a) == want
    assert hybrid_sign_bytes_v1(b"", b"") == b"\x00" * 8


def test_hybrid_v2_is_domain_chain_then_v1_frame():
    b0, a = b"body", b"auth"
    v2 = hybrid_sign_bytes_v2("qorechain-vladi", b0, a)
    assert v2 == (
        b"qorechain-pqc-hybrid-v2"
        + (15).to_bytes(8, "big")
        + b"qorechain-vladi"
        + hybrid_sign_bytes_v1(b0, a)
    )


def test_migration_v1_legacy_string():
    got = migration_sign_bytes_v1("qorechain-vladi", "qor1account", 1, 3, 4200)
    assert got == (
        b"qorechain-key-migration:chain=qorechain-vladi:from=1:to=3"
        b":account=qor1account:height=4200"
    )
    assert migration_sign_bytes("v1", "qorechain-vladi", "qor1account", 1, 3, 4200) == got


def test_migration_v2_requires_public_keys():
    with pytest.raises(ValueError):
        migration_sign_bytes("v2", "qorechain-vladi", "qor1a", 1, 3, 1)


def test_bridge_v1_legacy_string_has_no_chain_id():
    got = bridge_attestation_sign_bytes_v1(
        "ethereum", "deposit", "op-0001", "0xabc123", "1000000", "uqor"
    )
    assert got == b"ethereum|deposit|op-0001|0xabc123|1000000|uqor"
    assert (
        bridge_attestation_sign_bytes(
            "v1", "qorechain-vladi", "ethereum", "deposit", "op-0001", "0xabc123", 1000000, "uqor"
        )
        == got
    )


def test_dispatchers_reject_unknown_version():
    with pytest.raises(ValueError):
        hybrid_sign_bytes("v3", "c", b"", b"")  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# version selection
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("chain_id", "height", "want"),
    [
        ("qorechain-vladi", 0, "v1"),
        ("qorechain-vladi", 5746000, "v2"),
        ("qorechain-diana", 0, "v1"),
        ("qorechain-diana", 5746000, "v2"),
        ("qorechain-other", 0, "v2"),
        ("qorechain-other", 5746000, "v2"),
    ],
)
def test_sign_bytes_version_for_truth_table(chain_id, height, want):
    assert sign_bytes_version_for(chain_id, height) == want


def test_pick_build_version():
    assert pick_build_sign_bytes_version("qorechain-vladi", "v1") == "v1"
    assert pick_build_sign_bytes_version("qorechain-diana", "v2") == "v2"
    assert pick_build_sign_bytes_version("new-chain", None) == "v2"
    assert pick_build_sign_bytes_version("new-chain", "auto") == "v2"
    with pytest.raises(SignBytesVersionError):
        pick_build_sign_bytes_version("qorechain-vladi", None)
    with pytest.raises(SignBytesVersionError):
        pick_build_sign_bytes_version("qorechain-diana", "auto")
    with pytest.raises(ValueError):
        pick_build_sign_bytes_version("new-chain", "v9")


# --------------------------------------------------------------------------- #
# resolver (fake HTTP)
# --------------------------------------------------------------------------- #
class _Plan:
    """A fake node answering applied_plan with a mutable body, counting calls."""

    def __init__(self, body=None, status=200):
        self.body = {"height": "5746000"} if body is None else body
        self.status = status
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == PLAN_URL
        self.calls += 1
        return httpx.Response(self.status, json=self.body)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


@pytest.mark.parametrize(
    ("body", "want"),
    [({"height": "5746000"}, "v2"), ({"height": "0"}, "v1"), ({}, "v1"), ({"height": 12}, "v2")],
)
def test_resolver_reads_applied_height(body, want):
    plan = _Plan(body)
    got = SignBytesResolver().resolve(
        "qorechain-vladi", rest_url=REST, client=plan.client()
    )
    assert got == want
    assert plan.calls == 1


def test_resolver_non_legacy_is_v2_without_http():
    plan = _Plan()
    assert SignBytesResolver().resolve("new-chain", rest_url=REST, client=plan.client()) == "v2"
    assert SignBytesResolver().resolve("new-chain") == "v2"
    assert plan.calls == 0


def test_resolver_explicit_version_no_http():
    plan = _Plan({"height": "5746000"})
    r = SignBytesResolver()
    assert r.resolve("qorechain-diana", sign_bytes_version="v1", client=plan.client()) == "v1"
    assert r.resolve("qorechain-vladi", sign_bytes_version="v2") == "v2"
    assert plan.calls == 0


def test_resolver_legacy_without_rest_url_errors():
    with pytest.raises(SignBytesVersionError, match="rest_url"):
        SignBytesResolver().resolve("qorechain-vladi")


@pytest.mark.parametrize("status", [500, 404])
def test_resolver_http_failure_errors(status):
    plan = _Plan({"message": "boom"}, status=status)
    with pytest.raises(SignBytesVersionError):
        SignBytesResolver().resolve("qorechain-diana", rest_url=REST, client=plan.client())


def test_resolver_transport_error_errors():
    def boom(request):
        raise httpx.ConnectError("unreachable", request=request)

    client = httpx.Client(transport=httpx.MockTransport(boom))
    with pytest.raises(SignBytesVersionError):
        SignBytesResolver().resolve("qorechain-diana", rest_url=REST, client=client)


def test_resolver_rejects_bad_option():
    with pytest.raises(ValueError):
        SignBytesResolver().resolve("qorechain-diana", rest_url=REST, sign_bytes_version="v3")


def test_resolver_cache_hit_within_ttl_and_expiry():
    now = [1000.0]
    plan = _Plan({"height": "0"})
    client = plan.client()
    r = SignBytesResolver(ttl=60, clock=lambda: now[0])
    assert r.resolve("qorechain-vladi", rest_url=REST, client=client) == "v1"
    plan.body = {"height": "777"}
    now[0] += 30
    # Within the TTL: cached answer, no second request (trailing slash is the same key).
    assert r.resolve("qorechain-vladi", rest_url=REST + "/", client=client) == "v1"
    assert plan.calls == 1
    now[0] += 31
    assert r.resolve("qorechain-vladi", rest_url=REST, client=client) == "v2"
    assert plan.calls == 2


def test_resolver_force_refresh_and_clear():
    plan = _Plan({"height": "0"})
    client = plan.client()
    r = SignBytesResolver()
    assert r.resolve("qorechain-vladi", rest_url=REST, client=client) == "v1"
    plan.body = {"height": "5"}
    assert r.resolve("qorechain-vladi", rest_url=REST, client=client, force_refresh=True) == "v2"
    assert plan.calls == 2
    r.clear()
    r.resolve("qorechain-vladi", rest_url=REST, client=client)
    assert plan.calls == 3
    r.invalidate(REST, "qorechain-vladi")
    r.resolve("qorechain-vladi", rest_url=REST, client=client)
    assert plan.calls == 4


def test_resolver_cache_is_per_chain_and_url():
    plan = _Plan({"height": "0"})
    client = plan.client()
    r = SignBytesResolver()
    r.resolve("qorechain-vladi", rest_url=REST, client=client)
    r.resolve("qorechain-diana", rest_url=REST, client=client)
    assert plan.calls == 2


def test_module_level_resolver_uses_default_cache():
    plan = _Plan({"height": "5746000"})
    client = plan.client()
    assert resolve_sign_bytes_version("qorechain-diana", rest_url=REST, client=client) == "v2"
    assert resolve_sign_bytes_version("qorechain-diana", rest_url=REST, client=client) == "v2"
    assert plan.calls == 1


async def test_resolver_async():
    plan = _Plan({"height": "0"})
    client = httpx.AsyncClient(transport=httpx.MockTransport(plan.handler))
    r = SignBytesResolver()
    assert await r.resolve_async("qorechain-vladi", rest_url=REST, client=client) == "v1"
    assert await r.resolve_async("qorechain-vladi", rest_url=REST, client=client) == "v1"
    assert plan.calls == 1
    assert await r.resolve_async("new-chain") == "v2"
    with pytest.raises(SignBytesVersionError):
        await r.resolve_async("qorechain-vladi")
    await client.aclose()


# --------------------------------------------------------------------------- #
# rejection detector
# --------------------------------------------------------------------------- #
def test_rejection_detector():
    msg = "hybrid PQC signature verification failed"
    assert is_hybrid_signature_rejection({"tx_response": {"code": 21, "codespace": "pqc"}})
    assert is_hybrid_signature_rejection({"code": 21, "codespace": "pqc"})
    assert is_hybrid_signature_rejection({"tx_response": {"code": 4, "raw_log": f"x: {msg}"}})
    assert is_hybrid_signature_rejection(tx_error_from(21, "pqc", "failed"))
    assert is_hybrid_signature_rejection(msg)
    # code 21 from another codespace (sdk 21 = tx too large) is NOT this case.
    assert not is_hybrid_signature_rejection({"tx_response": {"code": 21, "codespace": "sdk"}})
    assert not is_hybrid_signature_rejection(tx_error_from(21, "sdk", "too large"))
    assert not is_hybrid_signature_rejection({"tx_response": {"code": 0, "codespace": ""}})
    assert not is_hybrid_signature_rejection(None)
    req = httpx.Request("POST", TXS_URL)
    err = httpx.HTTPStatusError(
        "bad", request=req, response=httpx.Response(400, json={"code": 2, "message": msg})
    )
    assert is_hybrid_signature_rejection(err)


# --------------------------------------------------------------------------- #
# hybrid tx built with v2 verifies over v2, not v1
# --------------------------------------------------------------------------- #
def _send(native):
    from cosmpy.protos.cosmos.bank.v1beta1.tx_pb2 import MsgSend
    from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin

    addr = getattr(native, "address", None) or native.cosmos
    return {
        "type_url": "/cosmos.bank.v1beta1.MsgSend",
        "value": MsgSend(
            from_address=addr,
            to_address=addr,
            amount=[Coin(denom="uqor", amount="1")],
        ),
    }


def _b0_and_a(built):
    body = TxBody()
    body.ParseFromString(built.tx_raw.body_bytes)
    del body.extension_options[:]
    return body.SerializeToString(), built.auth_info_bytes


@pytest.fixture(scope="module")
def native():
    return derive_native_account(TEST_MNEMONIC)


@pytest.fixture(scope="module")
def pqc():
    return generate_pqc_keypair()


@pytest.mark.parametrize("chain_id", ["qorechain-diana", "qorechain-vladi"])
def test_v2_hybrid_tx_verifies_over_v2_only(native, pqc, chain_id):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_send(native)],
        fee=FEE,
        chain_id=chain_id,
        account_number=1,
        sequence=2,
        sign_bytes_version="v2",
    )
    assert built.sign_bytes_version == "v2"
    b0, a = _b0_and_a(built)
    v2 = hybrid_sign_bytes_v2(chain_id, b0, a)
    v1 = hybrid_sign_bytes_v1(b0, a)
    assert built.pqc_signed_message == v2
    assert pqc_verify(pqc.public_key, v2, built.pqc_signature)
    assert not pqc_verify(pqc.public_key, v1, built.pqc_signature)
    # Bound to the chain-id: does not verify as another network's v2 bytes.
    assert not pqc_verify(pqc.public_key, hybrid_sign_bytes_v2("other", b0, a), built.pqc_signature)


def test_v1_hybrid_tx_verifies_over_v1(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_send(native)],
        fee=FEE,
        chain_id="qorechain-vladi",
        account_number=1,
        sequence=2,
        sign_bytes_version="v1",
    )
    b0, a = _b0_and_a(built)
    assert built.sign_bytes_version == "v1"
    assert built.pqc_signed_message == hybrid_sign_bytes_v1(b0, a)
    assert pqc_verify(pqc.public_key, hybrid_sign_bytes_v1(b0, a), built.pqc_signature)
    assert not pqc_verify(
        pqc.public_key, hybrid_sign_bytes_v2("qorechain-vladi", b0, a), built.pqc_signature
    )


def test_build_hybrid_tx_legacy_chain_without_version_fails_loudly(native, pqc):
    with pytest.raises(SignBytesVersionError):
        build_hybrid_tx(
            account=native,
            pqc_keypair=pqc,
            messages=[_send(native)],
            fee=FEE,
            chain_id="qorechain-vladi",
            account_number=1,
            sequence=2,
        )


def test_build_hybrid_tx_new_chain_defaults_to_v2(native, pqc):
    built = build_hybrid_tx(
        account=native,
        pqc_keypair=pqc,
        messages=[_send(native)],
        fee=FEE,
        chain_id="qorechain-future-1",
        account_number=1,
        sequence=2,
    )
    b0, a = _b0_and_a(built)
    assert built.sign_bytes_version == "v2"
    assert built.pqc_signed_message == hybrid_sign_bytes_v2("qorechain-future-1", b0, a)


def test_sign_hybrid_eth_v2_and_legacy_guard():
    acct = derive_unified_account(TEST_MNEMONIC)
    msg = _send(acct)
    built = sign_hybrid_eth(
        acct, "qorechain-diana", 3, [msg], FEE, 4, sign_bytes_version="v2"
    )
    b0, a = _b0_and_a(built)
    assert built.sign_bytes_version == "v2"
    assert built.pqc_signed_message == hybrid_sign_bytes_v2("qorechain-diana", b0, a)
    assert pqc_verify(acct.pqc.public_key, built.pqc_signed_message, built.pqc_signature)
    assert not pqc_verify(acct.pqc.public_key, hybrid_sign_bytes_v1(b0, a), built.pqc_signature)
    with pytest.raises(SignBytesVersionError):
        sign_hybrid_eth(acct, "qorechain-diana", 3, [msg], FEE, 4)


# --------------------------------------------------------------------------- #
# retry once on pqc code 21 (fake transport)
# --------------------------------------------------------------------------- #
class _Node:
    """Fake node: applied_plan answers from ``heights`` in turn; txs from ``results``."""

    def __init__(self, heights, results):
        self.heights = list(heights)
        self.results = list(results)
        self.plan_calls = 0
        self.broadcasts: list[bytes] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/applied_plan/v3.1.98"):
            self.plan_calls += 1
            h = self.heights[min(self.plan_calls, len(self.heights)) - 1]
            return httpx.Response(200, json={"height": str(h)})
        assert str(request.url) == TXS_URL
        body = json.loads(request.content)
        self.broadcasts.append(base64.b64decode(body["tx_bytes"]))
        return httpx.Response(200, json={"tx_response": self.results.pop(0)})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


REFUSED_PQC = {
    "code": 21,
    "codespace": "pqc",
    "raw_log": "hybrid PQC signature verification failed",
}
OK = {"code": 0, "codespace": "", "txhash": "AB"}


def _builder(native, pqc, chain_id, seen):
    def build(version):
        seen.append(version)
        return build_hybrid_tx(
            account=native,
            pqc_keypair=pqc,
            messages=[_send(native)],
            fee=FEE,
            chain_id=chain_id,
            account_number=1,
            sequence=2,
            sign_bytes_version=version,
        )

    return build


def test_retry_on_pqc_21_re_resolves_and_succeeds(native, pqc):
    # Cached/stale answer says v1; the network has since upgraded to v2.
    node = _Node(heights=[0, 5746000], results=[REFUSED_PQC, OK])
    seen: list[str] = []
    resp = hybrid_sign_and_broadcast(
        _builder(native, pqc, "qorechain-diana", seen),
        chain_id="qorechain-diana",
        rest_url=REST,
        client=node.client(),
        resolver=SignBytesResolver(),
    )
    assert resp["tx_response"]["code"] == 0
    assert seen == ["v1", "v2"]
    assert node.plan_calls == 2  # initial resolve + forced refresh
    assert len(node.broadcasts) == 2
    assert node.broadcasts[0] != node.broadcasts[1]


def test_retry_happens_only_once(native, pqc):
    node = _Node(heights=[0, 0], results=[REFUSED_PQC, REFUSED_PQC])
    seen: list[str] = []
    resp = hybrid_sign_and_broadcast(
        _builder(native, pqc, "qorechain-vladi", seen),
        chain_id="qorechain-vladi",
        rest_url=REST,
        client=node.client(),
        resolver=SignBytesResolver(),
    )
    assert resp["tx_response"]["code"] == 21  # surfaced after the single retry
    assert len(node.broadcasts) == 2


def test_no_retry_when_version_explicit(native, pqc):
    node = _Node(heights=[5746000], results=[REFUSED_PQC, OK])
    seen: list[str] = []
    resp = hybrid_sign_and_broadcast(
        _builder(native, pqc, "qorechain-diana", seen),
        chain_id="qorechain-diana",
        rest_url=REST,
        sign_bytes_version="v1",
        client=node.client(),
        resolver=SignBytesResolver(),
    )
    assert resp["tx_response"]["code"] == 21
    assert seen == ["v1"]
    assert node.plan_calls == 0
    assert len(node.broadcasts) == 1


def test_no_retry_on_code_21_from_other_codespace(native, pqc):
    node = _Node(heights=[5746000], results=[{"code": 21, "codespace": "sdk"}, OK])
    seen: list[str] = []
    resp = hybrid_sign_and_broadcast(
        _builder(native, pqc, "qorechain-diana", seen),
        chain_id="qorechain-diana",
        rest_url=REST,
        client=node.client(),
        resolver=SignBytesResolver(),
    )
    assert resp["tx_response"]["codespace"] == "sdk"
    assert seen == ["v2"]
    assert len(node.broadcasts) == 1


def test_no_retry_on_success(native, pqc):
    node = _Node(heights=[5746000], results=[OK])
    seen: list[str] = []
    hybrid_sign_and_broadcast(
        _builder(native, pqc, "qorechain-diana", seen),
        chain_id="qorechain-diana",
        rest_url=REST,
        client=node.client(),
        resolver=SignBytesResolver(),
    )
    assert seen == ["v2"]
    assert node.plan_calls == 1
