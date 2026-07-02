import base64
import json
from pathlib import Path

import pytest

from qorsdk import (
    ALGORITHM_DILITHIUM5,
    ALGORITHM_MLKEM1024,
    ALGORITHM_UNSPECIFIED,
    HYBRID_SIG_TYPE_URL,
    ML_DSA_87_PUBLIC_KEY_LENGTH,
    ML_DSA_87_SECRET_KEY_LENGTH,
    ML_DSA_87_SIGNATURE_LENGTH,
    algorithm_name,
    build_hybrid_signature_extension,
    generate_pqc_keypair,
    is_signature_algorithm,
    pqc_sign,
    pqc_verify,
)

MSG = b"qorechain hybrid signature test"


def test_key_and_signature_sizes():
    kp = generate_pqc_keypair()
    assert len(kp.public_key) == ML_DSA_87_PUBLIC_KEY_LENGTH == 2592
    assert len(kp.secret_key) == ML_DSA_87_SECRET_KEY_LENGTH == 4896
    sig = pqc_sign(kp.secret_key, MSG)
    assert len(sig) == ML_DSA_87_SIGNATURE_LENGTH == 4627


def test_sign_verify_round_trip():
    kp = generate_pqc_keypair()
    sig = pqc_sign(kp.secret_key, MSG)
    assert pqc_verify(kp.public_key, MSG, sig) is True


def test_verify_fails_on_tampered_message():
    kp = generate_pqc_keypair()
    sig = pqc_sign(kp.secret_key, MSG)
    assert pqc_verify(kp.public_key, MSG + b"!", sig) is False


def test_verify_fails_on_tampered_signature():
    kp = generate_pqc_keypair()
    sig = bytearray(pqc_sign(kp.secret_key, MSG))
    sig[0] ^= 0xFF
    assert pqc_verify(kp.public_key, MSG, bytes(sig)) is False


def test_distinct_keypairs():
    assert generate_pqc_keypair().public_key != generate_pqc_keypair().public_key


def test_algorithm_constants():
    assert ALGORITHM_UNSPECIFIED == 0
    assert ALGORITHM_DILITHIUM5 == 1
    assert ALGORITHM_MLKEM1024 == 2
    assert algorithm_name(ALGORITHM_DILITHIUM5) == "dilithium5"
    assert algorithm_name(ALGORITHM_MLKEM1024) == "mlkem1024"
    assert algorithm_name(ALGORITHM_UNSPECIFIED) == "unspecified"
    assert algorithm_name(99) == "algorithm_99"
    assert is_signature_algorithm(ALGORITHM_DILITHIUM5) is True
    assert is_signature_algorithm(ALGORITHM_MLKEM1024) is False


def test_type_url_constant():
    assert HYBRID_SIG_TYPE_URL == "/qorechain.pqc.v1.PQCHybridSignature"


def test_build_extension_without_public_key():
    kp = generate_pqc_keypair()
    sig = pqc_sign(kp.secret_key, MSG)
    ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, sig)
    assert ext["algorithm_id"] == 1
    assert "pqc_public_key" not in ext
    # Standard base64 with padding; round-trips to the raw signature.
    assert base64.b64decode(ext["pqc_signature"]) == sig


def test_build_extension_with_public_key():
    kp = generate_pqc_keypair()
    sig = pqc_sign(kp.secret_key, MSG)
    ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, sig, kp.public_key)
    assert base64.b64decode(ext["pqc_public_key"]) == kp.public_key
    assert base64.b64decode(ext["pqc_signature"]) == sig


def test_build_extension_rejects_non_signature_algorithm():
    with pytest.raises(ValueError, match="not a PQC signature"):
        build_hybrid_signature_extension(ALGORITHM_MLKEM1024, b"x" * 4627)


def test_build_extension_rejects_empty_signature():
    with pytest.raises(ValueError, match="cannot be empty"):
        build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, b"")


def test_build_extension_rejects_wrong_signature_length():
    with pytest.raises(ValueError, match="must be 4627 bytes"):
        build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, b"x" * 100)


def test_build_extension_rejects_wrong_public_key_length():
    with pytest.raises(ValueError, match="public key must be 2592"):
        build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, b"x" * 4627, b"y" * 10)


# --- deterministic signing (chain requirement) --------------------------------

# The chain's PQC verifier accepts ONLY deterministic (FIPS-204 §3.4,
# rnd = 32 zero bytes) ML-DSA-87 signatures; hedged signing is rejected with
# codespace "pqc". These tests pin the deterministic default.

_VECTORS_PATH = Path(__file__).parent / "fixtures" / "ml_dsa_87_deterministic.json"


def _vectors() -> list[dict]:
    return json.loads(_VECTORS_PATH.read_text())["cases"]


def test_pqc_sign_is_deterministic():
    kp = generate_pqc_keypair()
    message = b"deterministic ML-DSA-87 required by the chain"
    assert pqc_sign(kp.secret_key, message) == pqc_sign(kp.secret_key, message)


def test_pqc_sign_matches_shared_deterministic_vectors():
    for case in _vectors():
        secret_key = bytes.fromhex(case["secretKey"])
        public_key = bytes.fromhex(case["publicKey"])
        message = bytes.fromhex(case["message"])
        expected = bytes.fromhex(case["signature"])
        signature = pqc_sign(secret_key, message)
        assert signature == expected
        assert pqc_verify(public_key, message, signature)


def test_pqc_sign_hedged_opt_in_differs_but_verifies():
    kp = generate_pqc_keypair()
    message = b"hedged signatures are NOT accepted by the chain"
    det = pqc_sign(kp.secret_key, message)
    hedged = pqc_sign(kp.secret_key, message, hedged=True)
    assert hedged != det
    assert pqc_verify(kp.public_key, message, hedged)
