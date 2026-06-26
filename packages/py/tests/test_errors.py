"""Tests for transaction error decoding and the typed QoreTxError."""

from __future__ import annotations

import pytest

from qorsdk import (
    QoreTxError,
    decode_tx_error,
    is_tx_failure,
    tx_error_from,
)


def test_decode_known_sdk_code():
    decoded = decode_tx_error(5, "sdk", "balance too low")
    assert decoded.kind == "insufficient_funds"
    assert "insufficient funds" in decoded.message
    assert "balance too low" in decoded.message
    assert decoded.code == 5
    assert decoded.codespace == "sdk"


def test_decode_sequence_mismatch():
    decoded = decode_tx_error(3)
    assert decoded.kind == "invalid_sequence"
    assert decoded.codespace == "sdk"  # default


def test_decode_out_of_gas():
    assert decode_tx_error(11).kind == "out_of_gas"


def test_decode_insufficient_fee():
    assert decode_tx_error(13).kind == "insufficient_fee"


def test_decode_module_codespace_falls_back_to_raw_log():
    decoded = decode_tx_error(7, "pqc", "pqc key not registered")
    assert decoded.codespace == "pqc"
    assert decoded.kind == "pqc_7"
    assert "pqc key not registered" in decoded.message
    assert 'module "pqc"' in decoded.message


def test_decode_unmapped_sdk_code_generic():
    decoded = decode_tx_error(999, "sdk", "weird")
    assert decoded.kind == "sdk_999"
    assert "weird" in decoded.message


def test_is_tx_failure():
    assert is_tx_failure(5) is True
    assert is_tx_failure(0) is False


def test_tx_error_from_raises_typed():
    err = tx_error_from(5, "sdk", "no funds", tx_hash="ABCD")
    assert isinstance(err, QoreTxError)
    assert err.code == 5
    assert err.codespace == "sdk"
    assert err.kind == "insufficient_funds"
    assert err.tx_hash == "ABCD"
    assert "ABCD" in str(err)
    with pytest.raises(QoreTxError):
        raise err
