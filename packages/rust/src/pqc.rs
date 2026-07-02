//! Post-quantum (PQC) signing for QoreChain, using ML-DSA-87 (Dilithium-5,
//! NIST FIPS 204) for digital signatures.
//!
//! QoreChain treats PQC as a first-class signature scheme via a hybrid
//! architecture: a transaction carries the usual classical (secp256k1 /
//! ed25519) signature **plus** an ML-DSA-87 signature attached as a
//! `PQCHybridSignature` transaction extension. The chain's ante handler verifies
//! both, so quantum-safe wallets stay compatible with classical verification.
//!
//! This module provides the signing primitives (keygen / sign / verify) and a
//! builder for the on-chain hybrid-signature extension object. The cryptography
//! is delegated to the FIPS-204 ML-DSA-87 implementation; no primitives are
//! reimplemented here.

use crate::error::{Error, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Signer, Verifier};
use serde::{Deserialize, Serialize};

/// ML-DSA-87 public-key length, in bytes (FIPS 204).
pub const MLDSA87_PUBLIC_KEY_LEN: usize = ml_dsa_87::PK_LEN;
/// ML-DSA-87 secret-key length, in bytes (FIPS 204).
pub const MLDSA87_SECRET_KEY_LEN: usize = ml_dsa_87::SK_LEN;
/// ML-DSA-87 signature length, in bytes (FIPS 204).
pub const MLDSA87_SIGNATURE_LEN: usize = ml_dsa_87::SIG_LEN;

/// Unset / invalid algorithm.
pub const ALGORITHM_UNSPECIFIED: u32 = 0;
/// Dilithium-5 = ML-DSA-87, NIST FIPS 204 signatures.
pub const ALGORITHM_DILITHIUM5: u32 = 1;
/// ML-KEM-1024, NIST FIPS 203 key encapsulation.
pub const ALGORITHM_MLKEM1024: u32 = 2;

/// The transaction-extension type URL for the on-chain `PQCHybridSignature`
/// message.
pub const HYBRID_SIG_TYPE_URL: &str = "/qorechain.pqc.v1.PQCHybridSignature";

/// Returns the human-readable name for an algorithm ID.
pub fn algorithm_name(algorithm_id: u32) -> String {
    match algorithm_id {
        ALGORITHM_UNSPECIFIED => "unspecified".into(),
        ALGORITHM_DILITHIUM5 => "dilithium5".into(),
        ALGORITHM_MLKEM1024 => "mlkem1024".into(),
        other => format!("algorithm_{other}"),
    }
}

/// Reports whether the algorithm is a digital-signature scheme.
pub fn is_signature_algorithm(algorithm_id: u32) -> bool {
    algorithm_id == ALGORITHM_DILITHIUM5
}

/// An ML-DSA-87 (Dilithium-5) keypair. Treat `secret_key` as a secret.
#[derive(Debug, Clone)]
pub struct PqcKeypair {
    /// 2592-byte public key.
    pub public_key: Vec<u8>,
    /// 4896-byte secret key.
    pub secret_key: Vec<u8>,
}

/// Generates an ML-DSA-87 (Dilithium-5) keypair.
pub fn generate_pqc_keypair() -> Result<PqcKeypair> {
    let (pk, sk) =
        ml_dsa_87::try_keygen().map_err(|e| Error::Pqc(format!("keygen failed: {e}")))?;
    Ok(PqcKeypair {
        public_key: pk.into_bytes().to_vec(),
        secret_key: sk.into_bytes().to_vec(),
    })
}

/// Signs a message with an ML-DSA-87 (Dilithium-5) secret key.
///
/// Signing is DETERMINISTIC (FIPS-204 §3.4, `rnd` = 32 zero bytes): the same
/// `(secret_key, message)` always yields the same signature. The chain's
/// on-chain PQC verifier accepts ONLY deterministic ML-DSA-87 signatures
/// (hedged signatures are rejected with codespace `pqc`), so this default is
/// consensus-critical. Use [`pqc_sign_hedged`] only for off-chain uses that
/// want side-channel hedging.
pub fn pqc_sign(secret_key: &[u8], message: &[u8]) -> Result<Vec<u8>> {
    let sk = decode_secret_key(secret_key)?;
    // Deterministic variant: fixed all-zero 32-byte rnd, empty context (the
    // chain's hybrid scheme convention).
    let sig = sk
        .try_sign_with_seed(&[0u8; 32], message, &[])
        .map_err(|e| Error::Pqc(format!("signing failed: {e}")))?;
    Ok(sig.to_vec())
}

/// Signs a message with an ML-DSA-87 secret key using the RANDOMIZED (hedged)
/// FIPS-204 variant.
///
/// NOT accepted by the chain's PQC verifier — use [`pqc_sign`] for anything
/// that goes on-chain.
pub fn pqc_sign_hedged(secret_key: &[u8], message: &[u8]) -> Result<Vec<u8>> {
    let sk = decode_secret_key(secret_key)?;
    // Empty context, the chain's hybrid scheme convention.
    let sig = sk
        .try_sign(message, &[])
        .map_err(|e| Error::Pqc(format!("signing failed: {e}")))?;
    Ok(sig.to_vec())
}

/// Decodes and validates a raw ML-DSA-87 secret key.
fn decode_secret_key(secret_key: &[u8]) -> Result<ml_dsa_87::PrivateKey> {
    let bytes: [u8; MLDSA87_SECRET_KEY_LEN] = secret_key.try_into().map_err(|_| {
        Error::Pqc(format!(
            "invalid PQC secret key length: {}",
            secret_key.len()
        ))
    })?;
    ml_dsa_87::PrivateKey::try_from_bytes(bytes)
        .map_err(|e| Error::Pqc(format!("invalid PQC secret key: {e}")))
}

/// Verifies an ML-DSA-87 (Dilithium-5) signature over a message.
pub fn pqc_verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    let pk_bytes: [u8; MLDSA87_PUBLIC_KEY_LEN] = match public_key.try_into() {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_bytes: [u8; MLDSA87_SIGNATURE_LEN] = match signature.try_into() {
        Ok(b) => b,
        Err(_) => return false,
    };
    let pk = match ml_dsa_87::PublicKey::try_from_bytes(pk_bytes) {
        Ok(pk) => pk,
        Err(_) => return false,
    };
    pk.verify(message, &sig_bytes, &[])
}

/// The on-chain `PQCHybridSignature` transaction extension.
///
/// Serializes to JSON exactly as the chain expects:
/// `{"algorithm_id":1,"pqc_signature":"<std-base64>","pqc_public_key":"<std-base64>"}`.
/// `pqc_signature` and `pqc_public_key` use standard (padded) base64; the public
/// key is omitted entirely when no key is supplied.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSignatureExtension {
    /// PQC algorithm identifier (1 = Dilithium-5 / ML-DSA-87).
    pub algorithm_id: u32,
    /// Standard (padded) base64 of the PQC signature.
    pub pqc_signature: String,
    /// Standard (padded) base64 of the PQC public key; omitted when absent.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pqc_public_key: Option<String>,
}

/// Builds the on-chain `PQCHybridSignature` extension object.
///
/// Validation mirrors the core `PQCHybridSignature.Validate()`: the algorithm
/// must be a signature scheme, the signature must be non-empty, and for
/// Dilithium-5 the signature / public-key lengths are enforced. The public key
/// is omitted when `public_key` is `None`.
pub fn build_hybrid_signature_extension(
    algorithm_id: u32,
    signature: &[u8],
    public_key: Option<&[u8]>,
) -> Result<HybridSignatureExtension> {
    if !is_signature_algorithm(algorithm_id) {
        return Err(Error::Pqc(format!(
            "algorithm {} is not a PQC signature algorithm",
            algorithm_name(algorithm_id)
        )));
    }
    if signature.is_empty() {
        return Err(Error::Pqc("PQC signature cannot be empty".into()));
    }
    if algorithm_id == ALGORITHM_DILITHIUM5 {
        if signature.len() != MLDSA87_SIGNATURE_LEN {
            return Err(Error::Pqc(format!(
                "dilithium5 signature must be {MLDSA87_SIGNATURE_LEN} bytes, got {}",
                signature.len()
            )));
        }
        if let Some(pk) = public_key {
            if pk.len() != MLDSA87_PUBLIC_KEY_LEN {
                return Err(Error::Pqc(format!(
                    "dilithium5 public key must be {MLDSA87_PUBLIC_KEY_LEN} bytes, got {}",
                    pk.len()
                )));
            }
        }
    }
    Ok(HybridSignatureExtension {
        algorithm_id,
        pqc_signature: BASE64.encode(signature),
        pqc_public_key: public_key.map(|pk| BASE64.encode(pk)),
    })
}
