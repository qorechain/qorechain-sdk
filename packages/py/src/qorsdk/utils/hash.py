"""Hash helpers: SHA-256, keccak-256, and RIPEMD-160.

Each function accepts a UTF-8 string or raw bytes and returns the digest as raw
bytes, with a ``*_hex`` companion returning a lowercase ``0x``-prefixed hex
string. No new cryptography is implemented here — SHA-256/RIPEMD-160 come from
the standard library and keccak-256 from ``pycryptodome`` (a transitive
dependency of cosmpy/bip-utils, always present).
"""

from __future__ import annotations

import hashlib

from Crypto.Hash import keccak as _keccak

#: Input accepted by the hash helpers: a UTF-8 string or raw bytes.
HashInput = str | bytes


def _to_bytes(data: HashInput) -> bytes:
    return data.encode("utf-8") if isinstance(data, str) else data


def to_hex(data: bytes) -> str:
    """Encode bytes to a lowercase ``0x``-prefixed hex string."""
    return "0x" + data.hex()


def sha256(data: HashInput) -> bytes:
    """SHA-256 digest of ``data`` as raw bytes."""
    return hashlib.sha256(_to_bytes(data)).digest()


def sha256_hex(data: HashInput) -> str:
    """SHA-256 digest of ``data`` as a ``0x``-prefixed hex string."""
    return to_hex(sha256(data))


def keccak256(data: HashInput) -> bytes:
    """keccak-256 digest of ``data`` as raw bytes (the EVM hashing primitive)."""
    h = _keccak.new(digest_bits=256)
    h.update(_to_bytes(data))
    return h.digest()


def keccak256_hex(data: HashInput) -> str:
    """keccak-256 digest of ``data`` as a ``0x``-prefixed hex string."""
    return to_hex(keccak256(data))


def ripemd160(data: HashInput) -> bytes:
    """RIPEMD-160 digest of ``data`` as raw bytes."""
    return hashlib.new("ripemd160", _to_bytes(data)).digest()


def ripemd160_hex(data: HashInput) -> str:
    """RIPEMD-160 digest of ``data`` as a ``0x``-prefixed hex string."""
    return to_hex(ripemd160(data))
