"""Tests for utils: hashes (known vectors), unit conversion, address validation."""

from __future__ import annotations

import pytest

from qorechain import (
    format_units,
    is_checksum_address,
    is_valid_evm_address,
    is_valid_svm_address,
    keccak256_hex,
    parse_units,
    ripemd160_hex,
    sha256_hex,
    to_checksum_address,
)


# --- hashes (known vectors) ------------------------------------------------- #
def test_sha256_known_vector():
    # sha256("abc")
    assert sha256_hex("abc") == (
        "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_keccak256_known_vectors():
    # keccak256("") and keccak256("abc")
    assert keccak256_hex("") == (
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )
    assert keccak256_hex("abc") == (
        "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    )


def test_ripemd160_known_vector():
    # ripemd160("abc")
    assert ripemd160_hex("abc") == "0x8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"


def test_hash_accepts_bytes():
    assert sha256_hex(b"abc") == sha256_hex("abc")


# --- units ------------------------------------------------------------------ #
def test_parse_units_exact():
    assert parse_units("1.5", 18) == 1500000000000000000
    assert parse_units("0", 6) == 0
    assert parse_units("1", 0) == 1
    assert parse_units("+2.5", 2) == 250


def test_parse_units_rejects_too_many_decimals():
    with pytest.raises(ValueError):
        parse_units("1.234", 2)


def test_parse_units_rejects_negative_and_garbage():
    with pytest.raises(ValueError):
        parse_units("-1", 6)
    with pytest.raises(ValueError):
        parse_units("1e3", 6)


def test_format_units_exact():
    assert format_units(1500000000000000000, 18) == "1.5"
    assert format_units(0, 18) == "0"
    assert format_units("1000000", 6) == "1"
    assert format_units(1, 6) == "0.000001"


def test_round_trip_units():
    for s, d in [("123.456789", 6), ("1", 18), ("0.1", 1)]:
        assert format_units(parse_units(s, d), d) == s


# --- validation ------------------------------------------------------------- #
def test_is_valid_evm_address():
    assert is_valid_evm_address("0x" + "ab" * 20) is True
    assert is_valid_evm_address("0x123") is False
    assert is_valid_evm_address("ab" * 20) is False


def test_checksum_address_round_trip():
    addr = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
    assert to_checksum_address(addr.lower()) == addr
    assert is_checksum_address(addr) is True
    # All-lowercase carries no checksum info.
    assert is_checksum_address(addr.lower()) is False


def test_checksum_address_invalid_raises():
    with pytest.raises(ValueError):
        to_checksum_address("0x123")


def test_is_valid_svm_address():
    # The Solana system program id is a valid on-curve ed25519 address.
    assert is_valid_svm_address("11111111111111111111111111111111") is True
    assert is_valid_svm_address("not-base58-!!!") is False
    assert is_valid_svm_address("abc") is False
