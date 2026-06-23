//! Convert between human display amounts and integer base amounts.
//!
//! All value math is performed with integer arithmetic on decimal strings —
//! there is no floating-point arithmetic anywhere in this module, so
//! conversions are exact for any magnitude and never drift (e.g.
//! `to_base("0.1", 6) == "100000"`).
//!
//! QoreChain's staking coin uses a default exponent of 6 (1 QOR = 10^6 uqor),
//! but every function accepts a custom exponent for other denominations.

use crate::error::{Error, Result};

/// The QoreChain staking coin's default decimal exponent (1 QOR = 10^6 uqor).
pub const DEFAULT_EXPONENT: u32 = 6;

fn is_decimal(s: &str) -> bool {
    // ^\d+(\.\d+)?$
    let mut parts = s.splitn(2, '.');
    let int_part = parts.next().unwrap_or("");
    if int_part.is_empty() || !int_part.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if let Some(frac) = parts.next() {
        if frac.is_empty() || !frac.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    true
}

fn is_uint(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Strips leading zeros from a decimal-digit string, leaving at least one digit.
fn strip_leading_zeros(s: &str) -> String {
    let trimmed = s.trim_start_matches('0');
    if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Converts a human display amount to its integer base amount string.
///
/// `amount` is a non-negative decimal string, e.g. `"1.5"`. Surrounding
/// whitespace and a single leading `+` are tolerated. Scientific notation,
/// thousands separators, and other formatting are rejected. Returns an error if
/// `amount` is not a valid decimal string, is negative, or has more fractional
/// digits than `exponent` allows.
pub fn to_base(amount: &str, exponent: u32) -> Result<String> {
    let body = amount.trim();
    if body.starts_with('-') {
        return Err(Error::Denom(format!(
            "negative amounts are not supported: {amount}"
        )));
    }
    let body = body.strip_prefix('+').unwrap_or(body);

    if !is_decimal(body) {
        return Err(Error::Denom(format!("invalid decimal amount: {amount}")));
    }

    let mut parts = body.splitn(2, '.');
    let int_part = parts.next().unwrap_or("");
    let frac_part = parts.next().unwrap_or("");

    if frac_part.len() as u32 > exponent {
        return Err(Error::Denom(format!(
            "too many decimal places in {amount}: {} > exponent {exponent}",
            frac_part.len()
        )));
    }

    let padding = exponent as usize - frac_part.len();
    let combined = format!("{int_part}{frac_part}{}", "0".repeat(padding));
    Ok(strip_leading_zeros(&combined))
}

/// Converts an integer base amount string to a normalized display string.
///
/// `base` is a non-negative integer string, e.g. `"1500000"`. The returned
/// display amount has no trailing zeros and no trailing dot, e.g. `"1.5"`.
/// `"1000000"` becomes `"1"`, `"1"` becomes `"0.000001"`, `"0"` becomes `"0"`.
/// Returns an error if `base` is not a valid non-negative integer string.
pub fn from_base(base: &str, exponent: u32) -> Result<String> {
    let trimmed = base.trim();
    if trimmed.starts_with('-') {
        return Err(Error::Denom(format!(
            "negative amounts are not supported: {base}"
        )));
    }
    if !is_uint(trimmed) {
        return Err(Error::Denom(format!("invalid base amount: {base}")));
    }

    let digits = strip_leading_zeros(trimmed);
    if exponent == 0 {
        return Ok(digits);
    }

    let exp = exponent as usize;
    let padded = if digits.len() <= exp {
        format!("{}{}", "0".repeat(exp + 1 - digits.len()), digits)
    } else {
        digits
    };
    let split = padded.len() - exp;
    let int_part = &padded[..split];
    let frac_part = &padded[split..];

    let trimmed_frac = frac_part.trim_end_matches('0');
    if trimmed_frac.is_empty() {
        Ok(int_part.to_string())
    } else {
        Ok(format!("{int_part}.{trimmed_frac}"))
    }
}
