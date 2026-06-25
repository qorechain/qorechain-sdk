//! Hashing, unit-conversion, and address-validation helpers shared across the
//! QoreChain SDK, mirroring the TypeScript / Python / Go `utils` surface.
//!
//! - [`sha256`] / [`keccak256`] / [`ripemd160`] / [`hash160`] — the hashes used
//!   by Cosmos address derivation and by the EVM.
//! - [`parse_units`] / [`format_units`] — exact (big-integer) conversion between
//!   a human display amount and its integer base amount; no floating point.
//! - [`is_valid_evm_address`] / [`is_valid_svm_address`] /
//!   [`to_checksum_address`] — EVM (EIP-55) and SVM address validation.

use crate::error::{Error, Result};
use sha2::{Digest, Sha256};
use sha3::Keccak256;

/// Returns the SHA-256 digest of `data`.
pub fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}

/// Returns the Keccak-256 digest of `data` (the EVM hash, distinct from the
/// FIPS-202 SHA3-256 padding).
pub fn keccak256(data: &[u8]) -> Vec<u8> {
    Keccak256::digest(data).to_vec()
}

/// Returns the RIPEMD-160 digest of `data`.
pub fn ripemd160(data: &[u8]) -> Vec<u8> {
    use ripemd::Ripemd160;
    Ripemd160::digest(data).to_vec()
}

/// Returns `RIPEMD160(SHA256(data))` — the Cosmos account-address hash of a
/// public key.
pub fn hash160(data: &[u8]) -> Vec<u8> {
    ripemd160(&sha256(data))
}

/// Converts a human display amount string (e.g. `"1.5"`) into its integer base
/// amount string given a number of `decimals` (e.g. `18` → wei).
///
/// All math is exact (string/integer); no floating point. Rejects negatives,
/// scientific notation, and more fractional digits than `decimals` allows.
pub fn parse_units(amount: &str, decimals: u32) -> Result<String> {
    let body = amount.trim();
    if let Some(stripped) = body.strip_prefix('-') {
        let _ = stripped;
        return Err(Error::Denom(format!(
            "negative amounts are not supported: {amount}"
        )));
    }
    let body = body.strip_prefix('+').unwrap_or(body);
    if body.is_empty() {
        return Err(Error::Denom("empty amount".into()));
    }
    let (int_part, frac_part) = match body.split_once('.') {
        Some((i, f)) => (i, f),
        None => (body, ""),
    };
    let int_part = if int_part.is_empty() { "0" } else { int_part };
    if !is_digits(int_part) || (!frac_part.is_empty() && !is_digits(frac_part)) {
        return Err(Error::Denom(format!("invalid decimal amount: {amount}")));
    }
    let decimals = decimals as usize;
    if frac_part.len() > decimals {
        return Err(Error::Denom(format!(
            "too many decimal places in {amount}: {} > decimals {decimals}",
            frac_part.len()
        )));
    }
    let mut combined = String::with_capacity(int_part.len() + decimals);
    combined.push_str(int_part);
    combined.push_str(frac_part);
    for _ in 0..(decimals - frac_part.len()) {
        combined.push('0');
    }
    // Normalize: strip leading zeros (keep at least one digit).
    let trimmed = combined.trim_start_matches('0');
    Ok(if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    })
}

/// Converts an integer base amount string into a normalized human display string
/// given a number of `decimals`.
///
/// Trailing zeros and a trailing dot are stripped (e.g. base
/// `"1500000000000000000"`, `18` → `"1.5"`).
pub fn format_units(base: &str, decimals: u32) -> Result<String> {
    let trimmed = base.trim();
    if trimmed.starts_with('-') {
        return Err(Error::Denom(format!(
            "negative amounts are not supported: {base}"
        )));
    }
    if !is_digits(trimmed) {
        return Err(Error::Denom(format!("invalid base amount: {base}")));
    }
    let decimals = decimals as usize;
    // Normalize the integer (strip leading zeros, keep one digit).
    let digits_owned = {
        let t = trimmed.trim_start_matches('0');
        if t.is_empty() {
            "0".to_string()
        } else {
            t.to_string()
        }
    };
    if decimals == 0 {
        return Ok(digits_owned);
    }
    let digits = if digits_owned.len() <= decimals {
        let pad = decimals + 1 - digits_owned.len();
        format!("{}{}", "0".repeat(pad), digits_owned)
    } else {
        digits_owned
    };
    let split = digits.len() - decimals;
    let int_part = &digits[..split];
    let frac_part = &digits[split..];
    let trimmed_frac = frac_part.trim_end_matches('0');
    if trimmed_frac.is_empty() {
        Ok(int_part.to_string())
    } else {
        Ok(format!("{int_part}.{trimmed_frac}"))
    }
}

/// Reports whether `s` is a structurally valid EVM address: a `"0x"`-prefixed
/// 40-hex-character string. Does not verify the EIP-55 checksum; use
/// [`to_checksum_address`] to produce a checksummed form.
pub fn is_valid_evm_address(s: &str) -> bool {
    if s.len() != 42 {
        return false;
    }
    let bytes = s.as_bytes();
    if bytes[0] != b'0' || (bytes[1] != b'x' && bytes[1] != b'X') {
        return false;
    }
    s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Reports whether `s` is a structurally valid SVM address: a base58 string that
/// decodes to exactly 32 bytes.
pub fn is_valid_svm_address(s: &str) -> bool {
    match bs58::decode(s).into_vec() {
        Ok(decoded) => decoded.len() == 32,
        Err(_) => false,
    }
}

/// Returns the EIP-55 mixed-case checksum form of an EVM address. Returns an
/// error if `s` is not a valid 20-byte hex address.
pub fn to_checksum_address(s: &str) -> Result<String> {
    if !is_valid_evm_address(s) {
        return Err(Error::Address(format!("invalid EVM address: {s}")));
    }
    let lower = s[2..].to_ascii_lowercase();
    let hash = keccak256(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, c) in lower.bytes().enumerate() {
        if c.is_ascii_digit() {
            out.push(c as char);
            continue;
        }
        // Uppercase the hex letter when the corresponding hash nibble >= 8.
        let mut nibble = hash[i / 2];
        if i % 2 == 0 {
            nibble >>= 4;
        }
        nibble &= 0x0f;
        if nibble >= 8 {
            out.push((c as char).to_ascii_uppercase());
        } else {
            out.push(c as char);
        }
    }
    Ok(out)
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
