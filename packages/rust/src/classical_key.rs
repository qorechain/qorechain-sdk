//! The `ecdsa_pubkey` rule of PQC key registration (chain v3.2.2).
//!
//! `MsgRegisterPQCKey` / `MsgRegisterPQCKeyV2` carry an optional classical key.
//! From v3.2.2 the chain accepts it only when it is empty, or a 33-byte
//! compressed secp256k1 key that belongs to the sender, through either address
//! derivation the chain uses:
//!
//! - eth-native: `keccak256(uncompressed[1..])[12..]` (`eth_secp256k1` accounts)
//! - cosmos:     `ripemd160(sha256(compressed))`     (`secp256k1` accounts)
//!
//! Anything else costs the registration fee and fails. Checking here turns that
//! into an error before broadcast.

use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::PublicKey;

use crate::utils::{keccak256, ripemd160, sha256};
use crate::{Error, Result};

/// Size of a compressed secp256k1 public key.
pub const COMPRESSED_SECP256K1_LENGTH: usize = 33;

/// How a registration's `ecdsa_pubkey` relates to its sender.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassicalKeyMatch {
    /// No classical key is given, which the chain accepts.
    Empty,
    /// `keccak256(uncompressed[1..])[12..]` is the sender.
    Eth,
    /// `ripemd160(sha256(compressed))` is the sender.
    Cosmos,
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// Which derivation ties `pubkey` to `sender`.
///
/// # Errors
///
/// [`Error::Pqc`] with the reason the chain would refuse the key.
pub fn validate_classical_key_for_sender(sender: &str, pubkey: &[u8]) -> Result<ClassicalKeyMatch> {
    if pubkey.is_empty() {
        return Ok(ClassicalKeyMatch::Empty);
    }
    if pubkey.len() != COMPRESSED_SECP256K1_LENGTH || (pubkey[0] != 0x02 && pubkey[0] != 0x03) {
        return Err(Error::Pqc(format!(
            "ecdsa_pubkey must be a {COMPRESSED_SECP256K1_LENGTH}-byte compressed secp256k1 key, got {} bytes",
            pubkey.len()
        )));
    }
    let point = PublicKey::from_sec1_bytes(pubkey)
        .map_err(|_| Error::Pqc("ecdsa_pubkey is not a point on secp256k1".into()))?;
    let (_hrp, account) = bech32::decode(sender)
        .map_err(|_| Error::Pqc(format!("sender {sender:?} is not a bech32 address")))?;
    let uncompressed = point.to_encoded_point(false);
    let eth = keccak256(&uncompressed.as_bytes()[1..]);
    if ct_eq(&eth[12..], &account) {
        return Ok(ClassicalKeyMatch::Eth);
    }
    if ct_eq(&ripemd160(&sha256(pubkey)), &account) {
        return Ok(ClassicalKeyMatch::Cosmos);
    }
    Err(Error::Pqc(format!(
        "ecdsa_pubkey does not belong to {sender} under either address derivation"
    )))
}
