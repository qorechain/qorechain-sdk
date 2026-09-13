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
//!
//! # Length strictness
//!
//! Every entry point validates its key and signature lengths **exactly** —
//! [`MLDSA87_SIGNATURE_LEN`] (4627), [`MLDSA87_PUBLIC_KEY_LEN`] (2592),
//! [`MLDSA87_SECRET_KEY_LEN`] (4896) — before handing anything to the underlying
//! library, and rejects everything else. This is the SDK's own guarantee, not an
//! inherited one: ML-DSA implementations disagree about trailing bytes (the Go
//! binding over CIRCL v1.6.1 accepts a 4628-byte signature as valid, `fips204`
//! does not), so the check is stated and tested here to keep every language
//! binding on the strict side.

use crate::error::{Error, Result};
use crate::proto::qorechain::pqc::v1::PqcHybridSignature;
use cosmrs::proto::traits::Message as ProstMessage;
use fips204::ml_dsa_87;
use fips204::traits::{KeyGen, SerDes, Signer, Verifier};

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

/// Deterministically derives an ML-DSA-87 (Dilithium-5) keypair from a 32-byte
/// seed (FIPS 204 `KeyGen_internal` with the given `xi`).
///
/// This is the seeded keygen used by the unified wallet's PQC derivation, so a
/// `(seed)` always yields the same recoverable keypair.
pub fn pqc_keypair_from_seed(seed: &[u8; 32]) -> PqcKeypair {
    let (pk, sk) = ml_dsa_87::KG::keygen_from_seed(seed);
    PqcKeypair {
        public_key: pk.into_bytes().to_vec(),
        secret_key: sk.into_bytes().to_vec(),
    }
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

/// Reports whether `signature` is exactly [`MLDSA87_SIGNATURE_LEN`] (4627) bytes.
///
/// Length is checked in full — a signature carrying even one extra trailing byte
/// is **not** a valid ML-DSA-87 signature, however the trailing byte was acquired.
pub fn is_valid_pqc_signature_len(signature: &[u8]) -> bool {
    signature.len() == MLDSA87_SIGNATURE_LEN
}

/// Reports whether `public_key` is exactly [`MLDSA87_PUBLIC_KEY_LEN`] (2592) bytes.
pub fn is_valid_pqc_public_key_len(public_key: &[u8]) -> bool {
    public_key.len() == MLDSA87_PUBLIC_KEY_LEN
}

/// Reports whether `secret_key` is exactly [`MLDSA87_SECRET_KEY_LEN`] (4896) bytes.
pub fn is_valid_pqc_secret_key_len(secret_key: &[u8]) -> bool {
    secret_key.len() == MLDSA87_SECRET_KEY_LEN
}

/// Enforces an exact FIPS 204 byte length, naming what was measured.
///
/// The SDK checks this itself rather than inheriting whatever the underlying
/// library happens to do, because implementations disagree: the Go binding
/// (CIRCL v1.6.1) accepts a 4628-byte signature — the 4627-byte signature with
/// one extra trailing byte — as valid, while `fips204` rejects it. Strict is the
/// correct side, and stating it here makes the guarantee the SDK's own, testable
/// and identical in every language binding.
fn check_exact_len(what: &str, got: usize, want: usize) -> Result<()> {
    if got != want {
        return Err(Error::Pqc(format!(
            "invalid ML-DSA-87 {what} length: expected exactly {want} bytes, got {got}"
        )));
    }
    Ok(())
}

/// Decodes and validates a raw ML-DSA-87 secret key (exactly 4896 bytes).
fn decode_secret_key(secret_key: &[u8]) -> Result<ml_dsa_87::PrivateKey> {
    check_exact_len("secret key", secret_key.len(), MLDSA87_SECRET_KEY_LEN)?;
    let bytes: [u8; MLDSA87_SECRET_KEY_LEN] = secret_key
        .try_into()
        .map_err(|_| Error::Pqc("invalid PQC secret key length".to_string()))?;
    ml_dsa_87::PrivateKey::try_from_bytes(bytes)
        .map_err(|e| Error::Pqc(format!("invalid PQC secret key: {e}")))
}

/// Verifies an ML-DSA-87 (Dilithium-5) signature over a message.
///
/// Both inputs must be **exactly** their FIPS 204 sizes — 2592 bytes of public
/// key, 4627 bytes of signature. A signature that is otherwise valid but carries
/// extra trailing bytes, or one that is truncated, returns `false`; the length
/// check happens here, before the underlying library is consulted, so the rule
/// does not depend on that library's own tolerance.
pub fn pqc_verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    if !is_valid_pqc_public_key_len(public_key) || !is_valid_pqc_signature_len(signature) {
        return false;
    }
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
/// This is the validated, raw-byte form of the extension. It is carried in
/// `TxBody.extension_options` as a `cosmos.tx.v1beta1.Any` whose `value` is the
/// PROTOBUF encoding of the generated [`PqcHybridSignature`] message (fields
/// `algorithm_id` = 1, `pqc_signature` = 2, `pqc_public_key` = 3), produced by
/// [`HybridSignatureExtension::encode_to_vec`]. The chain's ante handler
/// protobuf-decodes this extension, so the encoded `Any.value` always begins
/// with `0x08` (the field-1 varint tag).
///
/// NOTE: a prior release JSON-encoded this value; the chain's tx decoder
/// rejected every such tx at CheckTx (the leading `0x7b` = `{` was misread as
/// protobuf field 15 `start_group`). Verified live on testnet 2026-07-05.
#[derive(Debug, Clone)]
pub struct HybridSignatureExtension {
    /// PQC algorithm identifier (1 = Dilithium-5 / ML-DSA-87).
    pub algorithm_id: u32,
    /// The raw PQC signature bytes (Dilithium-5: 4627 bytes).
    pub pqc_signature: Vec<u8>,
    /// The raw PQC public-key bytes (Dilithium-5: 2592 bytes); omitted when absent.
    pub pqc_public_key: Option<Vec<u8>>,
}

impl HybridSignatureExtension {
    /// PROTOBUF-encodes this extension into the bytes that go into the
    /// `Any.value` of the `TxBody.extension_options` entry.
    ///
    /// Builds the generated [`PqcHybridSignature`] prost message and returns
    /// `Message::encode_to_vec`. An absent public key is encoded as an empty
    /// field (the default), which prost omits from the wire — matching the
    /// other SDKs. The result always begins with byte `0x08`, never `0x7b`.
    pub fn encode_to_vec(&self) -> Vec<u8> {
        let msg = PqcHybridSignature {
            algorithm_id: self.algorithm_id,
            pqc_signature: self.pqc_signature.clone(),
            pqc_public_key: self.pqc_public_key.clone().unwrap_or_default(),
        };
        msg.encode_to_vec()
    }
}

/// Builds the on-chain `PQCHybridSignature` extension object.
///
/// Validation mirrors the core `PQCHybridSignature.Validate()`: the algorithm
/// must be a signature scheme, the signature must be non-empty, and for
/// Dilithium-5 the signature / public-key lengths are enforced. The public key
/// is omitted when `public_key` is `None`. Use
/// [`HybridSignatureExtension::encode_to_vec`] to obtain the protobuf `Any.value`.
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
        pqc_signature: signature.to_vec(),
        pqc_public_key: public_key.map(|pk| pk.to_vec()),
    })
}
