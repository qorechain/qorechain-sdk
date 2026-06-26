"""Utility helpers: hashing, integer-exact unit conversion, address validation."""

from __future__ import annotations

from .hash import (
    HashInput,
    keccak256,
    keccak256_hex,
    ripemd160,
    ripemd160_hex,
    sha256,
    sha256_hex,
    to_hex,
)
from .units import format_units, parse_units
from .validation import (
    is_checksum_address,
    is_valid_evm_address,
    is_valid_svm_address,
    to_checksum_address,
)

__all__ = [
    # hash
    "HashInput",
    "to_hex",
    "sha256",
    "sha256_hex",
    "keccak256",
    "keccak256_hex",
    "ripemd160",
    "ripemd160_hex",
    # units
    "parse_units",
    "format_units",
    # validation
    "is_valid_evm_address",
    "to_checksum_address",
    "is_checksum_address",
    "is_valid_svm_address",
]
