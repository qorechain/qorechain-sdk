//! v3.1.85 authenticator sign-bytes KATs (byte-exact against
//! `@qorechain/wallet-adapter`'s `authenticator.js`) and the
//! rotate-from-mnemonic dual-signing path.

use qorechain::authenticator::{
    canonical_account, cosmos_auth_sign_bytes, derive_pqc_canonical, derive_pqc_legacy,
    evm_auth_sign_bytes, rotate_pqc_key_msg_from_mnemonic, rotation_sign_bytes,
    try_derive_pqc_canonical, RotateFromMnemonicOptions,
};
use qorechain::pqc::pqc_verify;
use sha2::{Digest, Sha256};

// Cross-language vector, produced by the Go SDK
// (`authenticator.TestDerivePQCCanonicalNormalisesAccount`): every encoding of
// one account resolves to its lower-case bech32 form before hashing.
const VEC_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const VEC_COSMOS: &str = "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c";
const VEC_EVM: &str = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const VEC_CANONICAL_SHA256: &str =
    "3d7bd2b98be09288b43a2fa18049789782d35c408f93099724417249707d1585";

fn vec_inputs() -> Vec<String> {
    vec![
        VEC_COSMOS.to_string(),
        VEC_COSMOS.to_uppercase(),
        VEC_EVM.to_string(),
        VEC_EVM.to_lowercase(),
        format!("0X{}", VEC_EVM[2..].to_uppercase()),
    ]
}

#[test]
fn canonical_derivation_normalises_account_like_go() {
    for input in vec_inputs() {
        assert_eq!(canonical_account(&input).unwrap(), VEC_COSMOS, "{input}");
        let kp = try_derive_pqc_canonical(&input, VEC_MNEMONIC).unwrap();
        assert_eq!(
            hex::encode(Sha256::digest(&kp.public_key)),
            VEC_CANONICAL_SHA256,
            "{input}"
        );
        // The infallible form agrees for every valid encoding.
        assert_eq!(
            derive_pqc_canonical(&input, VEC_MNEMONIC).public_key,
            kp.public_key
        );
    }
    let mixed = format!("Qor1{}", &VEC_COSMOS[4..]);
    for bad in ["qor1abc", mixed.as_str(), "0x1234"] {
        assert!(canonical_account(bad).is_err(), "{bad}");
        assert!(
            try_derive_pqc_canonical(bad, VEC_MNEMONIC).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn rotation_normalises_sender_and_sign_bytes_like_go() {
    let chain_id = "qorechain-diana";
    for input in vec_inputs() {
        let opts = RotateFromMnemonicOptions::new(&input, VEC_MNEMONIC, chain_id);
        let rot = rotate_pqc_key_msg_from_mnemonic(&opts).expect("rotate");
        assert_eq!(rot.msg.sender, VEC_COSMOS, "{input}");
        assert_eq!(
            hex::encode(Sha256::digest(&rot.new_keypair.public_key)),
            VEC_CANONICAL_SHA256
        );
        let sb = rotation_sign_bytes(
            chain_id,
            1,
            VEC_COSMOS,
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
    }
}

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
    let s = rotation_sign_bytes(
        "qorechain-diana",
        1,
        "qor1test",
        &[0xaa, 0xaa],
        &[0xbb, 0xbb],
    );
    assert_eq!(
        s,
        "qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb"
    );
}

/// The framing is length-prefixed: a field boundary shift (moving a byte from
/// `to` into `value`) changes the EVM digest - the LP(len) prefix is load-bearing.
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
    let account = VEC_COSMOS;
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
    let account = VEC_COSMOS;
    let chain_id = "qorechain-diana";

    let opts = RotateFromMnemonicOptions::new(account, mnemonic, chain_id);
    let rot = rotate_pqc_key_msg_from_mnemonic(&opts).expect("rotate");

    // Sender is the account; the keys match the two derivations.
    assert_eq!(rot.msg.sender, account);
    assert_eq!(rot.msg.old_public_key, rot.old_keypair.public_key);
    assert_eq!(rot.msg.new_public_key, rot.new_keypair.public_key);
    assert_eq!(
        rot.old_keypair.public_key,
        derive_pqc_legacy(mnemonic).public_key
    );
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
    let account = VEC_COSMOS;
    let mut opts = RotateFromMnemonicOptions::new(account, mnemonic, "qorechain-diana");
    opts.old_derivation = opts.new_derivation; // adapter -> adapter
    let err = rotate_pqc_key_msg_from_mnemonic(&opts).unwrap_err();
    assert!(err.to_string().contains("no-op"), "got: {err}");
}

/// The legacy derivation is deprecated for NEW keys; it stays valid as the old key.
#[test]
fn rotate_from_mnemonic_refuses_a_new_legacy_key() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let mut opts = RotateFromMnemonicOptions::new(VEC_COSMOS, mnemonic, "qorechain-diana");
    opts.old_derivation = "adapter";
    opts.new_derivation = "bridge";
    let err = rotate_pqc_key_msg_from_mnemonic(&opts).unwrap_err();
    assert!(
        err.to_string().contains("deprecated for new keys"),
        "got: {err}"
    );
}

/// An unknown derivation scheme is rejected.
#[test]
fn rotate_from_mnemonic_rejects_unknown_scheme() {
    let mnemonic =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let account = VEC_COSMOS;
    let mut opts = RotateFromMnemonicOptions::new(account, mnemonic, "qorechain-diana");
    opts.old_derivation = "nope";
    let err = rotate_pqc_key_msg_from_mnemonic(&opts).unwrap_err();
    assert!(err.to_string().contains("unknown derivation"), "got: {err}");
}
