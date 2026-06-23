"""Conversion and validation for QoreChain bech32 addresses (e.g. ``qor1...``)
and their underlying byte payloads expressed as ``0x``-prefixed hex.

bech32 stores data as 5-bit groups ("words"), so encoding/decoding converts
between those groups and the 8-bit byte representation callers work with.
"""

from __future__ import annotations

import re

from bech32 import bech32_decode, bech32_encode, convertbits

#: Default bech32 human-readable prefix for QoreChain account addresses.
DEFAULT_PREFIX = "qor"

_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")


def _strip_hex_prefix(hex_str: str) -> str:
    return hex_str[2:] if hex_str[:2] in ("0x", "0X") else hex_str


def _hex_to_bytes(hex_str: str) -> bytes:
    body = _strip_hex_prefix(hex_str)
    if not body or len(body) % 2 != 0 or not _HEX_RE.match(body):
        raise ValueError(f"invalid hex string: {hex_str}")
    return bytes.fromhex(body)


def bytes_to_bech32(data: bytes, prefix: str = DEFAULT_PREFIX) -> str:
    """Encode raw bytes to a bech32 address with the given prefix.

    This is the primitive encoder; callers holding a ``bytes`` payload (e.g. the
    20-byte ``ripemd160(sha256(pubkey))`` account hash) should use it directly
    rather than round-tripping through hex.
    """
    words = convertbits(data, 8, 5, pad=True)
    if words is None:
        raise ValueError("failed to convert bytes to bech32 words")
    encoded = bech32_encode(prefix, words)
    if encoded is None:
        raise ValueError("failed to encode bech32 address")
    return encoded


def hex_to_bech32(hex_str: str, prefix: str = DEFAULT_PREFIX) -> str:
    """Encode hex bytes to a bech32 address with the given prefix.

    :raises ValueError: If ``hex_str`` is not a valid hex string.
    """
    return bytes_to_bech32(_hex_to_bytes(hex_str), prefix)


def bech32_to_hex(addr: str) -> str:
    """Decode a bech32 address to a ``0x``-prefixed hex string of its payload.

    :raises ValueError: If ``addr`` is not a valid bech32 string.
    """
    _hrp, words = bech32_decode(addr)
    if words is None:
        raise ValueError(f"invalid bech32 address: {addr}")
    data = convertbits(words, 5, 8, pad=False)
    if data is None:
        raise ValueError(f"invalid bech32 payload: {addr}")
    return "0x" + bytes(data).hex()


def is_valid_bech32(addr: str, prefix: str | None = None) -> bool:
    """Validate a bech32 address, optionally requiring a specific prefix.

    :returns: ``True`` if ``addr`` is a structurally valid bech32 string
        (correct checksum) and, when ``prefix`` is supplied, its prefix matches;
        ``False`` otherwise. Never raises.
    """
    hrp, words = bech32_decode(addr)
    if hrp is None or words is None:
        return False
    return True if prefix is None else hrp == prefix
