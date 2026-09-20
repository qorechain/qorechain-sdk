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
from cosmpy.protos.cosmos.base.abci.v1beta1.abci_pb2 import TxMsgData
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from qorsdk import (
    CROSS_VM_CALL_RESPONSE_TYPE_URL,
    VM_TYPES,
    CrossVmCallOptions,
    CrossVmCallResult,
    build_cross_vm_call,
    create_cross_vm_client,
    decode_any,
    decode_cross_vm_response,
    decode_cross_vm_responses,
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


# --- async (v3.1.97 field 7) --------------------------------------------------


def test_build_call_defaults_to_synchronous_execution():
    m = build_cross_vm_call(sender="qor1s", target_vm="evm", target_contract="0xabc")
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    # `async` is a Python keyword: the generated class exposes it via getattr.
    assert getattr(decoded, "async") is False


def test_build_call_async_round_trips_through_the_wire():
    m = build_cross_vm_call(
        sender="qor1s", target_vm="evm", target_contract="0xabc", async_=True
    )
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert getattr(decoded, "async") is True


@respx.mock
def test_call_async_reaches_the_broadcast_message():
    route = _mock_broadcast()
    client = _client()
    client.call(target_vm="svm", target_contract="prog", svm=b"\x01", async_=True)
    msgs = _decoded_messages(route)
    assert getattr(msgs[0], "async") is True


@respx.mock
def test_call_atomic_carries_per_call_async_flags():
    route = _mock_broadcast()
    client = _client()
    client.call_atomic(
        [
            CrossVmCallOptions(target_vm="evm", target_contract="0xa", payload=b"\x01"),
            CrossVmCallOptions(
                target_vm="evm", target_contract="0xb", payload=b"\x02", async_=True
            ),
        ]
    )
    msgs = _decoded_messages(route)
    assert [getattr(m, "async") for m in msgs] == [False, True]


def test_source_vm_still_accepted_though_the_chain_ignores_it():
    """The chain derives the origin lane itself; the field is kept for old nodes."""
    m = build_cross_vm_call(
        sender="qor1s", target_vm="evm", target_contract="0xabc", source_vm="svm"
    )
    decoded = decode_any(m.type_url, m.value.SerializeToString())
    assert decoded.source_vm == "svm"


# --- response decoding (message_id / executed / data / gas_used) --------------


def _tx_result(*responses) -> dict:
    """A REST broadcast body whose tx_response.data packs the given responses."""
    tx_msg_data = TxMsgData()
    for r in responses:
        tx_msg_data.msg_responses.add(
            type_url=CROSS_VM_CALL_RESPONSE_TYPE_URL, value=r.SerializeToString()
        )
    return {
        "tx_response": {
            "code": 0,
            "txhash": "ABC",
            "data": tx_msg_data.SerializeToString().hex(),
        }
    }


def _response(**fields):
    from qorsdk.proto.qorechain.crossvm.v1.tx_pb2 import MsgCrossVMCallResponse

    return MsgCrossVMCallResponse(**fields)


def test_decode_cross_vm_response_surfaces_all_four_fields():
    result = decode_cross_vm_response(
        _tx_result(
            _response(
                message_id="xvm-1", executed=True, data=b"\xde\xad", gas_used=21_000
            )
        )
    )
    assert result == CrossVmCallResult(
        message_id="xvm-1", executed=True, data=b"\xde\xad", gas_used=21_000
    )


def test_decode_queued_call_reports_not_executed():
    result = decode_cross_vm_response(_tx_result(_response(message_id="xvm-2")))
    assert result is not None
    assert result.message_id == "xvm-2"
    assert result.executed is False
    assert result.data == b""
    assert result.gas_used == 0


def test_decode_cross_vm_responses_keeps_message_order():
    results = decode_cross_vm_responses(
        _tx_result(
            _response(message_id="a", executed=True, data=b"\x01", gas_used=1),
            _response(message_id="b", executed=True, data=b"\x02", gas_used=2),
        )
    )
    assert [r.message_id for r in results] == ["a", "b"]
    assert [r.data for r in results] == [b"\x01", b"\x02"]
    assert [r.gas_used for r in results] == [1, 2]


def test_decode_skips_responses_from_other_messages():
    tx_msg_data = TxMsgData()
    tx_msg_data.msg_responses.add(
        type_url="/cosmos.bank.v1beta1.MsgSendResponse", value=b""
    )
    tx_msg_data.msg_responses.add(
        type_url=CROSS_VM_CALL_RESPONSE_TYPE_URL,
        value=_response(message_id="only-me", executed=True).SerializeToString(),
    )
    body = {"tx_response": {"data": tx_msg_data.SerializeToString().hex()}}
    results = decode_cross_vm_responses(body)
    assert [r.message_id for r in results] == ["only-me"]


def test_decode_accepts_a_bare_tx_response_dict():
    body = _tx_result(_response(message_id="bare", executed=True))["tx_response"]
    assert decode_cross_vm_responses(body)[0].message_id == "bare"


def test_decode_of_a_sync_broadcast_without_data_is_empty():
    # A sync broadcast has not executed yet — nothing to decode, and no raise.
    assert decode_cross_vm_responses({"tx_response": {"code": 0, "txhash": "ABC"}}) == []
    assert decode_cross_vm_response(None) is None


@respx.mock
def test_call_result_decodes_end_to_end():
    responses = _tx_result(
        _response(message_id="xvm-9", executed=True, data=b"ok", gas_used=5)
    )
    respx.post(f"{REST}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json=responses)
    )
    client = _client()
    result = client.call(target_vm="evm", target_contract="0xabc", payload=b"\x00")
    decoded = decode_cross_vm_response(result)
    assert decoded is not None
    assert (decoded.message_id, decoded.executed, decoded.data, decoded.gas_used) == (
        "xvm-9",
        True,
        b"ok",
        5,
    )


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
