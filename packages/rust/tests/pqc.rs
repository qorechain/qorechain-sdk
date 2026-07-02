//! ML-DSA-87 PQC primitive and hybrid-extension tests.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use qorechain::pqc::{
    build_hybrid_signature_extension, generate_pqc_keypair, pqc_sign, pqc_verify,
    ALGORITHM_DILITHIUM5, ALGORITHM_MLKEM1024, HYBRID_SIG_TYPE_URL, MLDSA87_PUBLIC_KEY_LEN,
    MLDSA87_SECRET_KEY_LEN, MLDSA87_SIGNATURE_LEN,
};

#[test]
fn algorithm_constants() {
    assert_eq!(ALGORITHM_DILITHIUM5, 1);
    assert_eq!(ALGORITHM_MLKEM1024, 2);
    assert_eq!(HYBRID_SIG_TYPE_URL, "/qorechain.pqc.v1.PQCHybridSignature");
}

#[test]
fn key_and_signature_sizes() {
    assert_eq!(MLDSA87_PUBLIC_KEY_LEN, 2592);
    assert_eq!(MLDSA87_SECRET_KEY_LEN, 4896);
    assert_eq!(MLDSA87_SIGNATURE_LEN, 4627);

    let kp = generate_pqc_keypair().unwrap();
    assert_eq!(kp.public_key.len(), 2592);
    assert_eq!(kp.secret_key.len(), 4896);

    let sig = pqc_sign(&kp.secret_key, b"hello qorechain").unwrap();
    assert_eq!(sig.len(), 4627);
}

#[test]
fn sign_and_verify_round_trip() {
    let kp = generate_pqc_keypair().unwrap();
    let msg = b"the quantum fox jumps over the lazy dog";
    let sig = pqc_sign(&kp.secret_key, msg).unwrap();
    assert!(pqc_verify(&kp.public_key, msg, &sig));
}

#[test]
fn tampered_message_fails_verification() {
    let kp = generate_pqc_keypair().unwrap();
    let sig = pqc_sign(&kp.secret_key, b"original message").unwrap();
    assert!(!pqc_verify(&kp.public_key, b"tampered message", &sig));

    // Tampered signature byte.
    let mut bad_sig = sig.clone();
    bad_sig[0] ^= 0xff;
    assert!(!pqc_verify(&kp.public_key, b"original message", &bad_sig));

    // Wrong public key.
    let other = generate_pqc_keypair().unwrap();
    assert!(!pqc_verify(&other.public_key, b"original message", &sig));
}

#[test]
fn extension_json_shape_with_public_key() {
    let kp = generate_pqc_keypair().unwrap();
    let sig = pqc_sign(&kp.secret_key, b"tx bytes").unwrap();

    let ext =
        build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &sig, Some(&kp.public_key)).unwrap();
    let v: serde_json::Value = serde_json::to_value(&ext).unwrap();

    assert_eq!(v["algorithm_id"], 1);
    let sig_b64 = v["pqc_signature"].as_str().unwrap();
    let pk_b64 = v["pqc_public_key"].as_str().unwrap();

    // Standard (padded) base64 that decodes back to the exact bytes.
    assert_eq!(BASE64.decode(sig_b64).unwrap(), sig);
    assert_eq!(BASE64.decode(pk_b64).unwrap(), kp.public_key);
    assert_eq!(sig_b64, BASE64.encode(&sig));
}

#[test]
fn extension_omits_public_key_when_absent() {
    let kp = generate_pqc_keypair().unwrap();
    let sig = pqc_sign(&kp.secret_key, b"tx bytes").unwrap();

    let ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &sig, None).unwrap();
    let v: serde_json::Value = serde_json::to_value(&ext).unwrap();

    assert_eq!(v["algorithm_id"], 1);
    assert!(v.get("pqc_public_key").is_none());
    assert!(v.get("pqc_signature").is_some());
}

#[test]
fn extension_rejects_invalid_input() {
    // Non-signature algorithm.
    assert!(build_hybrid_signature_extension(ALGORITHM_MLKEM1024, &[1u8; 4627], None).is_err());
    // Empty signature.
    assert!(build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &[], None).is_err());
    // Wrong signature length.
    assert!(build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &[1u8; 10], None).is_err());
    // Wrong public-key length.
    assert!(
        build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &[1u8; 4627], Some(&[1u8; 10]))
            .is_err()
    );
}

// --- deterministic signing (chain requirement) -------------------------------
//
// The chain's PQC verifier accepts ONLY deterministic (FIPS-204 §3.4,
// rnd = 32 zero bytes) ML-DSA-87 signatures; hedged signing is rejected with
// codespace "pqc". These tests pin the deterministic default against the
// shared qorechain-pqc vectors.

fn from_hex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd-length hex");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("bad hex"))
        .collect()
}

fn vector_cases() -> Vec<serde_json::Value> {
    let raw = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/ml-dsa-87-deterministic.json"
    ))
    .expect("read vectors");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("parse vectors");
    v["cases"].as_array().expect("cases").clone()
}

#[test]
fn pqc_sign_is_deterministic() {
    let kp = generate_pqc_keypair().unwrap();
    let msg = b"deterministic ML-DSA-87 required by the chain";
    let a = pqc_sign(&kp.secret_key, msg).unwrap();
    let b = pqc_sign(&kp.secret_key, msg).unwrap();
    assert_eq!(a, b, "two signatures over the same input must be identical");
}

#[test]
fn pqc_sign_matches_shared_deterministic_vectors() {
    for case in vector_cases() {
        let secret_key = from_hex(case["secretKey"].as_str().unwrap());
        let public_key = from_hex(case["publicKey"].as_str().unwrap());
        let message = from_hex(case["message"].as_str().unwrap());
        let expected = from_hex(case["signature"].as_str().unwrap());

        let sig = pqc_sign(&secret_key, &message).unwrap();
        assert_eq!(sig, expected, "signature must match the shared vector");
        assert!(pqc_verify(&public_key, &message, &sig));
    }
}

#[test]
fn pqc_sign_hedged_opt_in_differs_but_verifies() {
    let kp = generate_pqc_keypair().unwrap();
    let msg = b"hedged signatures are NOT accepted by the chain";
    let det = pqc_sign(&kp.secret_key, msg).unwrap();
    let hedged = qorechain::pqc::pqc_sign_hedged(&kp.secret_key, msg).unwrap();
    assert_ne!(det, hedged);
    assert!(pqc_verify(&kp.public_key, msg, &hedged));
}
