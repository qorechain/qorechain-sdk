//! Conversion and validation for QoreChain bech32 addresses (e.g. `qor1...`)
//! and their underlying byte payloads expressed as `0x`-prefixed hex.
//!
//! bech32 stores data as 5-bit groups, so encoding/decoding converts between
//! those groups and the 8-bit byte representation callers work with.

use crate::error::{Error, Result};
use bech32::primitives::hrp::Hrp;
use bech32::Bech32;

/// The default bech32 human-readable prefix for QoreChain account addresses.
pub const DEFAULT_PREFIX: &str = "qor";

fn strip_hex_prefix(s: &str) -> &str {
    if let Some(rest) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        rest
    } else {
        s
    }
}

fn hex_to_bytes(s: &str) -> Result<Vec<u8>> {
    let body = strip_hex_prefix(s);
    if body.is_empty() || body.len() % 2 != 0 {
        return Err(Error::Address(format!("invalid hex string: {s}")));
    }
    hex::decode(body).map_err(|_| Error::Address(format!("invalid hex string: {s}")))
}

/// Encodes raw bytes to a bech32 address with the given prefix.
///
/// This is the primitive encoder; callers holding a byte payload (e.g. the
/// 20-byte ripemd160(sha256(pubkey)) account hash) should use it directly
/// rather than round-tripping through hex.
pub fn bytes_to_bech32(data: &[u8], prefix: &str) -> Result<String> {
    let hrp =
        Hrp::parse(prefix).map_err(|e| Error::Address(format!("invalid bech32 prefix: {e}")))?;
    bech32::encode::<Bech32>(hrp, data)
        .map_err(|e| Error::Address(format!("failed to encode bech32 address: {e}")))
}

/// Encodes hex bytes to a bech32 address with the given prefix. Returns an
/// error if `hex_str` is not a valid hex string.
pub fn hex_to_bech32(hex_str: &str, prefix: &str) -> Result<String> {
    let bytes = hex_to_bytes(hex_str)?;
    bytes_to_bech32(&bytes, prefix)
}

/// Decodes a bech32 address to a `0x`-prefixed hex string of its payload.
/// Returns an error if `addr` is not a valid bech32 string.
pub fn bech32_to_hex(addr: &str) -> Result<String> {
    let (_hrp, data) = bech32::decode(addr)
        .map_err(|_| Error::Address(format!("invalid bech32 address: {addr}")))?;
    Ok(format!("0x{}", hex::encode(data)))
}

/// Validates a bech32 address, optionally requiring a specific prefix.
///
/// Returns `true` if `addr` is a structurally valid bech32 string (correct
/// checksum) and, when `prefix` is `Some`, its prefix matches (case-insensitive);
/// `false` otherwise.
pub fn is_valid_bech32(addr: &str, prefix: Option<&str>) -> bool {
    match bech32::decode(addr) {
        Ok((hrp, _data)) => match prefix {
            None => true,
            Some(p) => hrp.as_str().eq_ignore_ascii_case(p),
        },
        Err(_) => false,
    }
}
