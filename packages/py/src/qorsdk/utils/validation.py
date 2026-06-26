"""Cross-VM address validation and EIP-55 checksum helpers.

QoreChain spans three address formats: bech32 (``qor1...``, validated in
:mod:`qorechain.address`), EVM hex (``0x...``, 20 bytes), and SVM ed25519 public
keys (base58, 32 bytes). These helpers validate the EVM and SVM forms and expose
the EIP-55 mixed-case checksum used by EVM tooling.
"""

from __future__ import annotations

import re

import base58
from bip_utils.ecc import Ed25519PublicKey

from .hash import keccak256

_EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_HEX40_RE = re.compile(r"^[0-9a-f]{40}$")


def is_valid_evm_address(address: str) -> bool:
    """True if ``address`` is structurally a valid EVM address.

    ``0x`` followed by exactly 40 hex characters (20 bytes). Case is not checked;
    use :func:`is_checksum_address` to verify an EIP-55 checksum. Never raises.
    """
    return bool(_EVM_RE.match(address))


def to_checksum_address(address: str) -> str:
    """Compute the EIP-55 mixed-case checksum form of an EVM address.

    Hashes the lowercase hex (without ``0x``) with keccak-256 and uppercases each
    hex nibble whose corresponding hash nibble is ``>= 8``.

    :param address: A 20-byte EVM address, with or without ``0x``, any case.
    :returns: The ``0x``-prefixed checksummed address.
    :raises ValueError: If ``address`` is not a valid 20-byte hex address.
    """
    body = (address[2:] if address[:2].lower() == "0x" else address).lower()
    if not _HEX40_RE.match(body):
        raise ValueError(f"invalid EVM address: {address}")

    digest = keccak256(body)
    out = ["0x"]
    for i, ch in enumerate(body):
        if ch.isdigit():
            out.append(ch)
        else:
            hash_byte = digest[i >> 1]
            nibble = (hash_byte >> 4) if i % 2 == 0 else (hash_byte & 0x0F)
            out.append(ch.upper() if nibble >= 8 else ch)
    return "".join(out)


def is_checksum_address(address: str) -> bool:
    """True if ``address`` is a correctly EIP-55-checksummed EVM address.

    Returns ``True`` only if the address is structurally valid *and* its
    mixed-case pattern matches :func:`to_checksum_address`. All-lowercase or
    all-uppercase addresses (which carry no checksum information) return
    ``False``. Never raises.
    """
    if not is_valid_evm_address(address):
        return False
    body = address[2:]
    if body == body.lower() or body == body.upper():
        return False
    try:
        return to_checksum_address(address) == address
    except ValueError:
        return False


def is_valid_svm_address(address: str) -> bool:
    """True if ``address`` is a valid SVM (Solana-compatible) public-key address.

    A base58 string decoding to exactly 32 bytes that is a valid ed25519 curve
    point. Off-curve PDAs are intentionally rejected. Never raises.
    """
    try:
        raw = base58.b58decode(address)
    except Exception:
        return False
    if len(raw) != 32:
        return False
    try:
        # A valid account address is an ed25519 public key (on the curve);
        # FromBytes rejects malformed / off-curve encodings.
        Ed25519PublicKey.FromBytes(raw)
        return True
    except Exception:
        return False
