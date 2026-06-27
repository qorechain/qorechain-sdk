"""Tests for the unified cross-VM call helper.

Cross-VM calls are built, signed, and broadcast as ``MsgCrossVMCall``. The node
is mocked: broadcasting POSTs to the REST tx endpoint (respx), and the test
decodes the broadcast ``TxRaw`` back into messages to assert field values, payload
encoding (raw / cosmwasm-json / svm), and that an atomic call packs N messages
into ONE transaction.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from qorsdk import (
    VM_TYPES,
    CrossVmCallOptions,
    build_cross_vm_call,
    create_cross_vm_client,
    decode_any,
    derive_native_account,
    generate_pqc_keypair,
)

TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon "
    "abandon abandon abandon about"
)
CHAIN_ID = "qorechain-diana"
REST = "http://localhost:1317"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
TX_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCall"


def _client(**overrides):
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
    return create_cross_vm_client(**kwargs)  # type: ignore[arg-type]


def _mock_broadcast():
    return respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"tx_response": {"code": 0, "txhash": "ABC"}})
    )


def _decoded_messages(route) -> list:
    """Decode the broadcast tx into a list of MsgCrossVMCall proto messages."""
    body_json = json.loads(route.calls.last.request.read())
    tx_bytes = base64.b64decode(body_json["tx_bytes"])
    tx = TxRaw()
    tx.ParseFromString(tx_bytes)
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    msgs = []
    for any_msg in body.messages:
        assert any_msg.type_url == TX_TYPE_URL
        msgs.append(decode_any(any_msg.type_url, any_msg.value))
    return msgs


# --- VM_TYPES export ----------------------------------------------------------


def test_vm_types_exported():
    assert VM_TYPES == ("evm", "cosmwasm", "svm")


# --- build_call / build_cross_vm_call ----------------------------------------


def test_build_call_defaults_source_vm_evm_and_sets_fields():
    account = derive_native_account(TEST_MNEMONIC)
    m = build_cross_vm_call(
        sender=account.address,
        target_vm="cosmwasm",
        target_contract="qor1contract",
        payload=b"\x01\x02",
    )
    assert m.type_url == TX_TYPE_URL
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.sender == account.address
    assert decoded.source_vm == "evm"
    assert decoded.target_vm == "cosmwasm"
    assert decoded.target_contract == "qor1contract"
    assert decoded.payload == b"\x01\x02"


def test_build_call_cosmwasm_json_encoding():
    m = build_cross_vm_call(
        sender="qor1s",
        target_vm="cosmwasm",
        target_contract="qor1c",
        cosmwasm={"swap": {"amount": "100"}},
    )
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.payload == b'{"swap":{"amount":"100"}}'
    assert json.loads(decoded.payload) == {"swap": {"amount": "100"}}


def test_build_call_svm_raw_bytes():
    m = build_cross_vm_call(
        sender="qor1s", target_vm="svm", target_contract="prog", svm=b"\xaa\xbb"
    )
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.payload == b"\xaa\xbb"


def test_build_call_empty_payload_when_none_given():
    m = build_cross_vm_call(sender="qor1s", target_vm="evm", target_contract="0xabc")
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.payload == b""


def test_build_call_funds_attached():
    m = build_cross_vm_call(
        sender="qor1s",
        target_vm="evm",
        target_contract="0xabc",
        funds=[{"denom": "uqor", "amount": "250"}],
    )
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert len(decoded.funds) == 1
    assert decoded.funds[0].denom == "uqor"
    assert decoded.funds[0].amount == "250"


def test_build_call_rejects_unknown_vm():
    with pytest.raises(ValueError):
        build_cross_vm_call(sender="qor1s", target_vm="wasm", target_contract="x")  # type: ignore[arg-type]


def test_build_call_rejects_multiple_payload_sources():
    with pytest.raises(ValueError):
        build_cross_vm_call(
            sender="qor1s",
            target_vm="cosmwasm",
            target_contract="x",
            payload=b"\x01",
            cosmwasm={"a": 1},
        )


# --- call (build + sign + broadcast) -----------------------------------------


@respx.mock
def test_call_signs_and_broadcasts_single_message():
    route = _mock_broadcast()
    client = _client()
    result = client.call(
        target_vm="cosmwasm",
        target_contract="qor1c",
        cosmwasm={"execute": {}},
        funds=[{"denom": "uqor", "amount": "10"}],
    )
    assert result["tx_response"]["code"] == 0
    assert route.called
    msgs = _decoded_messages(route)
    assert len(msgs) == 1
    assert msgs[0].target_vm == "cosmwasm"
    assert msgs[0].payload == b'{"execute":{}}'
    assert msgs[0].sender == client.sender


@respx.mock
def test_call_uses_classical_single_signature():
    route = _mock_broadcast()
    client = _client()
    client.call(target_vm="evm", target_contract="0xabc", payload=b"\x00")
    body_json = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(body_json["tx_bytes"]))
    assert len(tx.signatures) == 1 and len(tx.signatures[0]) == 64
    # No PQC extension on a classical tx.
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    assert len(body.extension_options) == 0


@respx.mock
def test_call_hybrid_attaches_pqc_extension():
    route = _mock_broadcast()
    client = _client(pqc_keypair=generate_pqc_keypair())
    client.call(target_vm="evm", target_contract="0xabc", payload=b"\x00")
    body_json = json.loads(route.calls.last.request.read())
    tx = TxRaw()
    tx.ParseFromString(base64.b64decode(body_json["tx_bytes"]))
    body = TxBody()
    body.ParseFromString(tx.body_bytes)
    assert len(body.extension_options) == 1


# --- call_atomic (N messages, ONE tx) ----------------------------------------


@respx.mock
def test_call_atomic_packs_n_messages_into_one_tx():
    route = _mock_broadcast()
    client = _client()
    options = [
        CrossVmCallOptions(
            target_vm="cosmwasm", target_contract="qor1a", cosmwasm={"a": 1}
        ),
        CrossVmCallOptions(target_vm="svm", target_contract="prog", svm=b"\x09"),
        CrossVmCallOptions(target_vm="evm", target_contract="0xdef", payload=b"\x07"),
    ]
    client.call_atomic(options)
    # Exactly ONE broadcast POST...
    assert route.call_count == 1
    # ...carrying all three messages.
    msgs = _decoded_messages(route)
    assert len(msgs) == 3
    assert [m.target_vm for m in msgs] == ["cosmwasm", "svm", "evm"]
    assert msgs[0].payload == b'{"a":1}'
    assert msgs[1].payload == b"\x09"
    assert msgs[2].payload == b"\x07"
    assert all(m.sender == client.sender for m in msgs)


def test_call_atomic_rejects_empty():
    client = _client()
    with pytest.raises(ValueError):
        client.call_atomic([])


# --- get_message --------------------------------------------------------------


class _FakeQuery:
    def __init__(self):
        self.last_id = None

    def message(self, message_id):
        self.last_id = message_id
        return {"via": "query", "id": message_id}


class _FakeQor:
    def __init__(self):
        self.last_id = None

    def get_cross_vm_message(self, message_id):
        self.last_id = message_id
        return {"via": "qor", "id": message_id}


def test_get_message_prefers_query_client():
    query = _FakeQuery()
    client = _client(query=query, qor=_FakeQor())
    out = client.get_message("msg-1")
    assert out == {"via": "query", "id": "msg-1"}
    assert query.last_id == "msg-1"


def test_get_message_falls_back_to_qor():
    qor = _FakeQor()
    client = _client(qor=qor)
    out = client.get_message("msg-2")
    assert out == {"via": "qor", "id": "msg-2"}
    assert qor.last_id == "msg-2"


def test_get_message_without_clients_raises():
    client = _client()
    with pytest.raises(ValueError):
        client.get_message("msg-3")
