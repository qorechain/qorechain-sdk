import pytest

from qorsdk import (
    derive_evm_account,
    derive_native_account,
    derive_svm_account,
    generate_mnemonic,
    validate_mnemonic,
)

# The public BIP-39 test mnemonic (Hardhat / Anvil default account 0).
TEST_MNEMONIC = "test test test test test test test test test test test junk"

# Known-answer vectors from the QoreChain TypeScript SDK. If any of these break,
# the Python derivation has diverged from the TS surface — a cross-language bug.
EVM_IDX0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
EVM_IDX1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
NATIVE_IDX0 = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu"
NATIVE_IDX1 = "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq"
SVM_IDX0 = "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96"


def test_evm_known_answer():
    assert derive_evm_account(TEST_MNEMONIC, 0).address == EVM_IDX0
    assert derive_evm_account(TEST_MNEMONIC, 1).address == EVM_IDX1


def test_native_known_answer():
    assert derive_native_account(TEST_MNEMONIC, 0).address == NATIVE_IDX0
    assert derive_native_account(TEST_MNEMONIC, 1).address == NATIVE_IDX1


def test_svm_known_answer():
    acct = derive_svm_account(TEST_MNEMONIC, 0)
    assert acct.address == SVM_IDX0
    assert len(acct.public_key) == 32
    assert len(acct.secret_key) == 64
    # Solana secret-key layout: last 32 bytes == public key.
    assert acct.secret_key[32:] == acct.public_key


def test_account_types():
    assert derive_native_account(TEST_MNEMONIC).type == "native"
    assert derive_evm_account(TEST_MNEMONIC).type == "evm"
    assert derive_svm_account(TEST_MNEMONIC).type == "svm"


def test_determinism():
    a = derive_native_account(TEST_MNEMONIC, 0)
    b = derive_native_account(TEST_MNEMONIC, 0)
    assert a == b


def test_different_index_different_address():
    assert derive_native_account(TEST_MNEMONIC, 0).address != derive_native_account(
        TEST_MNEMONIC, 1
    ).address
    assert derive_evm_account(TEST_MNEMONIC, 0).address != derive_evm_account(
        TEST_MNEMONIC, 1
    ).address
    assert derive_svm_account(TEST_MNEMONIC, 0).address != derive_svm_account(
        TEST_MNEMONIC, 1
    ).address


def test_secp256k1_private_key_length():
    assert len(derive_native_account(TEST_MNEMONIC).private_key) == 32
    assert len(derive_evm_account(TEST_MNEMONIC).private_key) == 32


def test_native_public_key_compressed():
    assert len(derive_native_account(TEST_MNEMONIC).public_key) == 33


def test_validate_mnemonic():
    assert validate_mnemonic(TEST_MNEMONIC) is True
    # Valid words, wrong checksum.
    assert validate_mnemonic("test test test test test test test test test test test test") is False
    assert validate_mnemonic("not a real mnemonic phrase at all here ok") is False


@pytest.mark.parametrize("derive", [derive_native_account, derive_evm_account, derive_svm_account])
def test_derive_rejects_invalid_mnemonic(derive):
    with pytest.raises(ValueError, match="invalid mnemonic"):
        derive("clearly not a valid bip39 mnemonic phrase here")


def test_generate_mnemonic():
    m12 = generate_mnemonic()
    assert len(m12.split()) == 12
    assert validate_mnemonic(m12)
    m24 = generate_mnemonic(256)
    assert len(m24.split()) == 24
    assert validate_mnemonic(m24)


def test_generate_mnemonic_bad_strength():
    with pytest.raises(ValueError):
        generate_mnemonic(100)


def test_negative_index_rejected():
    with pytest.raises(ValueError):
        derive_native_account(TEST_MNEMONIC, -1)
