//! Auto-gas estimation and fee calculation, mirroring the TS / Go SDKs.
//!
//! [`estimate_gas`] simulates a signed tx against the REST
//! `/cosmos/tx/v1beta1/simulate` endpoint and returns the gas the chain reports
//! it would use; [`calculate_fee`] turns a gas limit into a [`Fee`] via a
//! multiplier and a [`GasPrice`]; [`estimate_fee`] combines the two.
//!
//! **Exact gas on chain v3.2.5.** From v3.2.5 a simulation already charges the
//! post-quantum verification of a hybrid transaction (2,000 gas per signer), so
//! the simulated gas is what the transaction spends. On a network that has
//! applied `v3.2.5`, the auto-gas path ([`estimate_gas_wanted`],
//! [`estimate_fee`]) sets a hybrid transaction's gas limit to
//! [`exact_hybrid_gas`]: `ceil(simulated * 1.02) + 2000`. Native-lane fees are
//! the full gas limit times the gas price, so the tighter limit is a lower fee.
//! A network below v3.2.5, a failed plan lookup, a classical transaction or an
//! explicit multiplier keep the multiplier path (`ceil(simulated * 1.4)` by
//! default). The plan lookup is cached per REST endpoint
//! ([`crate::upgrades`]).

use crate::error::{Error, Result};
use crate::tx::{Coin, Fee};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::Value;

/// Scales simulated gas to absorb estimation variance.
pub const DEFAULT_GAS_MULTIPLIER: f64 = 1.4;
/// The default price per gas unit, in uqor.
/// The chain enforces a genesis min-gas-price (BaseFee) of `0.1uqor`/gas on
/// both networks; the default sits above the floor for headroom.
pub const DEFAULT_GAS_PRICE: &str = "0.15uqor";
/// The sentinel `Fee.gas` value that requests gas simulation.
pub const GAS_AUTO: &str = "auto";
/// The margin [`exact_hybrid_gas`] puts on a v3.2.5 simulation (2 %).
pub const EXACT_GAS_MULTIPLIER: f64 = 1.02;
/// The fixed headroom [`exact_hybrid_gas`] adds on top of the margin. Added
/// once per transaction, not per signer: the simulation already charges every
/// signer's verification.
pub const EXACT_GAS_HEADROOM: u64 = 2000;

/// The gas limit for a hybrid transaction on a network that has applied
/// `v3.2.5`: `ceil(simulated * 1.02) + 2000`, in integer arithmetic.
pub fn exact_hybrid_gas(simulated: u64) -> u64 {
    // ceil(simulated * 102 / 100) without floating point (100_000 * 1.02 in
    // f64 is 102000.00000000001, which would round up one gas too many).
    ((simulated as u128 * 102).div_ceil(100) as u64).saturating_add(EXACT_GAS_HEADROOM)
}

/// Whether signed `tx_bytes` (a `TxRaw`) carry the hybrid PQC signature
/// extension. Undecodable bytes are not hybrid.
pub fn is_hybrid_tx(tx_bytes: &[u8]) -> bool {
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    use cosmrs::proto::traits::Message as _;
    let Ok(raw) = TxRaw::decode(tx_bytes) else {
        return false;
    };
    let Ok(body) = TxBody::decode(raw.body_bytes.as_slice()) else {
        return false;
    };
    body.extension_options
        .iter()
        .any(|a| a.type_url == crate::pqc::HYBRID_SIG_TYPE_URL)
}

/// Whether the network behind `rest_url` simulates hybrid transactions exactly
/// (it has applied `v3.2.5`). The answer is cached per endpoint (an applied plan
/// for the life of the process, "not yet" for 60 s); a lookup that fails is
/// `false`, which keeps the larger multiplier path.
pub async fn exact_gas_applies(rest_url: &str) -> bool {
    let base = rest_url.trim_end_matches('/');
    let rest = crate::query::RestClient::new(base.to_string());
    crate::upgrades::is_upgrade_applied(&rest, crate::upgrades::CHAIN_UPGRADE_V3_2_5, Some(base))
        .await
        .unwrap_or(false)
}

/// The result of [`estimate_gas_wanted`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GasEstimate {
    /// The gas the simulation reported.
    pub simulated: u64,
    /// The gas limit to sign.
    pub gas_wanted: u64,
    /// Whether the v3.2.5 exact rule ([`exact_hybrid_gas`]) set `gas_wanted`.
    pub exact: bool,
}

fn multiplied(simulated: u64, multiplier: f64) -> u64 {
    let m = if multiplier <= 0.0 {
        DEFAULT_GAS_MULTIPLIER
    } else {
        multiplier
    };
    (simulated as f64 * m).ceil() as u64
}

/// The gas limit for a hybrid transaction that simulated at `simulated`.
///
/// `multiplier > 0` is honoured as `ceil(simulated * multiplier)`. With the
/// default (`multiplier <= 0`) the limit is [`exact_hybrid_gas`] when the
/// network behind `rest_url` has applied `v3.2.5`, else
/// `ceil(simulated * DEFAULT_GAS_MULTIPLIER)` as before.
pub async fn hybrid_gas_wanted(rest_url: &str, simulated: u64, multiplier: f64) -> GasEstimate {
    if multiplier <= 0.0 && exact_gas_applies(rest_url).await {
        return GasEstimate {
            simulated,
            gas_wanted: exact_hybrid_gas(simulated),
            exact: true,
        };
    }
    GasEstimate {
        simulated,
        gas_wanted: multiplied(simulated, multiplier),
        exact: false,
    }
}

/// Simulates signed `tx_bytes` and picks the gas limit: [`hybrid_gas_wanted`]
/// for a hybrid transaction, `ceil(simulated * multiplier)` (default
/// [`DEFAULT_GAS_MULTIPLIER`] when `multiplier <= 0`) for a classical one.
///
/// # Errors
///
/// As [`estimate_gas`].
pub async fn estimate_gas_wanted(
    rest_url: &str,
    tx_bytes: &[u8],
    multiplier: f64,
) -> Result<GasEstimate> {
    let simulated = estimate_gas(rest_url, tx_bytes).await?;
    if is_hybrid_tx(tx_bytes) {
        return Ok(hybrid_gas_wanted(rest_url, simulated, multiplier).await);
    }
    Ok(GasEstimate {
        simulated,
        gas_wanted: multiplied(simulated, multiplier),
        exact: false,
    })
}

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

/// The refusal text of a failed simulate response: its `message` member, else
/// the whole body.
fn simulation_text(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.to_string())
}

/// Simulates a signed tx against the REST simulate endpoint and returns the gas
/// the chain reports it would use.
///
/// `tx_bytes` must be a fully assembled (signed) `TxRaw`; the simulate endpoint
/// does not verify signatures but does require the tx structure.
///
/// A refusal the chain names with a registered error (the simulate response
/// carries the module's message but no code) is returned as [`Error::Tx`] with
/// its codespace and code; any other non-2xx is [`Error::Http`] with the body.
pub async fn estimate_gas(rest_url: &str, tx_bytes: &[u8]) -> Result<u64> {
    let url = format!(
        "{}/cosmos/tx/v1beta1/simulate",
        rest_url.trim_end_matches('/')
    );
    let payload = serde_json::json!({ "tx_bytes": BASE64.encode(tx_bytes) });
    let resp = crate::query::default_http_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        // A refusal the chain names (e.g. stakingtier 12, "no bonus to claim")
        // comes back as `Error::Tx`; anything else keeps the body in `Error::Http`.
        if let Some(named) = super::decode_refusal_text(&simulation_text(&body)) {
            return Err(Error::Tx(named));
        }
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

/// Simulates `tx_bytes` and returns the auto-gas [`Fee`]: the gas limit from
/// [`estimate_gas_wanted`] (exact on v3.2.5 for a hybrid transaction, else
/// `gas_used × multiplier`) times the price.
///
/// Pass an empty `price_str` to use [`DEFAULT_GAS_PRICE`] and a `multiplier <= 0`
/// for the default rule.
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
    let estimate = estimate_gas_wanted(rest_url, tx_bytes, multiplier).await?;
    Ok(calculate_fee(estimate.gas_wanted, 1.0, &price))
}
