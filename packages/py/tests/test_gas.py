"""Tests for gas-price parsing, fee math, and the auto-gas (simulate) path."""

from __future__ import annotations

import httpx
import pytest
import respx
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxRaw

from qorsdk import GasPrice, auto_fee, calculate_fee, estimate_gas, simulate_gas_used
from qorsdk.tx import BuiltTx

BASE = "http://localhost:1317"


def _dummy_built() -> BuiltTx:
    tx = TxRaw(body_bytes=b"\x01", auth_info_bytes=b"\x02", signatures=[b"\x03"])
    return BuiltTx(
        tx_raw=tx, tx_raw_bytes=tx.SerializeToString(), auth_info_bytes=b"\x02"
    )


def test_gas_price_parses_and_renders():
    gp = GasPrice.from_string("0.025uqor")
    assert gp.denom == "uqor"
    assert gp.numerator == 25
    assert gp.scale == 3
    assert str(gp) == "0.025uqor"


def test_gas_price_integer_amount():
    gp = GasPrice.from_string("5uqor")
    assert str(gp) == "5uqor"


def test_gas_price_invalid_raises():
    with pytest.raises(ValueError):
        GasPrice.from_string("not-a-price")


def test_calculate_fee_ceil_rounds():
    # 200000 * 0.025 = 5000 exactly.
    assert calculate_fee(200000, "0.025uqor") == {
        "amount": [{"denom": "uqor", "amount": "5000"}],
        "gas": "200000",
    }
    # 7 * 0.3 = 2.1 -> ceil 3.
    assert calculate_fee(7, "0.3uqor")["amount"][0]["amount"] == "3"


@respx.mock
def test_simulate_gas_used_reads_gas_info():
    respx.post(f"{BASE}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "123456"}})
    )
    assert simulate_gas_used(BASE, _dummy_built()) == 123456


@respx.mock
def test_simulate_gas_used_missing_raises():
    respx.post(f"{BASE}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {}})
    )
    with pytest.raises(ValueError):
        simulate_gas_used(BASE, _dummy_built())


@respx.mock
def test_estimate_gas_applies_multiplier():
    respx.post(f"{BASE}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    # 100000 * 1.4 = 140000.
    assert estimate_gas(BASE, _dummy_built(), gas_multiplier=1.4) == 140000


@respx.mock
def test_auto_fee_computes_fee_from_simulated_gas():
    respx.post(f"{BASE}/cosmos/tx/v1beta1/simulate").mock(
        return_value=httpx.Response(200, json={"gas_info": {"gas_used": "100000"}})
    )
    fee = auto_fee(BASE, _dummy_built(), gas_multiplier=1.4, gas_price="0.025uqor")
    # gas = ceil(100000 * 1.4) = 140000; fee = ceil(140000 * 0.025) = 3500.
    assert fee == {"amount": [{"denom": "uqor", "amount": "3500"}], "gas": "140000"}
