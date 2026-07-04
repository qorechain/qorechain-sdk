"""Known-answer + property tests for the unified eth-native wallet.

The address vectors and PQC-pubkey determinism vectors come from
``@qorechain/wallet-adapter`` (0.1.5). If any break, the Python derivation has
diverged from the canonical wallet — a cross-language / cross-chain bug.
"""

from __future__ import annotations

import pytest

from qorsdk import (
    UnifiedAccount,
    addresses_from_20,
    derive_unified_account,
    qore_addresses,
    unified_account_from_phantom_signature,
    unified_account_from_seed,
)

TEST_MNEMONIC = "test test test test test test test test test test test junk"

# Address KATs (mnemonic idx0).
MN_COSMOS = "qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z"
MN_EVM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
MN_SVM = "HQ1S8pxTw4YN41GPdWYPQVfweQveXAUtfFnZNmvPfrYf"
MN_PQC_PUB_PREFIX = "4a685622f2a99d54"

# Address KATs (seed = 32 × 0x01).
SEED32 = bytes([1]) * 32
SEED_COSMOS = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"
SEED_EVM = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1"
SEED_SVM = "2n2Cnc7fib6rm4Azo1mbvMuHB3iCb1J254kEQDcrHyPu"
SEED_PQC_PUB_PREFIX = "2d7f888fecbe5b24"


def test_derive_unified_account_mnemonic_known_answer():
    a = derive_unified_account(TEST_MNEMONIC, 0)
    assert a.cosmos == MN_COSMOS
    assert a.evm == MN_EVM
    assert a.svm == MN_SVM
    # PQC keypair is deterministic + correctly sized (ML-DSA-87: 2592 / 4896).
    assert len(a.pqc.public_key) == 2592
    assert len(a.pqc.secret_key) == 4896
    assert a.pqc.public_key[:8].hex() == MN_PQC_PUB_PREFIX


def test_unified_account_from_seed_known_answer():
    b = unified_account_from_seed(SEED32)
    assert b.cosmos == SEED_COSMOS
    assert b.evm == SEED_EVM
    assert b.svm == SEED_SVM
    # Seed path: privkey == seed verbatim; PQC seed uses the "seed:" prefix.
    assert b.private_key == SEED32
    assert b.pqc.public_key[:8].hex() == SEED_PQC_PUB_PREFIX


def test_unified_account_shape_and_types():
    a = derive_unified_account(TEST_MNEMONIC, 0)
    assert isinstance(a, UnifiedAccount)
    assert len(a.private_key) == 32
    assert len(a.public_key) == 33  # compressed secp256k1
    assert len(a.address_bytes) == 20
    assert a.private_key_hex == "0x" + a.private_key.hex()
    assert a.public_key_hex == "0x" + a.public_key.hex()


def test_addresses_from_20_matches_derivation():
    a = derive_unified_account(TEST_MNEMONIC, 0)
    enc = addresses_from_20(a.address_bytes)
    assert enc == {"cosmos": a.cosmos, "evm": a.evm, "svm": a.svm}


def test_addresses_from_20_rejects_bad_length():
    with pytest.raises(ValueError):
        addresses_from_20(bytes(19))


def test_qore_addresses_from_each_form_agree():
    a = derive_unified_account(TEST_MNEMONIC, 0)
    from_evm = qore_addresses(evm=a.evm)
    from_cosmos = qore_addresses(cosmos=a.cosmos)
    from_hex = qore_addresses(hex=a.address_bytes.hex())
    assert from_evm == from_cosmos == from_hex
    assert from_evm["cosmos"] == a.cosmos


def test_qore_addresses_requires_one_input():
    with pytest.raises(ValueError):
        qore_addresses()


def test_index_changes_account():
    a0 = derive_unified_account(TEST_MNEMONIC, 0)
    a1 = derive_unified_account(TEST_MNEMONIC, 1)
    assert a0.cosmos != a1.cosmos
    assert a0.evm != a1.evm


def test_invalid_mnemonic_rejected():
    with pytest.raises(ValueError):
        derive_unified_account("not a valid mnemonic phrase at all")


def test_negative_index_rejected():
    with pytest.raises(ValueError):
        derive_unified_account(TEST_MNEMONIC, -1)


def test_seed_must_be_32_bytes():
    with pytest.raises(ValueError):
        unified_account_from_seed(bytes(31))


def test_from_phantom_signature_is_deterministic_and_seed_based():
    import hashlib

    sig = b"\xaa" * 65
    a = unified_account_from_phantom_signature(sig)
    b = unified_account_from_phantom_signature(sig)
    assert a == b  # deterministic
    # Equivalent to unified_account_from_seed(shake256(sig, 32)).
    expected = unified_account_from_seed(hashlib.shake_256(sig).digest(32))
    assert a.cosmos == expected.cosmos
    assert a.pqc.public_key == expected.pqc.public_key
