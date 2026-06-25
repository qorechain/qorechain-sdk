//! Auto-gas estimation and fee calculation, mirroring the TS / Go SDKs.
//!
//! [`estimate_gas`] simulates a signed tx against the REST
//! `/cosmos/tx/v1beta1/simulate` endpoint and returns the gas the chain reports
//! it would use; [`calculate_fee`] turns a gas limit into a [`Fee`] via a
//! multiplier and a [`GasPrice`]; [`estimate_fee`] combines the two.

use crate::error::{Error, Result};
use crate::tx::{Coin, Fee};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::Value;

/// Scales simulated gas to absorb estimation variance.
pub const DEFAULT_GAS_MULTIPLIER: f64 = 1.4;
/// The default price per gas unit, in uqor.
pub const DEFAULT_GAS_PRICE: &str = "0.025uqor";
/// The sentinel `Fee.gas` value that requests gas simulation.
pub const GAS_AUTO: &str = "auto";

/// A parsed price per unit of gas: an exact decimal amount plus a denom.
///
/// The amount is kept as `(scaled, scale)` where the real value is
/// `scaled / 10^scale`, so fee math stays exact (no floating point on the
/// price).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GasPrice {
    /// The price numerator (the decimal digits with the point removed).
    pub scaled: u128,
    /// The number of fractional digits (the power of ten the numerator is over).
    pub scale: u32,
    /// The fee denom (e.g. `"uqor"`).
    pub denom: String,
}

impl GasPrice {
    /// Parses a gas price string like `"0.025uqor"` into a [`GasPrice`].
    pub fn parse(s: &str) -> Result<Self> {
        let s = s.trim();
        // Split the numeric prefix (digits + at most one '.') from the denom.
        let split = s
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(s.len());
        if split == 0 || split == s.len() {
            return Err(Error::Denom(format!("invalid gas price: {s:?}")));
        }
        let (num, denom) = s.split_at(split);
        let (int_part, frac_part) = match num.split_once('.') {
            Some((i, f)) => (i, f),
            None => (num, ""),
        };
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(Error::Denom(format!("invalid gas price amount: {num:?}")));
        }
        if !int_part.bytes().all(|b| b.is_ascii_digit())
            || !frac_part.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(Error::Denom(format!("invalid gas price amount: {num:?}")));
        }
        let combined = format!("{int_part}{frac_part}");
        let scaled = combined
            .parse::<u128>()
            .map_err(|_| Error::Denom(format!("invalid gas price amount: {num:?}")))?;
        Ok(GasPrice {
            scaled,
            scale: frac_part.len() as u32,
            denom: denom.to_string(),
        })
    }
}

/// Computes a [`Fee`] from a gas limit, a multiplier, and a gas price.
///
/// `gas_limit` is multiplied by `multiplier` (rounded up) to obtain the fee gas;
/// the fee amount is `ceil(fee_gas * price)` in the price's denom. A
/// `multiplier <= 0` falls back to [`DEFAULT_GAS_MULTIPLIER`].
pub fn calculate_fee(gas_limit: u64, multiplier: f64, price: &GasPrice) -> Fee {
    let multiplier = if multiplier <= 0.0 {
        DEFAULT_GAS_MULTIPLIER
    } else {
        multiplier
    };
    let fee_gas = (gas_limit as f64 * multiplier).ceil() as u64;
    // amount = ceil(fee_gas * scaled / 10^scale), all integer.
    let numerator = (fee_gas as u128) * price.scaled;
    let divisor = 10u128.pow(price.scale);
    let amount = numerator.div_ceil(divisor);
    Fee {
        amount: vec![Coin {
            denom: price.denom.clone(),
            amount: amount.to_string(),
        }],
        gas: fee_gas.to_string(),
        granter: String::new(),
        payer: String::new(),
    }
}

/// Simulates a signed tx against the REST simulate endpoint and returns the gas
/// the chain reports it would use.
///
/// `tx_bytes` must be a fully assembled (signed) `TxRaw`; the simulate endpoint
/// does not verify signatures but does require the tx structure.
pub async fn estimate_gas(rest_url: &str, tx_bytes: &[u8]) -> Result<u64> {
    let url = format!(
        "{}/cosmos/tx/v1beta1/simulate",
        rest_url.trim_end_matches('/')
    );
    let payload = serde_json::json!({ "tx_bytes": BASE64.encode(tx_bytes) });
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::Http {
            status: status.as_u16(),
            url,
            body,
        });
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| Error::InvalidResponse(e.to_string()))?;
    let gas_used = &v["gas_info"]["gas_used"];
    let gas_used = match gas_used {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => {
            return Err(Error::InvalidResponse(format!(
                "simulate response missing gas_info.gas_used: {body}"
            )))
        }
    };
    gas_used
        .parse::<u64>()
        .map_err(|_| Error::InvalidResponse(format!("invalid gas_used: {gas_used:?}")))
}

/// Simulates `tx_bytes` and returns the auto-gas [`Fee`] (`gas_used × multiplier
/// × price`).
///
/// Pass an empty `price_str` to use [`DEFAULT_GAS_PRICE`] and a `multiplier <= 0`
/// to use [`DEFAULT_GAS_MULTIPLIER`].
pub async fn estimate_fee(
    rest_url: &str,
    tx_bytes: &[u8],
    multiplier: f64,
    price_str: &str,
) -> Result<Fee> {
    let price_str = if price_str.is_empty() {
        DEFAULT_GAS_PRICE
    } else {
        price_str
    };
    let price = GasPrice::parse(price_str)?;
    let gas_used = estimate_gas(rest_url, tx_bytes).await?;
    Ok(calculate_fee(gas_used, multiplier, &price))
}
