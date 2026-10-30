"""The KEM key registry (chain v3.2.5, ``x/pqc``).

An account publishes one key-encapsulation public key so that anyone can
encrypt to it: a sender reads the key from the chain, encapsulates a shared
secret to it, and only the holder of the matching secret key recovers it. The
key is not an authentication key; the account keeps signing with its ML-DSA-87
key.

* Algorithm: ML-KEM-1024 (FIPS 203), algorithm id :data:`KEM_ALGORITHM_ML_KEM_1024`
  (2). Other ids come only by governance.
* One key per account. Registering again replaces it (the response says
  ``replaced``); :data:`qorsdk.msg.pqc.remove_kem_key` withdraws it.
* No proof of possession: the registration is authenticated by the account's
  hybrid signature, which these messages always need (the account must hold a
  usable post-quantum signature key, code 254 otherwise). Both messages are
  refused through authz.
* The chain stores and serves the raw key only. The encryption itself is not
  part of this SDK.

Messages: ``msg.pqc.register_kem_key`` / ``msg.pqc.remove_kem_key``. Read:
:func:`fetch_kem_key` (``GET /qorechain/pqc/v1/kem/{address}``, bech32 or
``0x`` address).
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

from .pqc import ALGORITHM_MLKEM1024

#: Algorithm id of ML-KEM-1024 in the chain's algorithm registry
#: (the same value as :data:`qorsdk.pqc.ALGORITHM_MLKEM1024`).
KEM_ALGORITHM_ML_KEM_1024 = ALGORITHM_MLKEM1024
#: Size of an ML-KEM-1024 encapsulation (public) key, bytes.
ML_KEM_1024_PUBLIC_KEY_SIZE = 1568

#: Type URLs of the registry's messages.
REGISTER_KEM_KEY_TYPE_URL = "/qorechain.pqc.v1.MsgRegisterKEMKey"
REMOVE_KEM_KEY_TYPE_URL = "/qorechain.pqc.v1.MsgRemoveKEMKey"

# FIPS 203: q = 3329; the key is ByteEncode_12(t_hat) || rho, t_hat being
# 4 polynomials of 384 bytes.
_MLKEM_Q = 3329
_MLKEM_1024_T_HAT_BYTES = 4 * 384


def validate_kem_public_key(
    public_key: bytes, algorithm_id: int = KEM_ALGORITHM_ML_KEM_1024
) -> None:
    """The chain's stateless check on a KEM key, run by
    ``msg.pqc.register_kem_key`` before encoding.

    For ML-KEM-1024: exactly :data:`ML_KEM_1024_PUBLIC_KEY_SIZE` bytes, every
    12-bit coefficient of ``t_hat`` below 3329 (the FIPS 203 modulus check), and
    ``t_hat`` not all zero (anything encrypted to such a key is readable by
    anyone). Keys of another algorithm id are passed through; the chain checks
    them against its registry.

    :raises ValueError: Naming the problem.
    """
    if isinstance(algorithm_id, bool) or not isinstance(algorithm_id, int) or algorithm_id <= 0:
        raise ValueError(
            f"register_kem_key: algorithm_id must be a positive integer, got {algorithm_id!r}"
        )
    if not isinstance(public_key, (bytes, bytearray)) or len(public_key) == 0:
        raise ValueError("register_kem_key: public_key is required")
    if algorithm_id != KEM_ALGORITHM_ML_KEM_1024:
        return
    if len(public_key) != ML_KEM_1024_PUBLIC_KEY_SIZE:
        raise ValueError(
            f"register_kem_key: an ML-KEM-1024 public key is {ML_KEM_1024_PUBLIC_KEY_SIZE} "
            f"bytes, got {len(public_key)}"
        )
    zero = True
    for i in range(0, _MLKEM_1024_T_HAT_BYTES, 3):
        b0, b1, b2 = public_key[i], public_key[i + 1], public_key[i + 2]
        c0 = b0 | (b1 & 0x0F) << 8
        c1 = b1 >> 4 | b2 << 4
        if c0 >= _MLKEM_Q or c1 >= _MLKEM_Q:
            raise ValueError(
                f"register_kem_key: the coefficient at byte {i} is not reduced modulo "
                f"{_MLKEM_Q}; the key fails the FIPS 203 encapsulation key check"
            )
        if c0 or c1:
            zero = False
    if zero:
        raise ValueError(
            "register_kem_key: the key's t_hat part is all zero, so anything encrypted "
            "to it would be readable by anyone"
        )


# --------------------------------------------------------------------------- #
# Read
# --------------------------------------------------------------------------- #


def kem_key_path(address: str) -> str:
    """The REST path of ``address``'s KEM key (bech32 or ``0x`` hex)."""
    return f"/qorechain/pqc/v1/kem/{quote(address, safe='')}"


@dataclass(frozen=True)
class KemKey:
    """A published KEM key."""

    #: The bech32 account that published it.
    address: str
    algorithm_id: int
    #: The chain's name for the algorithm (``"mlkem1024"``).
    algorithm_name: str
    public_key: bytes
    #: Height of the registration that published this key.
    registered_height: int


@dataclass(frozen=True)
class KemKeyResult:
    """The answer of the KEM key query."""

    found: bool
    key: KemKey | None


def _int(raw: Any, field: str) -> int:
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"kem field {field!r} is a boolean, expected an integer")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(f"kem field {field!r} is not an integer: {raw!r}") from None
    raise ValueError(f"kem field {field!r} is not an integer: {raw!r}")


def _text(payload: Mapping[str, Any], field: str) -> str:
    raw = payload.get(field)
    return raw if isinstance(raw, str) else ""


def parse_kem_key(payload: Mapping[str, Any]) -> KemKeyResult:
    """Parse a ``/qorechain/pqc/v1/kem/{address}`` payload."""
    raw = payload.get("key") if isinstance(payload, Mapping) else None
    if not (isinstance(payload, Mapping) and payload.get("found") is True) or not isinstance(
        raw, Mapping
    ):
        return KemKeyResult(found=False, key=None)
    pk = raw.get("public_key")
    return KemKeyResult(
        found=True,
        key=KemKey(
            address=_text(raw, "address"),
            algorithm_id=_int(raw.get("algorithm_id"), "algorithm_id"),
            algorithm_name=_text(raw, "algorithm_name"),
            public_key=base64.b64decode(pk) if isinstance(pk, str) and pk else b"",
            registered_height=_int(raw.get("registered_height"), "registered_height"),
        ),
    )


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def fetch_kem_key(rest: _RestGet, address: str) -> KemKeyResult:
    """Read the KEM key ``address`` published, if any.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    :param address: Bech32 (``qor1…``) or ``0x`` hex.
    """
    return parse_kem_key(rest.get(kem_key_path(address)))


async def fetch_kem_key_async(rest: _AsyncRestGet, address: str) -> KemKeyResult:
    """Asynchronous mirror of :func:`fetch_kem_key`."""
    return parse_kem_key(await rest.get(kem_key_path(address)))


__all__ = [
    "KEM_ALGORITHM_ML_KEM_1024",
    "ML_KEM_1024_PUBLIC_KEY_SIZE",
    "REGISTER_KEM_KEY_TYPE_URL",
    "REMOVE_KEM_KEY_TYPE_URL",
    "validate_kem_public_key",
    "kem_key_path",
    "KemKey",
    "KemKeyResult",
    "parse_kem_key",
    "fetch_kem_key",
    "fetch_kem_key_async",
]
