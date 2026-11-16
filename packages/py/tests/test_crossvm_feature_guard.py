"""The v3.2.8 MsgCrossVMCall fields (8 async_gas_limit, 9 async_max_factor) are
checked against the network's protocol feature switches before signing."""

from __future__ import annotations

import httpx
import pytest
import respx

from qorsdk import (
    CROSSVM_ASYNC_ESCROW_FEATURE,
    CROSSVM_ASYNC_GAS_PRICED_FEATURE,
    CrossVmAsyncFieldsUnsupportedError,
    CrossVmFeatureQueryError,
    broadcast,
    build_cross_vm_call,
    create_cross_vm_client,
    derive_native_account,
    msg,
    require_crossvm_async_fields_supported_async,
    send_messages,
)
from qorsdk import crossvm_features as guard

REST = "http://localhost:1317"
FEATURES_URL = f"{REST}/qorechain/pqc/v1/protocol_features"
TXS_URL = f"{REST}/cosmos/tx/v1beta1/txs"
CHAIN_ID = "qorechain-vladi"
TEST_MNEMONIC = (
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
)
ACCOUNT = derive_native_account(TEST_MNEMONIC)
CONTRACT = "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0skm0f0x"
FEE = {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}


def _sw(name: str, enabled: bool) -> dict:
    return {"name": name, "enabled": enabled, "known": True, "staged": False}


GAS_ON = _sw(CROSSVM_ASYNC_GAS_PRICED_FEATURE, True)
GAS_OFF = _sw(CROSSVM_ASYNC_GAS_PRICED_FEATURE, False)
ESCROW_ON = _sw(CROSSVM_ASYNC_ESCROW_FEATURE, True)
# What mainnet on v3.2.7 lists: switches, but not the v3.2.8 ones.
MAINNET_V327 = [_sw("pqc-sign-bytes-v2", True), _sw("abstractaccount-hardening", True)]


def _features(*features: dict) -> httpx.Response:
    return httpx.Response(200, json={"features": list(features), "height": "120"})


def _build(rest_url: str | None = REST, **fields):
    args = dict(async_=True, async_gas_limit=1_000_000)
    args.update(fields)
    return build_cross_vm_call(
        sender=ACCOUNT.address,
        target_vm="cosmwasm",
        target_contract=CONTRACT,
        cosmwasm={"a": 1},
        rest_url=rest_url,
        **args,
    )


def test_switch_names_match_the_chain():
    assert CROSSVM_ASYNC_GAS_PRICED_FEATURE == "crossvm-async-gas-priced"
    assert CROSSVM_ASYNC_ESCROW_FEATURE == "crossvm-async-escrow"


@respx.mock
def test_switch_on_allows_the_field():
    route = respx.get(FEATURES_URL).mock(return_value=_features(GAS_ON, ESCROW_ON))
    m = _build(async_max_factor=2_000_000)
    assert m.value.async_gas_limit == 1_000_000
    assert m.value.async_max_factor == 2_000_000
    assert route.call_count == 2  # one lookup per switch


@respx.mock
def test_switch_absent_mainnet_shape_raises_the_clear_error():
    respx.get(FEATURES_URL).mock(return_value=_features(*MAINNET_V327))
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError) as excinfo:
        _build()
    assert str(excinfo.value) == (
        "MsgCrossVMCall async_gas_limit (field 8) requires chain v3.2.8 (switch "
        f"crossvm-async-gas-priced is not on at {REST}); leave it 0 on this network"
    )


@respx.mock
def test_field_9_names_the_escrow_switch():
    respx.get(FEATURES_URL).mock(return_value=_features(GAS_ON))
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError) as excinfo:
        _build(async_gas_limit=0, async_max_factor=2_000_000)
    assert str(excinfo.value) == (
        "MsgCrossVMCall async_max_factor (field 9) requires chain v3.2.8 (switch "
        f"crossvm-async-escrow is not on at {REST}); leave it 0 on this network"
    )


@respx.mock
@pytest.mark.parametrize(
    "answer",
    [
        _features(GAS_OFF),
        _features(),
        httpx.Response(404, json={"code": 12, "message": "Not Implemented"}),
        httpx.Response(501, json={"code": 12, "message": "Not Implemented"}),
    ],
    ids=["disabled", "empty-list", "404", "501"],
)
def test_switch_not_on_raises_with_no_plan_fallback(answer):
    respx.get(FEATURES_URL).mock(return_value=answer)
    plan = respx.get(url__regex=rf"{REST}/cosmos/upgrade/.*").mock(
        return_value=httpx.Response(200, json={"height": "1"})
    )
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError, match="leave it 0"):
        _build()
    assert plan.call_count == 0


@respx.mock
@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(500, json={"code": 13}),
        httpx.Response(429, text="slow down"),
        httpx.ConnectError("unreachable"),
    ],
    ids=["500", "429", "connection-error"],
)
def test_network_trouble_raises_cannot_ask(answer):
    if isinstance(answer, Exception):
        respx.get(FEATURES_URL).mock(side_effect=answer)
    else:
        respx.get(FEATURES_URL).mock(return_value=answer)
    with pytest.raises(CrossVmFeatureQueryError, match="cannot ask"):
        _build()
    # Not cached: a later good answer goes through.
    respx.get(FEATURES_URL).mock(return_value=_features(GAS_ON))
    assert _build().value.async_gas_limit == 1_000_000


@respx.mock
def test_fields_zero_make_no_request():
    route = respx.get(FEATURES_URL).mock(return_value=httpx.Response(500))
    m = _build(async_gas_limit=0, async_max_factor=0)
    assert m.value.async_gas_limit == 0
    m = _build(rest_url=None, async_gas_limit=None)
    assert route.call_count == 0


def test_no_rest_url_needs_an_explicit_opt_out():
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError, match="skip_feature_check"):
        _build(rest_url=None)
    assert _build(rest_url=None, skip_feature_check=True).value.async_gas_limit == 1_000_000


@respx.mock
def test_answers_are_cached_for_the_ttl(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(guard, "_clock", lambda: now[0])
    route = respx.get(FEATURES_URL).mock(return_value=_features(GAS_ON))
    _build()
    _build()
    assert route.call_count == 1
    now[0] += 61
    _build()
    assert route.call_count == 2


@respx.mock
def test_client_call_refuses_before_signing_and_sends_nothing():
    respx.get(FEATURES_URL).mock(return_value=_features(*MAINNET_V327))
    txs = respx.post(TXS_URL).mock(return_value=httpx.Response(200, json={"tx_response": {}}))
    client = create_cross_vm_client(
        account=ACCOUNT, chain_id=CHAIN_ID, account_number=4, rest_url=REST, fee=FEE
    )
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError, match="field 8"):
        client.call(
            target_vm="cosmwasm",
            target_contract=CONTRACT,
            cosmwasm={"a": 1},
            async_=True,
            async_gas_limit=1_000_000,
        )
    assert txs.call_count == 0


@respx.mock
def test_client_call_goes_through_when_the_switch_is_on():
    respx.get(FEATURES_URL).mock(return_value=_features(GAS_ON))
    txs = respx.post(TXS_URL).mock(
        return_value=httpx.Response(200, json={"tx_response": {"code": 0, "txhash": "AB"}})
    )
    client = create_cross_vm_client(
        account=ACCOUNT, chain_id=CHAIN_ID, account_number=4, rest_url=REST, fee=FEE
    )
    client.call(
        target_vm="cosmwasm",
        target_contract=CONTRACT,
        cosmwasm={"a": 1},
        async_=True,
        async_gas_limit=1_000_000,
    )
    assert txs.call_count == 1


def _raw_composer_tx() -> bytes:
    # Built with the bare composer, which does no check of its own.
    call = msg.crossvm.cross_vm_call(
        sender=ACCOUNT.address,
        source_vm="evm",
        target_vm="cosmwasm",
        target_contract=CONTRACT,
        payload=b"{}",
        async_gas_limit=1_000_000,
        **{"async": True},
    )
    built = send_messages(
        account=ACCOUNT,
        messages=[call],
        chain_id=CHAIN_ID,
        account_number=4,
        sequence=0,
        fee=FEE,
    )
    return built.tx_raw_bytes


@respx.mock
def test_broadcast_checks_a_signed_tx_carrying_the_field():
    respx.get(FEATURES_URL).mock(return_value=httpx.Response(404))
    txs = respx.post(TXS_URL).mock(return_value=httpx.Response(200, json={}))
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError, match="field 8"):
        broadcast(REST, _raw_composer_tx())
    assert txs.call_count == 0
    broadcast(REST, _raw_composer_tx(), skip_feature_check=True)
    assert txs.call_count == 1


async def test_async_guard():
    def handler(request: httpx.Request) -> httpx.Response:
        return _features(*MAINNET_V327)

    msgs = [_build(rest_url=None, skip_feature_check=True)]
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(CrossVmAsyncFieldsUnsupportedError, match="field 8"):
        await require_crossvm_async_fields_supported_async(msgs, REST, client=client)
    guard.clear_crossvm_feature_cache()  # the "not on" answer is cached for the TTL
    on = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: _features(GAS_ON)))
    await require_crossvm_async_fields_supported_async(msgs, REST, client=on)
