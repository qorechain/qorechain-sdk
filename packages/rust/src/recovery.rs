//! PQC recovery codes (`QRC1-…`).
//!
//! A recovery code is a second secret, generated at random and held by the user,
//! that the account's classical key says nothing about. The account's ML-DSA-87
//! key is derived from it and from the account address, so the post-quantum half
//! of a hybrid signature needs something the classical half does not have.
//!
//! The code does not look like a seed phrase, so it is not imported into a
//! wallet by mistake:
//!
//! ```text
//! QRC1-7K3M-9TQX-...            (14 groups of 4, Crockford base32)
//! ```
//!
//! - 256 bits of secret entropy (ML-DSA-87 is NIST category 5);
//! - Crockford base32: no I, L, O or U, case-insensitive, and the letters people
//!   confuse are read as what they meant (O as 0, I and L as 1);
//! - a 24-bit checksum, so a mistyped character is caught instead of silently
//!   deriving a key that matches nothing;
//! - the `QRC1-` prefix names and versions the format.
//!
//! The code is the secret. Show it once, have the user write it down, and never
//! store it next to the account's seed phrase.
//!
//! The format and the key derivation are byte-identical across every QoreChain
//! SDK language and the wallet adapter.

use crate::error::{Error, Result};
use crate::pqc::{pqc_keypair_from_seed, PqcKeypair};
use sha3::digest::{ExtendableOutput, Update, XofReader};
use sha3::Shake256;

/// The prefix every recovery code starts with.
pub const PQC_RECOVERY_CODE_PREFIX: &str = "QRC1";

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I L O U
const SECRET_BYTES: usize = 32;
const CHECKSUM_BYTES: usize = 3;
const PAYLOAD_BYTES: usize = SECRET_BYTES + CHECKSUM_BYTES; // 35 bytes = 280 bits
const CODE_CHARS: usize = PAYLOAD_BYTES * 8 / 5; // 56
const GROUP: usize = 4;

const CHECKSUM_DOMAIN: &[u8] = b"qorechain:pqc:recovery:v1:checksum";
const KEY_DOMAIN: &str = "qorechain:pqc:recovery:v1";

/// Overwrites a buffer with zeros (best effort: `black_box` keeps the
/// optimiser from dropping the writes).
pub(crate) fn wipe(buf: &mut [u8]) {
    buf.fill(0);
    std::hint::black_box(&*buf);
}

/// Zeroes a string's bytes and leaves it empty.
pub(crate) fn wipe_string(s: &mut String) {
    let mut bytes = std::mem::take(s).into_bytes();
    wipe(&mut bytes);
}

fn shake256(parts: &[&[u8]], out: &mut [u8]) {
    let mut hasher = Shake256::default();
    for p in parts {
        hasher.update(p);
    }
    hasher.finalize_xof().read(out);
}

fn checksum(secret: &[u8; SECRET_BYTES]) -> [u8; CHECKSUM_BYTES] {
    let mut out = [0u8; CHECKSUM_BYTES];
    shake256(&[CHECKSUM_DOMAIN, secret], &mut out);
    out
}

fn encode_base32(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 8 / 5 + 1);
    let mut bits = 0u32;
    let mut value = 0u32;
    for &b in bytes {
        value = (value << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
        value &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn decode_base32(chars: &str) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(chars.len() * 5 / 8);
    let mut bits = 0u32;
    let mut value = 0u32;
    for c in chars.chars() {
        let v = ALPHABET
            .iter()
            .position(|&a| a as char == c)
            .ok_or_else(|| {
                Error::InvalidInput(format!(
                    "recovery code contains an invalid character \"{c}\""
                ))
            })?;
        value = (value << 5) | v as u32;
        bits += 5;
        if bits >= 8 {
            out.push(((value >> (bits - 8)) & 255) as u8);
            bits -= 8;
        }
        value &= (1 << bits) - 1;
    }
    Ok(out)
}

/// Normalises what a person typed: upper-cases it, drops spaces and the
/// separators `-`, `_` and `.`, reads O as 0 and I / L as 1, and drops the
/// `QRC1` prefix. Returns the 56 data characters, or an error a UI can show.
pub fn normalize_recovery_code(code: &str) -> Result<String> {
    // Read the confusable letters as what was meant BEFORE looking for the
    // prefix: "QRC1" copied off paper can come back as "QRCI" or "QRCL".
    let mut s: String = code
        .to_uppercase()
        .chars()
        .filter(|c| !(c.is_whitespace() || matches!(c, '-' | '_' | '.')))
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    // Strip the prefix only when the length says it is there: 56 data characters
    // can begin with "QRC1" by chance, and cutting those would break a valid code.
    let n = s.chars().count();
    if n == CODE_CHARS + PQC_RECOVERY_CODE_PREFIX.len() && s.starts_with(PQC_RECOVERY_CODE_PREFIX) {
        s.drain(..PQC_RECOVERY_CODE_PREFIX.len());
    }
    let n = s.chars().count();
    if n != CODE_CHARS {
        return Err(Error::InvalidInput(format!(
            "recovery code must have {CODE_CHARS} characters after \"{PQC_RECOVERY_CODE_PREFIX}-\", got {n}"
        )));
    }
    if s.contains('U') {
        return Err(Error::InvalidInput(
            "recovery code contains an invalid character \"U\"".into(),
        ));
    }
    Ok(s)
}

/// Decodes a recovery code to its 32-byte secret, checking the checksum.
pub(crate) fn decode_recovery_code(code: &str) -> Result<[u8; SECRET_BYTES]> {
    let mut normalized = normalize_recovery_code(code)?;
    let decoded = decode_base32(&normalized);
    wipe_string(&mut normalized);
    let mut payload = decoded?;
    // 56 chars = 280 bits = exactly 35 bytes; anything else is a decoder fault.
    if payload.len() != PAYLOAD_BYTES {
        wipe(&mut payload);
        return Err(Error::InvalidInput(
            "recovery code has the wrong length".into(),
        ));
    }
    let mut secret = [0u8; SECRET_BYTES];
    secret.copy_from_slice(&payload[..SECRET_BYTES]);
    let want = checksum(&secret);
    // Constant-time compare of the 3 checksum bytes.
    let mut diff = 0u8;
    for i in 0..CHECKSUM_BYTES {
        diff |= payload[SECRET_BYTES + i] ^ want[i];
    }
    wipe(&mut payload);
    if diff != 0 {
        wipe(&mut secret);
        return Err(Error::InvalidInput(
            "recovery code checksum does not match: a character is mistyped".into(),
        ));
    }
    Ok(secret)
}

fn format_code(chars: &str) -> String {
    let groups: Vec<&str> = chars
        .as_bytes()
        .chunks(GROUP)
        .map(|g| std::str::from_utf8(g).expect("base32 output is ASCII"))
        .collect();
    format!("{PQC_RECOVERY_CODE_PREFIX}-{}", groups.join("-"))
}

/// Encodes 32 bytes of secret entropy as a `QRC1-…` recovery code.
///
/// For apps that already hold an independent 32-byte secret for the PQC key.
/// The bytes MUST be secret entropy that has nothing to do with the account's
/// classical key.
pub fn pqc_recovery_code_from_secret(secret32: &[u8; 32]) -> String {
    let mut payload = [0u8; PAYLOAD_BYTES];
    payload[..SECRET_BYTES].copy_from_slice(secret32);
    payload[SECRET_BYTES..].copy_from_slice(&checksum(secret32));
    let mut chars = encode_base32(&payload);
    wipe(&mut payload);
    let code = format_code(&chars);
    wipe_string(&mut chars);
    code
}

/// Generates a new recovery code from the operating system's CSPRNG.
///
/// Show it to the user once; it is the secret.
pub fn generate_pqc_recovery_code() -> Result<String> {
    use rand_core::RngCore;
    let mut secret = [0u8; SECRET_BYTES];
    rand_core::OsRng
        .try_fill_bytes(&mut secret)
        .map_err(|e| Error::Derivation(format!("RNG failure: {e}")))?;
    let code = pqc_recovery_code_from_secret(&secret);
    wipe(&mut secret);
    Ok(code)
}

/// `true` when `code` is a well-formed recovery code with a valid checksum.
pub fn is_valid_recovery_code(code: &str) -> bool {
    match decode_recovery_code(code) {
        Ok(mut secret) => {
            wipe(&mut secret);
            true
        }
        Err(_) => false,
    }
}

/// Checks that `address` is a `qor1…` bech32 account address and returns it in
/// lowercase.
fn canonical_qor1(address: &str) -> Result<String> {
    let lower = address.to_ascii_lowercase();
    let ok = lower.starts_with("qor1")
        && matches!(bech32::decode(&lower), Ok((hrp, _)) if hrp.as_str() == "qor");
    if !ok {
        return Err(Error::Address(
            "pqc_key_from_recovery_code: address must be the account's qor1 address".into(),
        ));
    }
    Ok(lower)
}

/// Derives the ML-DSA-87 keypair from a 32-byte secret bound to `address`:
/// `shake256("qorechain:pqc:recovery:v1|" + lowercase(address) + "|" || secret, 32)`
/// seeds the same deterministic keygen the mnemonic path uses.
pub(crate) fn pqc_key_from_secret(secret: &[u8; 32], address: &str) -> Result<PqcKeypair> {
    let lower = canonical_qor1(address)?;
    let prefix = format!("{KEY_DOMAIN}|{lower}|");
    let mut seed = [0u8; 32];
    shake256(&[prefix.as_bytes(), secret], &mut seed);
    let keypair = pqc_keypair_from_seed(&seed);
    wipe(&mut seed);
    Ok(keypair)
}

/// Derives an account's ML-DSA-87 keypair from its recovery code.
///
/// Bound to the account address, so one code cannot stand in for another
/// account, and the same code gives a different key for every account. Nothing
/// here depends on the account's classical key.
///
/// Fails on a malformed code, a checksum mismatch (never derives a key from a
/// mistyped code), or an `address` that is not a `qor1…` bech32 address.
pub fn pqc_key_from_recovery_code(code: &str, address: &str) -> Result<PqcKeypair> {
    // Check the address first so a bad call never decodes the secret.
    canonical_qor1(address)?;
    let mut secret = decode_recovery_code(code)?;
    let keypair = pqc_key_from_secret(&secret, address);
    wipe(&mut secret);
    keypair
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE_07: &str =
        "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK";

    #[test]
    fn encodes_known_vector() {
        assert_eq!(pqc_recovery_code_from_secret(&[0x07u8; 32]), CODE_07);
        assert_eq!(decode_recovery_code(CODE_07).unwrap(), [0x07u8; 32]);
    }

    #[test]
    fn generated_codes_round_trip() {
        let a = generate_pqc_recovery_code().unwrap();
        let b = generate_pqc_recovery_code().unwrap();
        assert_ne!(a, b);
        assert!(a.starts_with("QRC1-"));
        assert_eq!(a.len(), 5 + 14 * 4 + 13);
        assert!(is_valid_recovery_code(&a));
    }

    #[test]
    fn base32_round_trips() {
        let bytes: Vec<u8> = (0u8..35).collect();
        let enc = encode_base32(&bytes);
        assert_eq!(enc.len(), 56);
        assert_eq!(decode_base32(&enc).unwrap(), bytes);
    }
}
