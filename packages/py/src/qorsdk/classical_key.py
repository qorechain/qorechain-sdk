"""The ``ecdsa_pubkey`` rule of PQC key registration (chain v3.2.2).

``MsgRegisterPQCKey`` / ``MsgRegisterPQCKeyV2`` carry an optional classical key.
From v3.2.2 the chain accepts it only when it is empty, or a 33-byte compressed
secp256k1 key that belongs to the sender, through either address derivation the
chain uses:

- eth-native: ``keccak256(uncompressed[1:])[12:]`` (``eth_secp256k1`` accounts)
- cosmos:     ``ripemd160(sha256(compressed))``   (``secp256k1`` accounts)

Anything else costs the registration fee and fails. Checking here turns that
into an error before broadcast.
"""

from __future__ import annotations

import hmac
from typing import Literal

from bech32 import bech32_decode, convertbits
from bip_utils import Secp256k1PublicKey

from .utils import keccak256, ripemd160, sha256

#: Size of a compressed secp256k1 public key.
COMPRESSED_SECP256K1_LENGTH = 33


def validate_classical_key_for_sender(
    sender: str, pubkey: bytes | None
) -> Literal["empty", "eth", "cosmos"]:
    """Which derivation ties ``pubkey`` to ``sender``.

    :returns: ``"empty"`` when no key is given, ``"eth"`` or ``"cosmos"`` when it
        belongs to the sender.
    :raises ValueError: With the reason the chain would refuse the key.
    """
    if pubkey is None or len(pubkey) == 0:
        return "empty"
    if not isinstance(pubkey, (bytes, bytearray)):
        raise ValueError(
            "ecdsa_pubkey must be bytes; decode hex or base64 before building the message"
        )
    pubkey = bytes(pubkey)
    if len(pubkey) != COMPRESSED_SECP256K1_LENGTH or pubkey[0] not in (2, 3):
        raise ValueError(
            f"ecdsa_pubkey must be a {COMPRESSED_SECP256K1_LENGTH}-byte compressed "
            f"secp256k1 key, got {len(pubkey)} bytes"
        )
    try:
        uncompressed = Secp256k1PublicKey.FromBytes(pubkey).RawUncompressed().ToBytes()
    except Exception:
        raise ValueError("ecdsa_pubkey is not a point on secp256k1") from None
    _hrp, words = bech32_decode(sender)
    account = bytes(convertbits(words, 5, 8, False) or b"") if words else b""
    if len(account) == 0:
        raise ValueError(f"sender {sender!r} is not a bech32 address")
    # RawUncompressed is 64 bytes (x || y) in bip_utils, 65 with the 0x04 prefix
    # elsewhere; keccak runs over x || y either way.
    xy = uncompressed[-64:]
    if hmac.compare_digest(keccak256(xy)[12:], account):
        return "eth"
    if hmac.compare_digest(ripemd160(sha256(pubkey)), account):
        return "cosmos"
    raise ValueError(f"ecdsa_pubkey does not belong to {sender} under either address derivation")
