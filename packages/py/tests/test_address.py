import pytest

from qorsdk import (
    bech32_to_hex,
    bytes_to_bech32,
    hex_to_bech32,
    is_valid_bech32,
)

# Known native account from the public test mnemonic (idx 0).
NATIVE_ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu"


def test_round_trip_bytes():
    payload = bytes(range(20))
    addr = bytes_to_bech32(payload)
    assert addr.startswith("qor1")
    decoded = bytes.fromhex(bech32_to_hex(addr)[2:])
    assert decoded == payload


def test_hex_round_trip():
    hex_in = "0x" + "ab" * 20
    addr = hex_to_bech32(hex_in)
    assert bech32_to_hex(addr) == hex_in


def test_hex_without_prefix():
    addr1 = hex_to_bech32("ab" * 20)
    addr2 = hex_to_bech32("0x" + "ab" * 20)
    assert addr1 == addr2


def test_custom_prefix():
    addr = bytes_to_bech32(bytes(20), prefix="qorvaloper")
    assert addr.startswith("qorvaloper1")
    assert is_valid_bech32(addr, prefix="qorvaloper")
    assert not is_valid_bech32(addr, prefix="qor")


def test_is_valid_bech32_true():
    assert is_valid_bech32(NATIVE_ADDR)
    assert is_valid_bech32(NATIVE_ADDR, prefix="qor")


def test_is_valid_bech32_wrong_prefix():
    assert not is_valid_bech32(NATIVE_ADDR, prefix="cosmos")


@pytest.mark.parametrize("bad", ["", "notbech32", "qor1invalidchecksum", "1qor"])
def test_is_valid_bech32_false(bad):
    assert is_valid_bech32(bad) is False


def test_bech32_to_hex_rejects_garbage():
    with pytest.raises(ValueError):
        bech32_to_hex("not-an-address")


@pytest.mark.parametrize("bad", ["0xZZ", "0x1", "", "0x"])
def test_hex_to_bech32_rejects_garbage(bad):
    with pytest.raises(ValueError):
        hex_to_bech32(bad)
