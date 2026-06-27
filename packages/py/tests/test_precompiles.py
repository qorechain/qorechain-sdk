"""Tests for the AI pre-flight EVM precompile bindings.

The precompiles are reached via ``eth_call`` / ``eth_estimateGas`` on the
EVM JSON-RPC client, so the node is mocked with ``respx``: each route returns an
ABI-encoded result (two 32-byte words) and the test asserts both the calldata the
SDK sent (selector + ABI layout) and the decoded return shape.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from qorsdk import (
    PRECOMPILE_AI_ANOMALY_CHECK,
    PRECOMPILE_AI_RISK_SCORE,
    AsyncQorClient,
    QorClient,
    ai_anomaly_check,
    ai_risk_score,
    encode_ai_anomaly_check,
    encode_ai_risk_score,
    simulate_with_risk_score,
)
from qorsdk.precompiles import selector

RPC = "http://localhost:8545"
SENDER = "0x" + "11" * 20


def _word(value: int) -> str:
    return value.to_bytes(32, "big").hex()


def _result(*words: int) -> str:
    return "0x" + "".join(_word(w) for w in words)


def _jsonrpc(result: object) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


# --- ABI encoding (no node) ---------------------------------------------------


def test_selectors_are_keccak_first_four_bytes():
    assert selector("aiRiskScore(bytes)").hex() == "68e2a75b"
    assert selector("aiAnomalyCheck(address,uint256)").hex() == "53313835"


def test_encode_ai_risk_score_dynamic_bytes_layout():
    cd = encode_ai_risk_score(b"\xde\xad\xbe\xef")
    raw = bytes.fromhex(cd[2:])
    assert raw[:4] == selector("aiRiskScore(bytes)")
    # head offset 0x20, then length 4, then right-padded data.
    assert int.from_bytes(raw[4:36], "big") == 0x20
    assert int.from_bytes(raw[36:68], "big") == 4
    assert raw[68:72] == b"\xde\xad\xbe\xef"
    assert raw[72:96] == b"\x00" * 24  # padded to a 32-byte boundary


def test_encode_ai_anomaly_check_address_and_uint():
    cd = encode_ai_anomaly_check(SENDER, 1000)
    raw = bytes.fromhex(cd[2:])
    assert raw[:4] == selector("aiAnomalyCheck(address,uint256)")
    assert raw[4:36] == bytes(12) + bytes.fromhex("11" * 20)  # left-padded address
    assert int.from_bytes(raw[36:68], "big") == 1000


def test_encode_address_rejects_wrong_length():
    with pytest.raises(ValueError):
        encode_ai_anomaly_check("0x1234", 1)


# --- ai_risk_score ------------------------------------------------------------


@respx.mock
def test_ai_risk_score_decodes_two_words():
    route = respx.post(RPC).mock(return_value=_jsonrpc(_result(4200, 2)))
    client = QorClient(RPC)
    out = client.ai_risk_score(b"\x01\x02\x03")
    client.close()
    assert out == {"score": 4200, "level": 2}
    payload = json.loads(route.calls.last.request.read())
    assert payload["method"] == "eth_call"
    call_obj = payload["params"][0]
    assert call_obj["to"] == PRECOMPILE_AI_RISK_SCORE
    assert call_obj["data"] == encode_ai_risk_score(b"\x01\x02\x03")
    assert payload["params"][1] == "latest"


@respx.mock
def test_ai_risk_score_level_masks_low_byte():
    respx.post(RPC).mock(return_value=_jsonrpc(_result(1, 0xFF03)))
    client = QorClient(RPC)
    out = client.ai_risk_score(b"")
    client.close()
    assert out["level"] == 0x03


# --- ai_anomaly_check ---------------------------------------------------------


@respx.mock
def test_ai_anomaly_check_decodes_score_and_flag():
    route = respx.post(RPC).mock(return_value=_jsonrpc(_result(77, 1)))
    client = QorClient(RPC)
    out = client.ai_anomaly_check(SENDER, 500)
    client.close()
    assert out == {"anomaly_score": 77, "flagged": True}
    payload = json.loads(route.calls.last.request.read())
    assert payload["params"][0]["to"] == PRECOMPILE_AI_ANOMALY_CHECK
    assert payload["params"][0]["data"] == encode_ai_anomaly_check(SENDER, 500)


@respx.mock
def test_ai_anomaly_check_not_flagged():
    respx.post(RPC).mock(return_value=_jsonrpc(_result(0, 0)))
    client = QorClient(RPC)
    out = client.ai_anomaly_check(SENDER, 1)
    client.close()
    assert out["flagged"] is False


# --- module-level functions take any eth-call client -------------------------


@respx.mock
def test_module_functions_accept_client():
    respx.post(RPC).mock(return_value=_jsonrpc(_result(9, 0)))
    client = QorClient(RPC)
    assert ai_risk_score(client, b"\x00")["score"] == 9
    assert ai_anomaly_check(client, SENDER, 2)["anomaly_score"] == 9
    client.close()


# --- simulate_with_risk_score -------------------------------------------------


@respx.mock
def test_simulate_with_risk_score_safe_when_low_level_unflagged():
    # eth_estimateGas, then eth_call (risk), then eth_call (anomaly).
    responses = iter(
        [
            _jsonrpc("0x5208"),  # gas = 21000
            _jsonrpc(_result(10, 1)),  # risk: score 10, level 1
            _jsonrpc(_result(0, 0)),  # anomaly: score 0, not flagged
        ]
    )
    respx.post(RPC).mock(side_effect=lambda request: next(responses))
    client = QorClient(RPC)
    out = client.simulate_with_risk_score(
        {"from": SENDER, "to": "0x" + "22" * 20, "data": "0xabcd", "value": 5}
    )
    client.close()
    assert out["gas"] == 21000
    assert out["risk"] == {"score": 10, "level": 1}
    assert out["anomaly"] == {"anomaly_score": 0, "flagged": False}
    assert out["safe"] is True


@respx.mock
def test_simulate_unsafe_when_high_level():
    responses = iter(
        [_jsonrpc("0x5208"), _jsonrpc(_result(99, 3)), _jsonrpc(_result(0, 0))]
    )
    respx.post(RPC).mock(side_effect=lambda request: next(responses))
    client = QorClient(RPC)
    out = client.simulate_with_risk_score({"from": SENDER})
    client.close()
    assert out["safe"] is False  # level 3 is not < 3


@respx.mock
def test_simulate_unsafe_when_flagged():
    responses = iter(
        [_jsonrpc("0x5208"), _jsonrpc(_result(1, 0)), _jsonrpc(_result(5, 1))]
    )
    respx.post(RPC).mock(side_effect=lambda request: next(responses))
    client = QorClient(RPC)
    out = client.simulate_with_risk_score({"from": SENDER, "value": "0x10"})
    client.close()
    assert out["safe"] is False  # anomaly flagged


@respx.mock
def test_simulate_value_hex_string_is_decoded():
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.read())
        captured.append(payload)
        if payload["method"] == "eth_estimateGas":
            return _jsonrpc("0x5208")
        return _jsonrpc(_result(0, 0))

    respx.post(RPC).mock(side_effect=handler)
    client = QorClient(RPC)
    client.simulate_with_risk_score({"from": SENDER, "value": "0x3e8"})
    client.close()
    # anomaly check is the last call; its amount word must equal 0x3e8 = 1000.
    anomaly_call = [c for c in captured if c["method"] == "eth_call"][-1]
    raw = bytes.fromhex(anomaly_call["params"][0]["data"][2:])
    assert int.from_bytes(raw[36:68], "big") == 1000


# --- module standalone simulate + module constant -----------------------------


def test_precompile_address_constants():
    assert PRECOMPILE_AI_RISK_SCORE.endswith("B01")
    assert PRECOMPILE_AI_ANOMALY_CHECK.endswith("B02")


@respx.mock
def test_standalone_simulate_function():
    responses = iter(
        [_jsonrpc("0x5208"), _jsonrpc(_result(1, 0)), _jsonrpc(_result(0, 0))]
    )
    respx.post(RPC).mock(side_effect=lambda request: next(responses))
    client = QorClient(RPC)
    out = simulate_with_risk_score(client, {"from": SENDER})
    client.close()
    assert out["safe"] is True


# --- async mirror -------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_async_ai_risk_score_and_simulate():
    responses = iter(
        [
            _jsonrpc(_result(7, 1)),  # ai_risk_score
            _jsonrpc("0x5208"),  # simulate: gas
            _jsonrpc(_result(7, 1)),  # simulate: risk
            _jsonrpc(_result(0, 0)),  # simulate: anomaly
        ]
    )
    respx.post(RPC).mock(side_effect=lambda request: next(responses))
    async with AsyncQorClient(RPC) as client:
        risk = await client.ai_risk_score(b"\x01")
        assert risk == {"score": 7, "level": 1}
        out = await client.simulate_with_risk_score({"from": SENDER})
        assert out["gas"] == 21000
        assert out["safe"] is True
