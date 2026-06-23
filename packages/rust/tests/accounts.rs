//! Known-answer and behavioral tests for HD account derivation.
//!
//! The expected addresses below are the canonical vectors shared across the
//! QoreChain TypeScript, Python, and Go SDKs, derived from the public BIP-39
//! test mnemonic.

use qorechain::accounts::{
    derive_evm_account, derive_native_account, derive_svm_account, generate_mnemonic,
    validate_mnemonic,
};

const TEST_MNEMONIC: &str = "test test test test test test test test test test test junk";

#[test]
fn evm_known_answer_vectors() {
    let a0 = derive_evm_account(TEST_MNEMONIC, 0).unwrap();
    assert_eq!(a0.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    assert_eq!(a0.account_type, "evm");
    assert_eq!(a0.public_key.len(), 33);
    assert_eq!(a0.private_key.len(), 32);

    let a1 = derive_evm_account(TEST_MNEMONIC, 1).unwrap();
    assert_eq!(a1.address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
}

#[test]
fn native_known_answer_vectors() {
    let a0 = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    assert_eq!(a0.address, "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu");
    assert_eq!(a0.account_type, "native");
    assert!(a0.address.starts_with("qor1"));
    assert_eq!(a0.public_key.len(), 33);
    assert_eq!(a0.private_key.len(), 32);

    let a1 = derive_native_account(TEST_MNEMONIC, 1).unwrap();
    assert_eq!(a1.address, "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq");
}

#[test]
fn svm_known_answer_vector() {
    let a0 = derive_svm_account(TEST_MNEMONIC, 0).unwrap();
    assert_eq!(a0.address, "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96");
    assert_eq!(a0.account_type, "svm");
    assert_eq!(a0.public_key.len(), 32);
    assert_eq!(a0.secret_key.len(), 64);
    // Solana secret-key form: seed32 || pubkey32.
    assert_eq!(&a0.secret_key[32..], &a0.public_key[..]);
}

#[test]
fn derivation_is_deterministic() {
    let a = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let b = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    assert_eq!(a.address, b.address);
    assert_eq!(a.private_key, b.private_key);
}

#[test]
fn different_index_yields_different_account() {
    let a0 = derive_evm_account(TEST_MNEMONIC, 0).unwrap();
    let a1 = derive_evm_account(TEST_MNEMONIC, 1).unwrap();
    assert_ne!(a0.address, a1.address);
    assert_ne!(a0.private_key, a1.private_key);
}

#[test]
fn invalid_mnemonic_is_rejected() {
    let bad = "not a valid mnemonic phrase at all here please";
    assert!(!validate_mnemonic(bad));
    assert!(derive_native_account(bad, 0).is_err());
    assert!(derive_evm_account(bad, 0).is_err());
    assert!(derive_svm_account(bad, 0).is_err());

    // Valid words but wrong checksum must also fail (fund-loss footgun).
    let wrong_checksum = "test test test test test test test test test test test test";
    assert!(!validate_mnemonic(wrong_checksum));
    assert!(derive_native_account(wrong_checksum, 0).is_err());
}

#[test]
fn valid_mnemonic_passes_validation() {
    assert!(validate_mnemonic(TEST_MNEMONIC));
}

#[test]
fn generate_mnemonic_round_trips() {
    let m12 = generate_mnemonic(128).unwrap();
    assert_eq!(m12.split_whitespace().count(), 12);
    assert!(validate_mnemonic(&m12));

    let m24 = generate_mnemonic(256).unwrap();
    assert_eq!(m24.split_whitespace().count(), 24);
    assert!(validate_mnemonic(&m24));

    assert!(generate_mnemonic(200).is_err());
}
