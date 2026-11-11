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
/// To follow the chain's current minimum instead (opt-in, one network read),
/// use [`recommended_gas_price_uqor`] / [`fetch_min_gas_price_uqor`].
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

/// The largest gas limit a Native-lane (Cosmos) transaction may declare (the
/// chain default from v3.2.8). The builders refuse a larger one before
/// signing.
pub const MAX_COSMOS_TX_GAS: u64 = 50_000_000;

/// The EVM transaction gas cap in force on chain v3.2.8, used when it is not
/// queried ([`fetch_evm_limits`]). A transaction above it is refused.
pub const DEFAULT_EVM_TX_MAX_GAS: u64 = 30_000_000;

/// The smallest multiplier the auto-gas path puts on a simulated transaction
/// that carries a CosmWasm execute / instantiate / migrate or a
/// `MsgCrossVMCall`: the first call of a contract code in a block costs much
/// more than a repeat (a cw20 transfer about 533k gas against about 84k), so
/// simulation can come in low.
pub const WASM_MIN_GAS_MULTIPLIER: f64 = 1.3;

/// The message type URLs whose gas needs simulation (no fixed fallback) and
/// at least [`WASM_MIN_GAS_MULTIPLIER`] headroom.
pub const SIMULATION_REQUIRED_TYPE_URLS: [&str; 5] = [
    "/cosmwasm.wasm.v1.MsgExecuteContract",
    "/cosmwasm.wasm.v1.MsgInstantiateContract",
    "/cosmwasm.wasm.v1.MsgInstantiateContract2",
    "/cosmwasm.wasm.v1.MsgMigrateContract",
    "/qorechain.crossvm.v1.MsgCrossVMCall",
];

/// Whether any of `type_urls` is a CosmWasm execute / instantiate / migrate
/// or a `MsgCrossVMCall` ([`SIMULATION_REQUIRED_TYPE_URLS`]). Such a
/// transaction must not use a fixed fallback gas: simulate (`"auto"`) or set
/// the gas limit explicitly.
pub fn needs_simulated_gas<'a>(type_urls: impl IntoIterator<Item = &'a str>) -> bool {
    type_urls
        .into_iter()
        .any(|t| SIMULATION_REQUIRED_TYPE_URLS.contains(&t))
}

/// [`needs_simulated_gas`] for the messages of signed `tx_bytes` (a `TxRaw`).
/// Undecodable bytes are `false`.
pub fn tx_needs_simulated_gas(tx_bytes: &[u8]) -> bool {
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    use cosmrs::proto::traits::Message as _;
    let Ok(raw) = TxRaw::decode(tx_bytes) else {
        return false;
    };
    let Ok(body) = TxBody::decode(raw.body_bytes.as_slice()) else {
        return false;
    };
    needs_simulated_gas(body.messages.iter().map(|m| m.type_url.as_str()))
}

/// Refuses a fixed fallback gas for messages that need simulation
/// ([`needs_simulated_gas`]). Call it where a fixed gas (for example 200,000)
/// would be used because simulation failed or was skipped.
///
/// # Errors
///
/// [`Error::InvalidInput`] asking for `"auto"` or an explicit gas limit.
pub fn refuse_fixed_gas_for<'a>(type_urls: impl IntoIterator<Item = &'a str>) -> Result<()> {
    if needs_simulated_gas(type_urls) {
        return Err(Error::InvalidInput(
            "this transaction carries a CosmWasm or cross-VM message, whose gas varies (the first \
             call of a code in a block costs several times a repeat): use \"auto\" (simulation) \
             or an explicit gas limit, not a fixed fallback"
                .into(),
        ));
    }
    Ok(())
}

/// Refuses a Native-lane gas limit above [`MAX_COSMOS_TX_GAS`].
///
/// # Errors
///
/// [`Error::InvalidInput`] naming the limit.
pub fn validate_cosmos_gas_limit(gas_limit: u64) -> Result<()> {
    if gas_limit > MAX_COSMOS_TX_GAS {
        return Err(Error::InvalidInput(format!(
            "gas limit {gas_limit} is above the chain's Cosmos transaction cap of {MAX_COSMOS_TX_GAS}"
        )));
    }
    Ok(())
}

/// The EVM execution limits in force (`GET /qorechain/pqc/v1/evm_limits`,
/// chain v3.2.8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvmLimits {
    /// The largest gas limit an EVM transaction may declare.
    pub tx_max_gas: u64,
    /// The largest precompile input, in bytes.
    pub precompile_input_max_bytes: u64,
}

/// The REST path of the EVM limits.
pub const EVM_LIMITS_PATH: &str = "/qorechain/pqc/v1/evm_limits";

/// Parses an `evm_limits` answer: the top-level values in force, falling back
/// to the `limits` object for a field the top level lacks or has at zero.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when a number does not parse.
pub fn parse_evm_limits(v: &Value) -> Result<EvmLimits> {
    let num = |o: &Value, f: &str| -> Result<u64> {
        match o.get(f) {
            None | Some(Value::Null) => Ok(0),
            Some(Value::String(s)) if s.is_empty() => Ok(0),
            Some(Value::String(s)) => s
                .trim()
                .parse()
                .map_err(|_| Error::InvalidResponse(format!("evm_limits {f} {s:?}"))),
            Some(Value::Number(n)) => n
                .as_u64()
                .ok_or_else(|| Error::InvalidResponse(format!("evm_limits {f} {n}"))),
            Some(other) => Err(Error::InvalidResponse(format!("evm_limits {f} {other}"))),
        }
    };
    let pick = |f: &str| -> Result<u64> {
        let top = num(v, f)?;
        if top != 0 {
            return Ok(top);
        }
        num(&v["limits"], f)
    };
    Ok(EvmLimits {
        tx_max_gas: pick("tx_max_gas")?,
        precompile_input_max_bytes: pick("precompile_input_max_bytes")?,
    })
}

/// Reads the EVM execution limits (`GET /qorechain/pqc/v1/evm_limits`).
///
/// # Errors
///
/// Transport / HTTP errors (a node below v3.2.8 has no such route), or
/// [`Error::InvalidResponse`].
pub async fn fetch_evm_limits(rest: &crate::query::RestClient) -> Result<EvmLimits> {
    parse_evm_limits(&rest.get(EVM_LIMITS_PATH, &[]).await?)
}

/// Refuses an EVM gas limit above `cap` (or [`DEFAULT_EVM_TX_MAX_GAS`] when
/// `cap` is `None` or 0), before anything is signed.
///
/// # Errors
///
/// [`Error::InvalidInput`] naming the cap.
pub fn validate_evm_gas_limit(gas_limit: u64, cap: Option<u64>) -> Result<()> {
    let cap = cap.filter(|c| *c > 0).unwrap_or(DEFAULT_EVM_TX_MAX_GAS);
    if gas_limit > cap {
        return Err(Error::InvalidInput(format!(
            "EVM gas limit {gas_limit} is above the chain's EVM gas cap of {cap}"
        )));
    }
    Ok(())
}

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
/// A transaction that carries a CosmWasm execute / instantiate / migrate or a
/// `MsgCrossVMCall` gets at least `ceil(simulated * 1.3)`
/// ([`WASM_MIN_GAS_MULTIPLIER`]): use auto / simulation for wasm and cross-VM
/// gas.
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
    let mut estimate = if is_hybrid_tx(tx_bytes) {
        hybrid_gas_wanted(rest_url, simulated, multiplier).await
    } else {
        GasEstimate {
            simulated,
            gas_wanted: multiplied(simulated, multiplier),
            exact: false,
        }
    };
    if tx_needs_simulated_gas(tx_bytes) {
        let floor = multiplied(simulated, WASM_MIN_GAS_MULTIPLIER);
        if estimate.gas_wanted < floor {
            estimate.gas_wanted = floor;
            estimate.exact = false;
        }
    }
    Ok(estimate)
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

// ---- the chain's minimum gas price (opt-in network read) ----

/// The REST path of the feemarket parameters, whose `min_gas_price` is the
/// minimum the chain enforces.
pub const FEEMARKET_PARAMS_PATH: &str = "/cosmos/evm/feemarket/v1/params";

/// The genesis floor, in uqor per gas, below which the helpers never go.
pub const MIN_GAS_PRICE_FLOOR_UQOR: &str = "0.1";
/// The lowest price [`recommended_gas_price_uqor`] returns, in uqor per gas
/// (the same as [`DEFAULT_GAS_PRICE`]).
pub const RECOMMENDED_GAS_PRICE_FLOOR_UQOR: &str = "0.15";

/// An exact non-negative decimal as `(digits, scale)`.
fn parse_decimal(s: &str) -> Result<(u128, u32)> {
    let s = s.trim();
    let (i, f) = s.split_once('.').unwrap_or((s, ""));
    if (i.is_empty() && f.is_empty())
        || !i.bytes().all(|b| b.is_ascii_digit())
        || !f.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(Error::InvalidResponse(format!("not a decimal: {s:?}")));
    }
    let digits = format!("{i}{f}");
    let digits = digits.trim_start_matches('0');
    let n = if digits.is_empty() {
        0
    } else {
        digits
            .parse::<u128>()
            .map_err(|_| Error::InvalidResponse(format!("decimal too large: {s:?}")))?
    };
    Ok((n, f.len() as u32))
}

fn normalize(mut n: u128, mut scale: u32) -> (u128, u32) {
    while scale > 0 && n % 10 == 0 {
        n /= 10;
        scale -= 1;
    }
    if n == 0 {
        scale = 0;
    }
    (n, scale)
}

fn cmp_dec(a: (u128, u32), b: (u128, u32)) -> std::cmp::Ordering {
    let s = a.1.max(b.1);
    let up = |x: (u128, u32)| x.0.saturating_mul(10u128.pow(s - x.1));
    up(a).cmp(&up(b))
}

fn uqor_price((n, scale): (u128, u32)) -> GasPrice {
    let (scaled, scale) = normalize(n, scale);
    GasPrice {
        scaled,
        scale,
        denom: "uqor".into(),
    }
}

/// The minimum gas price in uqor per gas from a feemarket params answer:
/// `params.min_gas_price` (18-decimal EVM unit) divided by 10^12, exactly,
/// and never below [`MIN_GAS_PRICE_FLOOR_UQOR`].
///
/// # Errors
///
/// [`Error::InvalidResponse`] when `min_gas_price` is missing or not a decimal.
pub fn min_gas_price_uqor_from_params(body: &Value) -> Result<GasPrice> {
    let raw = body["params"]["min_gas_price"]
        .as_str()
        .or_else(|| body["min_gas_price"].as_str())
        .ok_or_else(|| Error::InvalidResponse("feemarket params carry no min_gas_price".into()))?;
    let (n, scale) = parse_decimal(raw)?;
    let price = normalize(n, scale + 12);
    let floor = parse_decimal(MIN_GAS_PRICE_FLOOR_UQOR)?;
    Ok(uqor_price(if cmp_dec(price, floor).is_lt() {
        floor
    } else {
        price
    }))
}

/// The recommended price for a minimum: `max(0.15, min * margin)` in uqor per
/// gas, exact. `margin` is a decimal string such as `"1.5"`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when `margin` is not a decimal.
pub fn recommended_gas_price_from_min(min: &GasPrice, margin: &str) -> Result<GasPrice> {
    let (m, ms) = parse_decimal(margin).map_err(|_| {
        Error::InvalidInput(format!("gas price margin {margin:?} is not a decimal"))
    })?;
    let product = (
        min.scaled
            .checked_mul(m)
            .ok_or_else(|| Error::InvalidInput("gas price times margin overflows".into()))?,
        min.scale + ms,
    );
    let floor = parse_decimal(RECOMMENDED_GAS_PRICE_FLOOR_UQOR)?;
    Ok(uqor_price(if cmp_dec(product, floor).is_lt() {
        floor
    } else {
        product
    }))
}

/// Reads the minimum gas price the chain enforces, in uqor per gas
/// (`GET /cosmos/evm/feemarket/v1/params`, see
/// [`min_gas_price_uqor_from_params`]). Opt-in: the default gas price
/// ([`DEFAULT_GAS_PRICE`]) does not use it, and no default path makes this
/// call. Useful if governance moves the minimum within its band.
///
/// # Errors
///
/// Transport / HTTP errors, or [`Error::InvalidResponse`].
pub async fn fetch_min_gas_price_uqor(rest: &crate::query::RestClient) -> Result<GasPrice> {
    min_gas_price_uqor_from_params(&rest.get(FEEMARKET_PARAMS_PATH, &[]).await?)
}

/// [`fetch_min_gas_price_uqor`] times `margin` (a decimal string; `"1.5"` is
/// the usual choice), never below [`RECOMMENDED_GAS_PRICE_FLOOR_UQOR`]. Pass
/// the result's [`GasPrice`] to [`calculate_fee`]. Opt-in, as
/// [`fetch_min_gas_price_uqor`].
///
/// # Errors
///
/// As [`fetch_min_gas_price_uqor`] and [`recommended_gas_price_from_min`].
pub async fn recommended_gas_price_uqor(
    rest: &crate::query::RestClient,
    margin: &str,
) -> Result<GasPrice> {
    let min = fetch_min_gas_price_uqor(rest).await?;
    recommended_gas_price_from_min(&min, margin)
}

impl std::fmt::Display for GasPrice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let digits = self.scaled.to_string();
        let scale = self.scale as usize;
        if scale == 0 {
            return write!(f, "{digits}{}", self.denom);
        }
        let padded = format!("{digits:0>width$}", width = scale + 1);
        let (i, frac) = padded.split_at(padded.len() - scale);
        write!(f, "{i}.{frac}{}", self.denom)
    }
}
