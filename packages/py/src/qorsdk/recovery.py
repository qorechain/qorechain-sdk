"""PQC recovery codes (``QRC1-...``).

A recovery code is a second secret, drawn at random and held by the user, from
which an account's ML-DSA-87 key is derived. The account's classical
secp256k1 key says nothing about it, so holding the classical key alone is not
enough to sign the PQC half of a hybrid transaction.

The format matches ``@qorechain/wallet-adapter`` (``recovery.js``) byte for
byte::

    QRC1-XXXX-XXXX-...   (14 groups of 4, Crockford base32)

- 256 bits of secret entropy plus a 24-bit checksum (35 bytes, 56 characters);
- Crockford base32: no I, L, O or U, case-insensitive, and the letters people
  confuse are read as what they meant (O as 0, I and L as 1);
- the ``QRC1-`` prefix names and versions the format.

The code is the secret. Show it once, have the user write it down, and never
store it next to the account's seed phrase.

The key derivation, bound to the account address::

    seed    = shake256(utf8("qorechain:pqc:recovery:v1|" + lower(qor1) + "|") || secret32, 32)
    keypair = ML-DSA-87 keygen(seed)
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from .address import DEFAULT_PREFIX
from .pqc import PqcKeypair

try:  # dilithium-py exposes seeded keygen as ML_DSA_87.key_derive(seed32)
    from dilithium_py.ml_dsa import ML_DSA_87
except Exception as exc:  # pragma: no cover - dependency guaranteed by pyproject
    raise ImportError("dilithium-py is required for PQC recovery codes") from exc

#: The prefix (and format version) of every recovery code.
PQC_RECOVERY_CODE_PREFIX = "QRC1"

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford: no I L O U
_SECRET_BYTES = 32
_CHECKSUM_BYTES = 3
_PAYLOAD_BYTES = _SECRET_BYTES + _CHECKSUM_BYTES  # 35 bytes = 280 bits = 56 chars
_CODE_CHARS = (_PAYLOAD_BYTES * 8) // 5
_GROUP = 4

_CHECKSUM_DOMAIN = b"qorechain:pqc:recovery:v1:checksum"
_KEY_DOMAIN = "qorechain:pqc:recovery:v1"

_SEPARATORS = re.compile(r"[\s\-_.]")


def _checksum(secret: bytes | bytearray) -> bytes:
    return hashlib.shake_256(_CHECKSUM_DOMAIN + bytes(secret)).digest(_CHECKSUM_BYTES)


def _encode_base32(data: bytes | bytearray) -> str:
    bits = 0
    value = 0
    out = []
    for byte in data:
        value = ((value << 8) | byte) & 0xFFFF
        bits += 8
        while bits >= 5:
            out.append(_ALPHABET[(value >> (bits - 5)) & 31])
            bits -= 5
    if bits > 0:
        out.append(_ALPHABET[(value << (5 - bits)) & 31])
    return "".join(out)


def _decode_base32(chars: str) -> bytearray:
    out = bytearray()
    bits = 0
    value = 0
    for char in chars:
        index = _ALPHABET.find(char)
        if index < 0:
            raise ValueError(f'recovery code contains an invalid character "{char}"')
        value = ((value << 5) | index) & 0xFFFF
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 255)
            bits -= 8
    return out


def _format_code(chars: str) -> str:
    groups = [chars[i : i + _GROUP] for i in range(0, len(chars), _GROUP)]
    return f"{PQC_RECOVERY_CODE_PREFIX}-" + "-".join(groups)


def normalize_recovery_code(code: str) -> str:
    """Normalise what a person typed into the 56 data characters.

    Upper-cases the input, drops spaces and ``- _ .`` separators, reads O as 0
    and I / L as 1, and drops the ``QRC1`` prefix when the length says it is
    there.

    :raises ValueError: On a wrong length or a character outside the alphabet.
    """
    if not isinstance(code, str):
        raise ValueError("recovery code must be a string")
    # Read the confusable letters as what was meant BEFORE looking for the
    # prefix: someone copying "QRC1" off paper can write "QRCI" or "QRCL".
    s = _SEPARATORS.sub("", code.upper()).replace("O", "0").replace("I", "1").replace("L", "1")
    # Strip the prefix only when the length says it is there: 56 data characters
    # can begin with "QRC1" by chance, and cutting those would break a valid code.
    if len(s) == _CODE_CHARS + len(PQC_RECOVERY_CODE_PREFIX) and s.startswith(
        PQC_RECOVERY_CODE_PREFIX
    ):
        s = s[len(PQC_RECOVERY_CODE_PREFIX) :]
    if len(s) != _CODE_CHARS:
        raise ValueError(
            f"recovery code must have {_CODE_CHARS} characters after "
            f'"{PQC_RECOVERY_CODE_PREFIX}-", got {len(s)}'
        )
    if "U" in s:
        raise ValueError('recovery code contains an invalid character "U"')
    return s


def _decode_recovery_code(code: str) -> bytearray:
    """Decode and checksum-verify a code; returns the 32-byte secret (zero it after use)."""
    payload = _decode_base32(normalize_recovery_code(code))
    # 56 chars = 280 bits = exactly 35 bytes; anything else is a decoder fault.
    if len(payload) != _PAYLOAD_BYTES:  # pragma: no cover - guarded by the length check
        raise ValueError("recovery code has the wrong length")
    secret = bytearray(payload[:_SECRET_BYTES])
    given = bytes(payload[_SECRET_BYTES:])
    ok = hmac.compare_digest(given, _checksum(secret))
    payload[:] = bytes(len(payload))
    if not ok:
        secret[:] = bytes(len(secret))
        raise ValueError("recovery code checksum does not match: a character is mistyped")
    return secret


def pqc_recovery_code_from_secret(secret32: bytes | bytearray) -> str:
    """Encode 32 bytes of secret entropy as a ``QRC1-...`` recovery code.

    For apps that already hold 32 random bytes for the PQC key and want to show
    them to the user in the recovery code format.

    :raises ValueError: If ``secret32`` is not exactly 32 bytes.
    """
    if not isinstance(secret32, (bytes, bytearray)) or len(secret32) != _SECRET_BYTES:
        raise ValueError(f"recovery secret must be {_SECRET_BYTES} bytes")
    payload = bytearray(secret32) + _checksum(secret32)
    try:
        return _format_code(_encode_base32(payload))
    finally:
        payload[:] = bytes(len(payload))


def generate_pqc_recovery_code() -> str:
    """Generate a new recovery code from the operating system's CSPRNG.

    Show it to the user once; it is the secret.
    """
    secret = bytearray(secrets.token_bytes(_SECRET_BYTES))
    try:
        return pqc_recovery_code_from_secret(secret)
    finally:
        secret[:] = bytes(len(secret))


def is_valid_recovery_code(code: str) -> bool:
    """True when ``code`` is a well-formed recovery code with a valid checksum."""
    try:
        secret = _decode_recovery_code(code)
    except ValueError:
        return False
    secret[:] = bytes(len(secret))
    return True


def _require_qor_address(address: str, caller: str) -> str:
    """Return ``address`` lower-cased, or raise unless it is a ``qor1`` bech32 address."""
    from bech32 import bech32_decode, convertbits

    if isinstance(address, str):
        lowered = address.lower()
        hrp, words = bech32_decode(lowered)
        if hrp == DEFAULT_PREFIX and words is not None:
            data = convertbits(words, 5, 8, pad=False)
            if data is not None and len(data) in (20, 32):
                return lowered
    raise ValueError(f"{caller}: address must be the account's qor1 bech32 address")


def _pqc_key_from_secret(secret32: bytes | bytearray, address_lower: str) -> PqcKeypair:
    """ML-DSA-87 keypair from a 32-byte recovery secret and a lower-cased qor1 address."""
    seed_input = bytearray(f"{_KEY_DOMAIN}|{address_lower}|".encode()) + bytes(secret32)
    seed = bytearray(hashlib.shake_256(bytes(seed_input)).digest(32))
    seed_input[:] = bytes(len(seed_input))
    try:
        public_key, secret_key = ML_DSA_87.key_derive(bytes(seed))
    finally:
        seed[:] = bytes(len(seed))
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


def pqc_key_from_recovery_code(code: str, qor1_address: str) -> PqcKeypair:
    """Derive an account's ML-DSA-87 keypair from its recovery code.

    Bound to the account address, so one code never yields the same key for two
    accounts. Nothing here depends on the account's classical key.

    :param code: The ``QRC1-...`` recovery code (normalised as
        :func:`normalize_recovery_code` describes).
    :param qor1_address: The account's canonical ``qor1...`` address.
    :raises ValueError: On a malformed code, a checksum mismatch (a key is never
        derived from a mistyped code) or an address that is not ``qor1`` bech32.
    """
    address_lower = _require_qor_address(qor1_address, "pqc_key_from_recovery_code")
    secret = _decode_recovery_code(code)
    try:
        return _pqc_key_from_secret(secret, address_lower)
    finally:
        secret[:] = bytes(len(secret))


__all__ = [
    "PQC_RECOVERY_CODE_PREFIX",
    "normalize_recovery_code",
    "generate_pqc_recovery_code",
    "is_valid_recovery_code",
    "pqc_key_from_recovery_code",
    "pqc_recovery_code_from_secret",
]
