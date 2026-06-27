"""Tests for the quantum-safe DX helpers (``x/pqc`` key registry).

Status queries are mocked at the ``QorClient.get_pqc_key_status`` level (the
``qor_getPQCKeyStatus`` JSON-RPC method). Registration / migration are built,
signed, and broadcast as ``MsgRegisterPQCKey`` / ``MsgMigratePQCKey``; the node
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
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from qorsdk import (
    ALGORITHM_DILITHIUM5,
    build_register_pqc_key,
    decode_any,
    derive_native_account,
    ensure_pqc_registered,
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
REGISTER_TYPE_URL = "/qorechain.pqc.v1.MsgRegisterPQCKey"
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
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(
            200, json={"tx_response": {"code": 0, "txhash": "DEADBEEF"}}
        )
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


def test_get_pqc_status_handles_non_dict_result():
    assert get_pqc_status(_FakeQor(None), "qor1") == {"registered": False}


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
    assert decoded.dilithium_pubkey == keypair.public_key
    assert decoded.ecdsa_pubkey == account.public_key
    assert decoded.key_type == "dilithium5"


# --- ensure_pqc_registered (idempotent) --------------------------------------


def test_ensure_pqc_registered_already_registered_no_tx():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": True})
    with respx.mock:
        route = _mock_broadcast()
        result = ensure_pqc_registered(
            pqc_keypair=generate_pqc_keypair(), qor=qor, **kwargs
        )
    assert result == {"already_registered": True}
    assert route.called is False
    assert qor.calls == [account.address]


@respx.mock
def test_ensure_pqc_registered_missing_broadcasts_register_msg():
    account, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": False})
    keypair = generate_pqc_keypair()
    route = _mock_broadcast()
    result = ensure_pqc_registered(pqc_keypair=keypair, qor=qor, **kwargs)
    assert result["already_registered"] is False
    assert result["tx_hash"] == "DEADBEEF"
    assert route.call_count == 1
    msgs = _decoded_messages(route, REGISTER_TYPE_URL)
    assert len(msgs) == 1
    assert msgs[0].sender == account.address
    assert msgs[0].dilithium_pubkey == keypair.public_key
    assert msgs[0].ecdsa_pubkey == account.public_key
    assert msgs[0].key_type == "dilithium5"


@respx.mock
def test_ensure_pqc_registered_uses_classical_signature():
    _, kwargs = _ctx()
    qor = _FakeQor({"has_pqc_key": False})
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
