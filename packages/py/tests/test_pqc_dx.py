"""Tests for the PQC key helpers (``x/pqc`` key registry).

Status queries are mocked at the ``QorClient.get_pqc_key_status`` level (the
``qor_getPQCKeyStatus`` JSON-RPC method). Registration / migration are built,
signed, and broadcast as ``MsgRegisterPQCKeyV2`` / ``MsgMigratePQCKey``; the node
is mocked with respx and the broadcast ``TxRaw`` is decoded back into messages to
assert field values and that ``ensure_pqc_registered`` is idempotent.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import AuthInfo, TxBody, TxRaw

from qorsdk import (
    ALGORITHM_DILITHIUM5,
    QoreTxError,
    build_register_pqc_key,
    clear_pqc_status_cache,
    clear_upgrade_cache,
    decode_any,
    derive_native_account,
    ensure_pqc_registered,
    fetch_pqc_status,
    generate_pqc_keypair,
    get_pqc_status,
    is_pqc_registered,
    migrate_pqc_key,
    migrate_to_hybrid,
    msg,
)

TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)
CHAIN_ID = "qorechain-diana"
REST = "http://localhost:1317"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
REGISTER_TYPE_URL = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"
MIGRATE_TYPE_URL = "/qorechain.pqc.v1.MsgMigratePQCKey"


class _FakeQor:
    """Stand-in for QorClient.get_pqc_key_status returning a canned result."""

    def __init__(self, result):
        self._result = result
        self.calls: list[str] = []

    def get_pqc_key_status(self, address):
        self.calls.append(address)
        return self._result


def _mock_broadcast():
    # The hybrid path resolves the sign-bytes form ("auto") from the node first,
    # asking every upgrade name in turn. The testnet took the switch under the
    # earlier name only, so v3.2.0 answers 0 and v3.1.98 answers its height: v2.
    respx.get(f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0").mock(
        return_value=httpx.Response(200, json={"height": "0"})
    )
    respx.get(f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98").mock(
        return_value=httpx.Response(200, json={"height": "5746000"})
    )
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(
            200, json={"tx_response": {"code": 0, "txhash": "DEADBEEF"}}
        )
    )


def _mock_status(registered: bool, v323_height: str = "0"):
    """The REST status route ensure_pqc_registered reads (singular, ``found``),
    and the v3.2.3 plan it checks before attaching a proof of possession."""
    clear_pqc_status_cache()
    clear_upgrade_cache()
    respx.get(f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.3").mock(
        return_value=httpx.Response(200, json={"height": v323_height})
    )
    return respx.get(url__regex=rf"{REST}/qorechain/pqc/v1/account/.*").mock(
        return_value=httpx.Response(200, json={"found": registered, "account": None})
    )


def _decoded_messages(route, type_url) -> list:
    body_json = json.loads(route.calls.last.request.read())
    tx_bytes = base64.b64decode(body_json["tx_bytes"])
    tx = TxRaw()
    tx.ParseFromString(tx_bytes)
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    msgs = []
    for any_msg in body.messages:
        assert any_msg.type_url == type_url
        msgs.append(decode_any(any_msg.type_url, any_msg.value))
    return msgs


def _ctx(**overrides):
    account = derive_native_account(TEST_MNEMONIC)
    kwargs = dict(
        account=account,
        chain_id=CHAIN_ID,
        account_number=4,
        rest_url=REST,
        fee=FEE,
        sequence=2,
    )
    kwargs.update(overrides)
    return account, kwargs


# --- get_pqc_status / is_pqc_registered --------------------------------------


def test_get_pqc_status_registered():
    qor = _FakeQor(
        {
            "address": "qor1abc",
            "has_pqc_key": True,
            "key_type": "dilithium5",
            "created_at_height": 1234,
        }
    )
    status = get_pqc_status(qor, "qor1abc")
    assert status["registered"] is True
    assert status["key_type"] == "dilithium5"
    assert status["algorithm_id"] == ALGORITHM_DILITHIUM5
    assert status["created_at_height"] == 1234
    assert qor.calls == ["qor1abc"]


def test_get_pqc_status_not_registered():
    qor = _FakeQor({"address": "qor1abc", "has_pqc_key": False})
    status = get_pqc_status(qor, "qor1abc")
    assert status == {"registered": False}


def test_get_pqc_status_unknown_key_type_omits_algorithm_id():
    qor = _FakeQor(
        {"address": "qor1abc", "has_pqc_key": True, "key_type": "exotic-scheme"}
    )
    status = get_pqc_status(qor, "qor1abc")
    assert status["registered"] is True
    assert status["key_type"] == "exotic-scheme"
    assert "algorithm_id" not in status


def test_is_pqc_registered_true_and_false():
    assert is_pqc_registered(_FakeQor({"has_pqc_key": True}), "qor1") is True
    assert is_pqc_registered(_FakeQor({"has_pqc_key": False}), "qor1") is False


def test_get_pqc_status_refuses_an_unreadable_answer():
    # No answer is not "not registered": that reading re-registers known keys.
    with pytest.raises(ValueError, match="cannot tell"):
        get_pqc_status(_FakeQor(None), "qor1")


# --- build_register_pqc_key ---------------------------------------------------


def test_build_register_pqc_key_sets_fields():
    account = derive_native_account(TEST_MNEMONIC)
    keypair = generate_pqc_keypair()
    m = build_register_pqc_key(
        sender=account.address,
        dilithium_pubkey=keypair.public_key,
        ecdsa_pubkey=account.public_key,
    )
    assert m.type_url == REGISTER_TYPE_URL
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.sender == account.address
    assert decoded.public_key == keypair.public_key
    assert decoded.algorithm_id == 1  # ALGORITHM_DILITHIUM5 (ML-DSA-87)
    assert decoded.ecdsa_pubkey == account.public_key
    assert decoded.key_type == "hybrid"


# --- ensure_pqc_registered (idempotent) --------------------------------------


def test_ensure_pqc_registered_already_registered_no_tx():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": True})
    with respx.mock:
        status = _mock_status(True)
        route = _mock_broadcast()
        result = ensure_pqc_registered(
            pqc_keypair=generate_pqc_keypair(), qor=qor, **kwargs
        )
    # The status carries no key, so it could not be compared with ours.
    assert result == {"already_registered": True, "key_verified": False}
    assert route.called is False
    # The status comes from REST (public endpoints do not expose qor_*); the
    # keyless answer is read once more, uncached, before deciding.
    assert status.call_count == 2
    assert qor.calls == []


@respx.mock
def test_ensure_pqc_registered_missing_broadcasts_register_msg():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": False})
    _mock_status(False)
    keypair = generate_pqc_keypair()
    route = _mock_broadcast()
    result = ensure_pqc_registered(pqc_keypair=keypair, qor=qor, **kwargs)
    assert result["already_registered"] is False
    assert result["tx_hash"] == "DEADBEEF"
    assert route.call_count == 1
    msgs = _decoded_messages(route, REGISTER_TYPE_URL)
    assert len(msgs) == 1
    assert msgs[0].sender == account.address
    assert msgs[0].public_key == keypair.public_key
    assert msgs[0].algorithm_id == 1  # ALGORITHM_DILITHIUM5 (ML-DSA-87)
    assert msgs[0].ecdsa_pubkey == account.public_key
    assert msgs[0].key_type == "hybrid"


@respx.mock
def test_ensure_pqc_registered_uses_classical_signature():
    _, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": False})
    _mock_status(False)
    route = _mock_broadcast()
    ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), qor=qor, **kwargs)
    body_json = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(body_json["tx_bytes"]))
    # Registration tx is signed classically (single 64-byte secp256k1 sig)...
    assert len(tx.signatures) == 1 and len(tx.signatures[0]) == 64
    # ...and carries no PQC hybrid extension.
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    assert len(body.extension_options) == 0


# --- migrate_to_hybrid --------------------------------------------------------


@respx.mock
def test_migrate_to_hybrid_already_registered_sends_hybrid_only():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": True})
    _mock_status(True)
    route = _mock_broadcast()
    payment = msg.bank.send(
        from_address=account.address,
        to_address=account.address,
        amount=[Coin(denom="uqor", amount="1")],
    )
    result = migrate_to_hybrid(
        pqc_keypair=generate_pqc_keypair(), messages=[payment], qor=qor, **kwargs
    )
    assert result["tx_response"]["code"] == 0
    # Only the hybrid send tx is broadcast (already registered -> no register tx).
    assert route.call_count == 1
    body_json = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(body_json["tx_bytes"]))
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    # Hybrid tx carries the PQC extension.
    assert len(body.extension_options) == 1


@respx.mock
def test_migrate_to_hybrid_registers_then_sends_hybrid():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": False})
    _mock_status(False)
    route = _mock_broadcast()
    payment = msg.bank.send(
        from_address=account.address,
        to_address=account.address,
        amount=[Coin(denom="uqor", amount="1")],
    )
    migrate_to_hybrid(
        pqc_keypair=generate_pqc_keypair(),
        messages=[payment],
        qor=qor,
        register_sequence=2,
        **{**kwargs, "sequence": 3},
    )
    # Two broadcasts: register (classical) then send (hybrid).
    assert route.call_count == 2
    # The final broadcast is the hybrid send tx.
    last = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(last["tx_bytes"]))
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    assert len(body.extension_options) == 1


def _broadcast_sequences(route):
    """The signer sequence of every broadcast tx, in broadcast order."""
    out = []
    for call in route.calls:
        raw = TxRaw()
        raw.ParseFromString(base64.b64decode(json.loads(call.request.read())["tx_bytes"]))
        info = AuthInfo()
        info.ParseFromString(raw.auth_info_bytes)
        out.append(info.signer_infos[0].sequence)
    return out


@respx.mock
def test_migrate_to_hybrid_registering_advances_sequence_by_default():
    # with register_sequence=None the registration consumes
    # `sequence`, so the hybrid tx must go out at sequence + 1 - not reuse it.
    account, kwargs = _ctx(sequence=7)
    qor = _FakeQor({"has_pqc_key": False})
    _mock_status(False)
    route = _mock_broadcast()
    payment = msg.bank.send(
        from_address=account.address,
        to_address=account.address,
        amount=[Coin(denom="uqor", amount="1")],
    )
    migrate_to_hybrid(
        pqc_keypair=generate_pqc_keypair(), messages=[payment], qor=qor, **kwargs
    )
    assert route.call_count == 2
    assert _broadcast_sequences(route) == [7, 8]


@respx.mock
def test_migrate_to_hybrid_already_registered_keeps_sequence():
    account, kwargs = _ctx(sequence=7)
    qor = _FakeQor({"has_pqc_key": True})
    _mock_status(True)
    route = _mock_broadcast()
    payment = msg.bank.send(
        from_address=account.address,
        to_address=account.address,
        amount=[Coin(denom="uqor", amount="1")],
    )
    migrate_to_hybrid(
        pqc_keypair=generate_pqc_keypair(), messages=[payment], qor=qor, **kwargs
    )
    assert _broadcast_sequences(route) == [7]


@respx.mock
def test_migrate_to_hybrid_explicit_register_sequence_is_respected():
    account, kwargs = _ctx(sequence=3)
    qor = _FakeQor({"has_pqc_key": False})
    _mock_status(False)
    route = _mock_broadcast()
    payment = msg.bank.send(
        from_address=account.address,
        to_address=account.address,
        amount=[Coin(denom="uqor", amount="1")],
    )
    migrate_to_hybrid(
        pqc_keypair=generate_pqc_keypair(),
        messages=[payment],
        qor=qor,
        register_sequence=2,
        **kwargs,
    )
    assert _broadcast_sequences(route) == [2, 3]


def test_migrate_to_hybrid_rejects_empty_messages():
    _, kwargs = _ctx()
    with pytest.raises(ValueError):
        migrate_to_hybrid(
            pqc_keypair=generate_pqc_keypair(),
            messages=[],
            qor=_FakeQor({"has_pqc_key": True}),
            **kwargs,
        )


# --- migrate_pqc_key ----------------------------------------------------------


@respx.mock
def test_migrate_pqc_key_broadcasts_migrate_msg():
    account, kwargs = _ctx()
    route = _mock_broadcast()
    migrate_pqc_key(
        old_public_key=b"\x01\x02",
        new_public_key=b"\x03\x04",
        new_algorithm_id=ALGORITHM_DILITHIUM5,
        old_signature=b"\x05",
        new_signature=b"\x06",
        **kwargs,
    )
    assert route.call_count == 1
    msgs = _decoded_messages(route, MIGRATE_TYPE_URL)
    assert len(msgs) == 1
    assert msgs[0].sender == account.address
    assert msgs[0].old_public_key == b"\x01\x02"
    assert msgs[0].new_public_key == b"\x03\x04"
    assert msgs[0].new_algorithm_id == ALGORITHM_DILITHIUM5
    assert msgs[0].old_signature == b"\x05"
    assert msgs[0].new_signature == b"\x06"


# --- REST status (fetch_pqc_status) -------------------------------------------


@respx.mock
def test_fetch_pqc_status_reads_found_and_caches_a_positive_answer():
    clear_pqc_status_cache()
    route = respx.get(f"{REST}/qorechain/pqc/v1/account/qor1x").mock(
        return_value=httpx.Response(
            200, json={"found": True, "account": {"key_type": "hybrid", "public_key": "AA"}}
        )
    )
    assert fetch_pqc_status(REST, "qor1x")["registered"] is True
    assert fetch_pqc_status(REST + "/", "qor1x")["registered"] is True
    assert route.call_count == 1


@respx.mock
def test_fetch_pqc_status_found_false_is_not_registered():
    clear_pqc_status_cache()
    respx.get(f"{REST}/qorechain/pqc/v1/account/qor1y").mock(
        return_value=httpx.Response(200, json={"found": False, "account": None})
    )
    assert fetch_pqc_status(REST, "qor1y") == {"registered": False}


@respx.mock
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(501, json={"code": 12, "message": "Not Implemented"}),
        httpx.Response(200, json={"registered": False}),
    ],
)
def test_fetch_pqc_status_unclear_answer_is_unknown_not_false(response):
    clear_pqc_status_cache()
    route = respx.get(f"{REST}/qorechain/pqc/v1/account/qor1z").mock(return_value=response)
    with pytest.raises(RuntimeError, match="cannot tell"):
        fetch_pqc_status(REST, "qor1z")
    assert route.call_count == 2


@respx.mock
def test_ensure_never_registers_when_the_status_is_unknown():
    clear_pqc_status_cache()
    account, kwargs = _ctx()
    respx.get(url__regex=rf"{REST}/qorechain/pqc/v1/account/.*").mock(
        return_value=httpx.Response(503, text="unavailable")
    )
    route = _mock_broadcast()
    with pytest.raises(RuntimeError, match="cannot tell"):
        ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), **kwargs)
    assert route.call_count == 0


@respx.mock
def test_ensure_treats_already_registered_refusal_as_success():
    account, kwargs = _ctx()
    _mock_status(False)
    respx.get(f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0").mock(
        return_value=httpx.Response(200, json={"height": "0"})
    )
    respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(
            200,
            json={
                "tx_response": {
                    "code": 7,
                    "codespace": "pqc",
                    "raw_log": "PQC account already registered",
                    "txhash": "AB",
                }
            },
        )
    )
    res = ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), **kwargs)
    # The re-read carries no key: registered, but not verified as ours.
    assert res == {"already_registered": True, "key_verified": False}


def _mock_check_tx(tx_response: dict):
    _mock_status(False)
    respx.get(f"{REST}/cosmos/upgrade/v1beta1/applied_plan/v3.2.0").mock(
        return_value=httpx.Response(200, json={"height": "0"})
    )
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"tx_response": tx_response})
    )


@respx.mock
def test_ensure_raises_on_a_check_tx_refusal_that_is_not_already_registered():
    _, kwargs = _ctx()
    _mock_check_tx(
        {
            "code": 13,
            "codespace": "sdk",
            "raw_log": "insufficient fee",
            "txhash": "FEE13",
        }
    )
    with pytest.raises(QoreTxError) as info:
        ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), **kwargs)
    assert info.value.code == 13
    assert info.value.codespace == "sdk"
    assert info.value.kind == "insufficient_fee"
    assert info.value.raw_log == "insufficient fee"
    assert info.value.tx_hash == "FEE13"


@respx.mock
def test_ensure_returns_the_hash_on_check_tx_code_zero():
    _, kwargs = _ctx()
    _mock_check_tx({"code": 0, "txhash": "OK0"})
    res = ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), **kwargs)
    assert res == {"already_registered": False, "tx_hash": "OK0"}


@respx.mock
def test_migrate_to_hybrid_stops_when_the_registration_is_refused():
    _, kwargs = _ctx()
    route = _mock_check_tx({"code": 13, "codespace": "sdk", "raw_log": "insufficient fee"})
    with pytest.raises(QoreTxError):
        migrate_to_hybrid(
            pqc_keypair=generate_pqc_keypair(),
            messages=[
                msg.bank.send(
                    from_address=kwargs["account"].address,
                    to_address=kwargs["account"].address,
                    amount=[Coin(denom="uqor", amount="1")],
                )
            ],
            qor=None,
            **kwargs,
        )
    # The hybrid messages tx is not sent after a refused registration.
    assert route.call_count == 1


# --- proof of possession at registration (chain v3.2.3) -----------------------


def _registered_pop(v323_height: str) -> bytes:
    account, kwargs = _ctx()
    _mock_status(False, v323_height)
    route = _mock_broadcast()
    ensure_pqc_registered(pqc_keypair=generate_pqc_keypair(), **kwargs)
    (register,) = _decoded_messages(route, REGISTER_TYPE_URL)
    return bytes(register.proof_of_possession)


@respx.mock
def test_ensure_attaches_proof_of_possession_once_v323_is_applied():
    assert len(_registered_pop("8003746")) == 4627


@respx.mock
def test_ensure_leaves_proof_of_possession_off_before_v323():
    assert _registered_pop("0") == b""
