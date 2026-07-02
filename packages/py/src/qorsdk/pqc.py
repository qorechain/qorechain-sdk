"""Post-quantum (PQC) signing for QoreChain, using ML-DSA-87 (Dilithium-5,
NIST FIPS 204) for digital signatures.

QoreChain treats PQC as a first-class signature scheme via a hybrid
architecture: a transaction carries the usual classical (secp256k1 / ed25519)
signature PLUS an ML-DSA-87 signature attached as a ``PQCHybridSignature`` TX
extension. The chain's ante handler verifies both, so quantum-safe wallets stay
compatible with classical verification.

This module provides the signing PRIMITIVES (keygen / sign / verify) and a
builder for the on-chain hybrid-signature extension object. Crypto is delegated
to the audited, pure-Python ``dilithium-py`` (``ML_DSA_87``); no primitives are
reimplemented here.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import TypedDict

from dilithium_py.ml_dsa import ML_DSA_87

#: ML-DSA-87 public-key length, in bytes (FIPS 204 / core: 2592).
ML_DSA_87_PUBLIC_KEY_LENGTH = 2592
#: ML-DSA-87 secret-key length, in bytes (FIPS 204 / core: 4896).
ML_DSA_87_SECRET_KEY_LENGTH = 4896
#: ML-DSA-87 signature length, in bytes (FIPS 204 / core: 4627).
ML_DSA_87_SIGNATURE_LENGTH = 4627

# PQC algorithm identifiers, mirroring the chain's x/pqc framework.
#: Unset / invalid algorithm.
ALGORITHM_UNSPECIFIED = 0
#: Dilithium-5 = ML-DSA-87, NIST FIPS 204 signatures.
ALGORITHM_DILITHIUM5 = 1
#: ML-KEM-1024, NIST FIPS 203 key encapsulation.
ALGORITHM_MLKEM1024 = 2

#: The TX-extension type URL for the on-chain ``PQCHybridSignature`` message.
HYBRID_SIG_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature"


def algorithm_name(algorithm_id: int) -> str:
    """Human-readable name for an algorithm ID (matches core ``String()``)."""
    return {
        ALGORITHM_UNSPECIFIED: "unspecified",
        ALGORITHM_DILITHIUM5: "dilithium5",
        ALGORITHM_MLKEM1024: "mlkem1024",
    }.get(algorithm_id, f"algorithm_{algorithm_id}")


def is_signature_algorithm(algorithm_id: int) -> bool:
    """True if the algorithm is a digital-signature scheme."""
    return algorithm_id == ALGORITHM_DILITHIUM5


@dataclass(frozen=True)
class PqcKeypair:
    """An ML-DSA-87 (Dilithium-5) keypair. Treat ``secret_key`` as a secret."""

    public_key: bytes
    secret_key: bytes


def generate_pqc_keypair() -> PqcKeypair:
    """Generate an ML-DSA-87 (Dilithium-5) keypair."""
    public_key, secret_key = ML_DSA_87.keygen()
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


def pqc_sign(secret_key: bytes, message: bytes, *, hedged: bool = False) -> bytes:
    """Sign a message with an ML-DSA-87 (Dilithium-5) secret key.

    DETERMINISTIC (FIPS-204 §3.4, ``rnd`` = 32 zero bytes) by default: the same
    ``(secret_key, message)`` always yields the same signature. The chain's
    on-chain PQC verifier accepts ONLY deterministic ML-DSA-87 signatures
    (hedged signatures are rejected with codespace ``pqc``), so this default is
    consensus-critical — do not pass ``hedged=True`` for anything that goes
    on-chain.
    """
    return bytes(ML_DSA_87.sign(secret_key, message, deterministic=not hedged))


def pqc_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """Verify an ML-DSA-87 (Dilithium-5) signature over a message."""
    return bool(ML_DSA_87.verify(public_key, message, signature))


class HybridSignatureExtension(TypedDict, total=False):
    """The on-chain ``PQCHybridSignature`` TX extension, as a plain dict whose
    keys mirror the core struct's JSON field tags exactly.

    ``pqc_signature`` and ``pqc_public_key`` are standard base64 strings (with
    padding) matching Go's ``[]byte`` JSON encoding; ``pqc_public_key`` is
    omitted entirely when no public key is supplied (``omitempty``).
    """

    algorithm_id: int
    pqc_signature: str
    pqc_public_key: str


def build_hybrid_signature_extension(
    algorithm_id: int,
    signature: bytes,
    public_key: bytes | None = None,
) -> HybridSignatureExtension:
    """Build the on-chain ``PQCHybridSignature`` extension object.

    Validation mirrors the core ``PQCHybridSignature.Validate()``: the algorithm
    must be a signature scheme, the signature must be non-empty, and for
    Dilithium-5 the signature/public-key lengths are enforced. ``pqc_public_key``
    is omitted when ``public_key`` is ``None``.

    :raises ValueError: On an invalid algorithm, empty signature, or wrong
        Dilithium-5 lengths.
    """
    if not is_signature_algorithm(algorithm_id):
        raise ValueError(
            f"algorithm {algorithm_name(algorithm_id)} is not a PQC signature algorithm"
        )
    if len(signature) == 0:
        raise ValueError("PQC signature cannot be empty")
    if algorithm_id == ALGORITHM_DILITHIUM5:
        if len(signature) != ML_DSA_87_SIGNATURE_LENGTH:
            raise ValueError(
                f"dilithium5 signature must be {ML_DSA_87_SIGNATURE_LENGTH} bytes, "
                f"got {len(signature)}"
            )
        if public_key is not None and len(public_key) != ML_DSA_87_PUBLIC_KEY_LENGTH:
            raise ValueError(
                f"dilithium5 public key must be {ML_DSA_87_PUBLIC_KEY_LENGTH} bytes, "
                f"got {len(public_key)}"
            )

    ext: HybridSignatureExtension = {
        "algorithm_id": algorithm_id,
        "pqc_signature": base64.b64encode(signature).decode("ascii"),
    }
    if public_key is not None:
        ext["pqc_public_key"] = base64.b64encode(public_key).decode("ascii")
    return ext
