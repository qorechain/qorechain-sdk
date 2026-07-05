//! v3.1.85 authenticator sign-bytes KATs (byte-exact against
//! `@qorechain/wallet-adapter`'s `authenticator.js`) and the
//! rotate-from-mnemonic dual-signing path.

use qorechain::authenticator::{
    cosmos_auth_sign_bytes, derive_pqc_canonical, derive_pqc_legacy, evm_auth_sign_bytes,
    rotate_pqc_key_msg_from_mnemonic, rotation_sign_bytes, RotateFromMnemonicOptions,
};
use qorechain::pqc::pqc_verify;

/// The KAT authenticator pubkey: 32 bytes of 0x01.
fn kat_pubkey() -> Vec<u8> {
    vec![1u8; 32]
}

/// EVM auth sign-bytes match the adapter KAT byte-for-byte.
#[test]
fn evm_auth_sign_bytes_kat() {
    let digest = evm_auth_sign_bytes(
        "qorechain-diana",
        "qor1test",
        &kat_pubkey(),
        "0xabc",
        "1000",
        &[2, 2, 2],
        5,
    );
    assert_eq!(
        hex::encode(digest),
        "8661921e6d37dff44e97d4a05d4efbfd3fd8ea631201479c2bbf1cb41ade7025"
    );
}

/// Cosmos auth sign-bytes match the adapter KAT byte-for-byte.
#[test]
fn cosmos_auth_sign_bytes_kat() {
    let digest = cosmos_auth_sign_bytes(
        "qorechain-diana",
        "qor1test",
        &kat_pubkey(),
        "qor1recv",
        "100uqor",
        3,
    );
    assert_eq!(
        hex::encode(digest),
        "5e203ef47b5fe63d0fc9c8909aecb124b32b173f8b96700003ba1d8fa0114f0f"
    );
}

/// Rotation sign-bytes string matches the adapter KAT exactly.
#[test]
fn rotation_sign_bytes_kat() {
    let s = rotation_sign_bytes("qorechain-diana", 1, "qor1test", &[0xaa, 0xaa], &[0xbb, 0xbb]);
    assert_eq!(
        s,
        "qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb"
    );
}

/// The framing is length-prefixed: a field boundary shift (moving a byte from
/// `to` into `value`) changes the EVM digest — the LP(len) prefix is load-bearing.
#[test]
fn evm_sign_bytes_are_field_boundary_sensitive() {
    let a = evm_auth_sign_bytes("c", "acct", &kat_pubkey(), "ab", "c", &[], 1);
    let b = evm_auth_sign_bytes("c", "acct", &kat_pubkey(), "a", "bc", &[], 1);
    assert_ne!(a, b, "length-prefix framing must disambiguate field splits");
}

/// The nonce is bound into the digest (replay protection): bumping it changes the
/// digest for both lanes.
#[test]
fn nonce_is_bound_into_sign_bytes() {
    let pk = kat_pubkey();
    assert_ne!(
        evm_auth_sign_bytes("c", "a", &pk, "0x", "0", &[], 1),
        evm_auth_sign_bytes("c", "a", &pk, "0x", "0", &[], 2),
    );
    assert_ne!(
        cosmos_auth_sign_bytes("c", "a", &pk, "r", "1uqor", 1),
        cosmos_auth_sign_bytes("c", "a", &pk, "r", "1uqor", 2),
    );
}

/// The legacy and canonical derivations differ (address-bound vs mnemonic-only),
/// which is what makes a legacy→canonical rotation non-trivial.
#[test]
fn legacy_and_canonical_derivations_differ() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let account = "qor1account00000000000000000000000000000000";
    let legacy = derive_pqc_legacy(mnemonic);
    let canonical = derive_pqc_canonical(account, mnemonic);
    assert_eq!(legacy.public_key.len(), qorechain::MLDSA87_PUBLIC_KEY_LEN);
    assert_ne!(legacy.public_key, canonical.public_key);
    // Legacy derivation is address-independent; canonical binds the address.
    let legacy2 = derive_pqc_legacy(mnemonic);
    assert_eq!(legacy.public_key, legacy2.public_key);
    let canonical_other = derive_pqc_canonical("qor1other", mnemonic);
    assert_ne!(canonical.public_key, canonical_other.public_key);
}

/// `rotate_pqc_key_msg_from_mnemonic` builds a MsgRotatePQCKey dual-signed by the
/// old and new keys over the domain-separated rotation bytes, both verifying.
#[test]
fn rotate_from_mnemonic_is_dual_signed() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let account = "qor1account00000000000000000000000000000000";
    let chain_id = "qorechain-diana";

    let opts = RotateFromMnemonicOptions::new(account, mnemonic, chain_id);
    let rot = rotate_pqc_key_msg_from_mnemonic(&opts).expect("rotate");

    // Sender is the account; the keys match the two derivations.
    assert_eq!(rot.msg.sender, account);
    assert_eq!(rot.msg.old_public_key, rot.old_keypair.public_key);
    assert_eq!(rot.msg.new_public_key, rot.new_keypair.public_key);
    assert_eq!(rot.old_keypair.public_key, derive_pqc_legacy(mnemonic).public_key);
    assert_eq!(
        rot.new_keypair.public_key,
        derive_pqc_canonical(account, mnemonic).public_key
    );

    // Both signatures verify against the exact rotation sign-bytes.
    let sb = rotation_sign_bytes(
        chain_id,
        1,
        account,
        &rot.msg.old_public_key,
        &rot.msg.new_public_key,
    );
    assert!(pqc_verify(
        &rot.msg.old_public_key,
        sb.as_bytes(),
        &rot.msg.old_signature
    ));
    assert!(pqc_verify(
        &rot.msg.new_public_key,
        sb.as_bytes(),
        &rot.msg.new_signature
    ));
    // Cross-check: the old signature does NOT verify under the new key.
    assert!(!pqc_verify(
        &rot.msg.new_public_key,
        sb.as_bytes(),
        &rot.msg.old_signature
    ));
}

/// Rotating a derivation onto itself is rejected as a no-op.
#[test]
fn rotate_from_mnemonic_rejects_no_op() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let account = "qor1account00000000000000000000000000000000";
    let mut opts = RotateFromMnemonicOptions::new(account, mnemonic, "qorechain-diana");
    opts.new_derivation = opts.old_derivation; // bridge -> bridge
    let err = rotate_pqc_key_msg_from_mnemonic(&opts).unwrap_err();
    assert!(err.to_string().contains("no-op"), "got: {err}");
}

/// An unknown derivation scheme is rejected.
#[test]
fn rotate_from_mnemonic_rejects_unknown_scheme() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let account = "qor1account00000000000000000000000000000000";
    let mut opts = RotateFromMnemonicOptions::new(account, mnemonic, "qorechain-diana");
    opts.old_derivation = "nope";
    let err = rotate_pqc_key_msg_from_mnemonic(&opts).unwrap_err();
    assert!(err.to_string().contains("unknown derivation"), "got: {err}");
}
