//! The chain's KEM key registry (chain v3.2.5): an account publishes one
//! key-encapsulation public key so anyone can encrypt to it.
//!
//! The registry stores and serves the raw key; it defines no encryption
//! context, and this crate does no encryption (QoreSeal does). What is here:
//! the constants, the client-side key check, and the
//! `/qorechain/pqc/v1/kem/{address}` read. The composers are
//! [`crate::msg::pqc::register_kem_key`] and
//! [`crate::msg::pqc::remove_kem_key`].
//!
//! Chain rules: only ML-KEM-1024 (algorithm id 2) is registered; the key is
//! exactly 1,568 bytes and passes the FIPS 203 modulus check; one key per
//! account (sending another replaces it, the response says `replaced`); no
//! proof of possession, the registration is authenticated by the mandatory
//! hybrid signature, so the sender needs a registered ML-DSA-87 key. Both
//! messages are refused through authz. Refusals are `pqc` 250 to 254 (see
//! [`KEM_ERROR_CODES`]).

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::query::RestClient;

/// ML-KEM-1024 (FIPS 203), the registry's algorithm id 2.
pub const KEM_ALGORITHM_ML_KEM_1024: u32 = crate::pqc::ALGORITHM_MLKEM1024;
/// The size of an ML-KEM-1024 encapsulation (public) key, in bytes.
pub const ML_KEM_1024_PUBLIC_KEY_LEN: usize = 1568;
/// The protocol feature that switches the registry on.
pub const KEM_REGISTRY_FEATURE: &str = "pqc-kem-registry";
/// The FIPS 203 modulus every key coefficient must be below.
pub const ML_KEM_Q: u16 = 3329;
/// The encoded polynomial vector `t_hat` of an ML-KEM-1024 key: 4 x 384 bytes.
const ML_KEM_1024_T_HAT_LEN: usize = 1536;

/// The registry's refusal codes in the `pqc` codespace, with the chain's
/// registered names.
pub const KEM_ERROR_CODES: &[(u32, &str)] = &[
    (250, "ErrKEMRegistryNotEnabled"),
    (251, "ErrInvalidKEMKey"),
    (252, "ErrKEMKeyNotFound"),
    (253, "ErrKEMKeyUnchanged"),
    (254, "ErrKEMNeedsSignatureKey"),
];

/// The chain's name for a `pqc` KEM registry refusal code (250 to 254).
pub fn kem_error_name(code: u32) -> Option<&'static str> {
    KEM_ERROR_CODES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, n)| *n)
}

/// Checks a KEM public key before it is sent. For ML-KEM-1024 (id 2): exactly
/// [`ML_KEM_1024_PUBLIC_KEY_LEN`] bytes, every 12-bit coefficient of `t_hat`
/// (the first 1,536 bytes) below [`ML_KEM_Q`], and `t_hat` not all zero, as the
/// chain checks. Any other algorithm id is left to the chain, which accepts
/// only the algorithms governance registered.
///
/// # Errors
///
/// [`Error::Pqc`] naming the problem.
pub fn validate_kem_public_key(algorithm_id: u32, public_key: &[u8]) -> Result<()> {
    if algorithm_id != KEM_ALGORITHM_ML_KEM_1024 {
        return Ok(());
    }
    if public_key.len() != ML_KEM_1024_PUBLIC_KEY_LEN {
        return Err(Error::Pqc(format!(
            "an ML-KEM-1024 public key is {ML_KEM_1024_PUBLIC_KEY_LEN} bytes, got {}",
            public_key.len()
        )));
    }
    let t_hat = &public_key[..ML_KEM_1024_T_HAT_LEN];
    for (i, b) in t_hat.chunks_exact(3).enumerate() {
        let c0 = u16::from(b[0]) | (u16::from(b[1] & 0x0f) << 8);
        let c1 = u16::from(b[1] >> 4) | (u16::from(b[2]) << 4);
        if c0 >= ML_KEM_Q || c1 >= ML_KEM_Q {
            return Err(Error::Pqc(format!(
                "the ML-KEM-1024 public key fails the FIPS 203 modulus check (coefficient {} \
                 is not below {ML_KEM_Q})",
                if c0 >= ML_KEM_Q { 2 * i } else { 2 * i + 1 }
            )));
        }
    }
    if t_hat.iter().all(|&b| b == 0) {
        return Err(Error::Pqc(
            "the ML-KEM-1024 public key is degenerate (all-zero t_hat)".into(),
        ));
    }
    Ok(())
}

/// The REST path of an address's published KEM key (`address` bech32 or 0x).
pub fn kem_key_path(address: &str) -> String {
    format!("/qorechain/pqc/v1/kem/{address}")
}

/// A published KEM key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KemKey {
    /// The bech32 account that published it.
    pub address: String,
    /// The registry algorithm id (2 = ML-KEM-1024).
    pub algorithm_id: u32,
    /// The registry algorithm name (e.g. `mlkem1024`).
    pub algorithm_name: String,
    /// The encapsulation key as FIPS 203 encodes it.
    pub public_key: Vec<u8>,
    /// The height of the registration that published it.
    pub registered_height: i64,
}

/// The answer of [`fetch_kem_key`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KemKeyLookup {
    /// Whether the address has published a key.
    pub found: bool,
    /// The key, when found.
    pub key: Option<KemKey>,
}

fn num_i64(v: &Value) -> Option<i64> {
    match v {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_i64(),
        Value::Null => Some(0),
        _ => None,
    }
}

/// Parses a `/qorechain/pqc/v1/kem/{address}` body.
///
/// # Errors
///
/// [`Error::InvalidResponse`] on a malformed body.
pub fn parse_kem_key(b: &Value) -> Result<KemKeyLookup> {
    let found = b["found"].as_bool().unwrap_or(false);
    let k = &b["key"];
    if !found || k.is_null() {
        return Ok(KemKeyLookup {
            found: false,
            key: None,
        });
    }
    let bad = |what: &str| Error::InvalidResponse(format!("KEM key: {what}"));
    let public_key = match &k["public_key"] {
        Value::String(s) => BASE64
            .decode(s)
            .map_err(|_| bad("public_key is not base64"))?,
        Value::Null => Vec::new(),
        _ => return Err(bad("public_key is not a string")),
    };
    let algorithm_id = match &k["algorithm_id"] {
        Value::Null => 0,
        v => num_i64(v)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| bad("algorithm_id is not an integer"))?,
    };
    Ok(KemKeyLookup {
        found: true,
        key: Some(KemKey {
            address: k["address"].as_str().unwrap_or_default().to_string(),
            algorithm_id,
            algorithm_name: k["algorithm_name"].as_str().unwrap_or_default().to_string(),
            public_key,
            registered_height: num_i64(&k["registered_height"])
                .ok_or_else(|| bad("registered_height is not an integer"))?,
        }),
    })
}

/// Reads the KEM key `address` (bech32 or 0x) published, if any. A network
/// below v3.2.5 has no such route (an HTTP 404 / 501 error).
///
/// # Errors
///
/// Transport / HTTP errors from the REST client, or
/// [`Error::InvalidResponse`] on an unparsable body.
pub async fn fetch_kem_key(rest: &RestClient, address: &str) -> Result<KemKeyLookup> {
    parse_kem_key(&rest.get(&kem_key_path(address), &[]).await?)
}
