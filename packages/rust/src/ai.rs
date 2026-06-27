//! AI pre-flight checks over the EVM JSON-RPC `eth_call` interface.
//!
//! QoreChain exposes two stateless AI precompiles on the EVM that an app can
//! call read-only (via `eth_call`) before submitting a transaction:
//!
//! - `aiRiskScore(bytes) returns (uint256 score, uint8 level)` at
//!   [`AI_RISK_SCORE_PRECOMPILE`] — scores arbitrary calldata / tx bytes for
//!   risk; `level` is a coarse 0..=4 bucket (higher is riskier).
//! - `aiAnomalyCheck(address,uint256) returns (uint256 anomalyScore, bool flagged)`
//!   at [`AI_ANOMALY_CHECK_PRECOMPILE`] — scores a `(sender, amount)` pair for
//!   anomalous-transfer patterns; `flagged` is the engine's boolean verdict.
//!
//! These mirror the `aiRiskScore` / `aiAnomalyCheck` / `simulateWithRiskScore`
//! surface of the canonical TypeScript SDK. The ABI is encoded by hand (no
//! `ethabi` dependency): the 4-byte selector is `keccak256(signature)[..4]` and
//! arguments follow the standard ABI head/tail layout.
//!
//! ## Advisory only
//!
//! [`AiClient::simulate_with_risk_score`] combines an `eth_estimateGas` gas
//! estimate with both AI scores and returns a `safe` hint
//! (`level < 3 && !flagged`). This is **advisory**: it never blocks or rewrites
//! a transaction. The authoritative decision is always made on-chain by the
//! validators' ante handlers when the tx is actually submitted; treat `safe` as
//! a client-side pre-flight signal, not a guarantee.
//!
//! ## Numeric representation
//!
//! Each returned `uint256` word is decoded into a [`Score`]: the full 32 big-
//! endian bytes are preserved in [`Score::bytes`], and a convenience `u128`
//! (`as_u128`) is offered for the common case of a small score. `as_u128`
//! returns `None` when the value does not fit in 128 bits, so no silent
//! truncation occurs.

use crate::error::{Error, Result};
use crate::query::JsonRpcClient;
use crate::utils::keccak256;
use serde_json::{json, Value};

/// The `aiRiskScore(bytes)` precompile address.
pub const AI_RISK_SCORE_PRECOMPILE: &str = "0x0000000000000000000000000000000000000B01";
/// The `aiAnomalyCheck(address,uint256)` precompile address.
pub const AI_ANOMALY_CHECK_PRECOMPILE: &str = "0x0000000000000000000000000000000000000B02";

/// A decoded `uint256` AI score: the raw 32 big-endian bytes plus a `u128`
/// convenience accessor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Score {
    /// The full 32-byte big-endian word returned by the precompile.
    pub bytes: [u8; 32],
}

impl Score {
    /// Builds a [`Score`] from a 32-byte big-endian word.
    pub fn from_word(bytes: [u8; 32]) -> Self {
        Self { bytes }
    }

    /// Returns the score as a `u128`, or `None` if it does not fit in 128 bits
    /// (i.e. any of the high 16 bytes is non-zero).
    pub fn as_u128(&self) -> Option<u128> {
        if self.bytes[..16].iter().any(|&b| b != 0) {
            return None;
        }
        let mut low = [0u8; 16];
        low.copy_from_slice(&self.bytes[16..]);
        Some(u128::from_be_bytes(low))
    }

    /// Returns the score as a lowercase `0x`-prefixed 32-byte hex string.
    pub fn to_hex(&self) -> String {
        format!("0x{}", hex::encode(self.bytes))
    }
}

/// The result of [`AiClient::ai_risk_score`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskScore {
    /// The raw risk score (`uint256`).
    pub score: Score,
    /// The coarse risk level bucket (`uint8`, conventionally 0..=4; higher is
    /// riskier).
    pub level: u8,
}

/// The result of [`AiClient::ai_anomaly_check`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anomaly {
    /// The raw anomaly score (`uint256`).
    pub anomaly_score: Score,
    /// The engine's boolean anomaly verdict.
    pub flagged: bool,
}

/// A transaction to pre-flight with [`AiClient::simulate_with_risk_score`].
#[derive(Debug, Clone, Default)]
pub struct PreflightTx {
    /// The sender (`from`) address (`0x`-prefixed, 20 bytes).
    pub from: String,
    /// The recipient (`to`) address (`0x`-prefixed, 20 bytes). Empty for a
    /// contract-creation gas estimate.
    pub to: String,
    /// The transaction calldata / input bytes. Used both for the gas estimate
    /// and as the `aiRiskScore` input.
    pub data: Vec<u8>,
    /// The transfer value in wei, as a base-10 string (e.g. `"1000000"`). Empty
    /// is treated as `0`. Also fed (as a `u128`) to `aiAnomalyCheck`.
    pub value: String,
}

/// The advisory result of [`AiClient::simulate_with_risk_score`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preflight {
    /// The estimated gas (`eth_estimateGas`).
    pub gas: u64,
    /// The risk-score result for the calldata.
    pub risk: RiskScore,
    /// The anomaly-check result for `(from, value)`.
    pub anomaly: Anomaly,
    /// Advisory safety hint: `risk.level < 3 && !anomaly.flagged`. Advisory only
    /// — the chain makes the authoritative decision at submission time.
    pub safe: bool,
}

/// A client for the EVM AI pre-flight precompiles, layered on the EVM JSON-RPC
/// transport ([`JsonRpcClient`]).
#[derive(Debug, Clone)]
pub struct AiClient {
    rpc: JsonRpcClient,
}

impl AiClient {
    /// Creates an `AiClient` targeting the given EVM JSON-RPC URL using a fresh
    /// HTTP client.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            rpc: JsonRpcClient::new(url),
        }
    }

    /// Creates an `AiClient` from an existing JSON-RPC client (e.g. the one the
    /// `qor_*` client uses).
    pub fn from_jsonrpc(rpc: JsonRpcClient) -> Self {
        Self { rpc }
    }

    /// Access the underlying JSON-RPC transport.
    pub fn rpc(&self) -> &JsonRpcClient {
        &self.rpc
    }

    /// Calls `aiRiskScore(bytes)` on the risk-score precompile via `eth_call`.
    ///
    /// Returns the raw `uint256 score` and the `uint8 level` bucket.
    pub async fn ai_risk_score(&self, tx_data: &[u8]) -> Result<RiskScore> {
        let calldata = encode_risk_score_call(tx_data);
        let ret = self
            .eth_call(AI_RISK_SCORE_PRECOMPILE, &calldata)
            .await?;
        let (w0, w1) = decode_two_words(&ret)?;
        Ok(RiskScore {
            score: Score::from_word(w0),
            level: word_to_u8(&w1),
        })
    }

    /// Calls `aiAnomalyCheck(address,uint256)` on the anomaly-check precompile
    /// via `eth_call`.
    ///
    /// `sender` is a `0x`-prefixed 20-byte address; `amount` is the value in
    /// wei.
    pub async fn ai_anomaly_check(&self, sender: &str, amount: u128) -> Result<Anomaly> {
        let calldata = encode_anomaly_check_call(sender, amount)?;
        let ret = self
            .eth_call(AI_ANOMALY_CHECK_PRECOMPILE, &calldata)
            .await?;
        let (w0, w1) = decode_two_words(&ret)?;
        Ok(Anomaly {
            anomaly_score: Score::from_word(w0),
            flagged: word_to_bool(&w1),
        })
    }

    /// Runs a full pre-flight over `tx`: estimates gas (`eth_estimateGas`),
    /// scores the calldata risk, and checks the `(from, value)` anomaly. Returns
    /// an advisory [`Preflight`] with a `safe` hint.
    ///
    /// `safe = risk.level < 3 && !anomaly.flagged`. This is advisory only — the
    /// chain makes the authoritative decision when the tx is submitted.
    pub async fn simulate_with_risk_score(&self, tx: PreflightTx) -> Result<Preflight> {
        let gas = self.estimate_gas(&tx).await?;
        let risk = self.ai_risk_score(&tx.data).await?;
        let amount = parse_wei_u128(&tx.value)?;
        let anomaly = self.ai_anomaly_check(&tx.from, amount).await?;
        let safe = risk.level < 3 && !anomaly.flagged;
        Ok(Preflight {
            gas,
            risk,
            anomaly,
            safe,
        })
    }

    // --- internal transport helpers ---

    /// Performs an `eth_call` against `to` with the given calldata and decodes
    /// the `0x`-prefixed hex return value into bytes.
    async fn eth_call(&self, to: &str, calldata: &[u8]) -> Result<Vec<u8>> {
        let params = json!([
            { "to": to, "data": bytes_to_hex(calldata) },
            "latest"
        ]);
        let ret = self.rpc.call("eth_call", params).await?;
        hex_value_to_bytes(&ret)
    }

    /// Performs an `eth_estimateGas` for the pre-flight tx and parses the
    /// quantity.
    async fn estimate_gas(&self, tx: &PreflightTx) -> Result<u64> {
        let mut call = serde_json::Map::new();
        if !tx.from.is_empty() {
            call.insert("from".into(), Value::String(tx.from.clone()));
        }
        if !tx.to.is_empty() {
            call.insert("to".into(), Value::String(tx.to.clone()));
        }
        if !tx.data.is_empty() {
            call.insert("data".into(), Value::String(bytes_to_hex(&tx.data)));
        }
        let value_u128 = parse_wei_u128(&tx.value)?;
        if value_u128 != 0 {
            call.insert("value".into(), Value::String(format!("0x{value_u128:x}")));
        }
        let ret = self
            .rpc
            .call("eth_estimateGas", json!([Value::Object(call)]))
            .await?;
        parse_hex_quantity(&ret)
    }
}

// --- ABI encoding (by hand) ---

/// Returns the 4-byte function selector `keccak256(signature)[..4]`.
fn selector(signature: &str) -> [u8; 4] {
    let hash = keccak256(signature.as_bytes());
    let mut out = [0u8; 4];
    out.copy_from_slice(&hash[..4]);
    out
}

/// ABI-encodes `aiRiskScore(bytes)`: selector + dynamic `bytes` (offset 0x20,
/// length word, right-padded data to a 32-byte boundary).
fn encode_risk_score_call(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 64 + data.len() + 31);
    out.extend_from_slice(&selector("aiRiskScore(bytes)"));
    // head: offset to the dynamic bytes argument = 0x20.
    out.extend_from_slice(&u256_word(0x20));
    // tail: length, then the right-padded data.
    out.extend_from_slice(&u256_word(data.len() as u128));
    out.extend_from_slice(data);
    let rem = data.len() % 32;
    if rem != 0 {
        out.extend(std::iter::repeat(0u8).take(32 - rem));
    }
    out
}

/// ABI-encodes `aiAnomalyCheck(address,uint256)`: selector + 32-byte left-padded
/// address + 32-byte big-endian uint.
fn encode_anomaly_check_call(sender: &str, amount: u128) -> Result<Vec<u8>> {
    let addr = parse_address_20(sender)?;
    let mut out = Vec::with_capacity(4 + 64);
    out.extend_from_slice(&selector("aiAnomalyCheck(address,uint256)"));
    // address: left-padded to 32 bytes (12 zero bytes + 20 address bytes).
    let mut addr_word = [0u8; 32];
    addr_word[12..].copy_from_slice(&addr);
    out.extend_from_slice(&addr_word);
    // uint256 amount.
    out.extend_from_slice(&u256_word(amount));
    Ok(out)
}

/// Encodes a `u128` as a 32-byte big-endian ABI word.
fn u256_word(value: u128) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[16..].copy_from_slice(&value.to_be_bytes());
    word
}

// --- ABI decoding ---

/// Splits an ABI return value into its first two 32-byte words.
fn decode_two_words(ret: &[u8]) -> Result<([u8; 32], [u8; 32])> {
    if ret.len() < 64 {
        return Err(Error::InvalidResponse(format!(
            "eth_call returned {} bytes, expected at least 64 (two words)",
            ret.len()
        )));
    }
    let mut w0 = [0u8; 32];
    let mut w1 = [0u8; 32];
    w0.copy_from_slice(&ret[..32]);
    w1.copy_from_slice(&ret[32..64]);
    Ok((w0, w1))
}

/// Interprets an ABI word as a `uint8` (the low byte).
fn word_to_u8(word: &[u8; 32]) -> u8 {
    word[31]
}

/// Interprets an ABI word as a `bool` (non-zero is true).
fn word_to_bool(word: &[u8; 32]) -> bool {
    word.iter().any(|&b| b != 0)
}

// --- hex / address helpers ---

/// Encodes bytes as a lowercase `0x`-prefixed hex string.
fn bytes_to_hex(data: &[u8]) -> String {
    format!("0x{}", hex::encode(data))
}

/// Decodes a JSON `0x`-prefixed hex string (an `eth_call` data result) into
/// bytes.
fn hex_value_to_bytes(v: &Value) -> Result<Vec<u8>> {
    let s = v
        .as_str()
        .ok_or_else(|| Error::InvalidResponse(format!("expected hex string, got {v}")))?;
    let body = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    hex::decode(body).map_err(|e| Error::InvalidResponse(format!("invalid hex in eth_call result: {e}")))
}

/// Parses an `eth_estimateGas` `0x`-prefixed hex quantity into a `u64`.
fn parse_hex_quantity(v: &Value) -> Result<u64> {
    let s = v
        .as_str()
        .ok_or_else(|| Error::InvalidResponse(format!("expected hex quantity, got {v}")))?;
    let body = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    if body.is_empty() {
        return Err(Error::InvalidResponse("empty hex quantity".into()));
    }
    u64::from_str_radix(body, 16)
        .map_err(|e| Error::InvalidResponse(format!("invalid hex quantity {s:?}: {e}")))
}

/// Parses a `0x`-prefixed 20-byte (40-hex-char) address into raw bytes.
fn parse_address_20(s: &str) -> Result<[u8; 20]> {
    let body = s
        .strip_prefix("0x")
        .or_else(|| s.strip_prefix("0X"))
        .ok_or_else(|| Error::Address(format!("EVM address must be 0x-prefixed: {s}")))?;
    if body.len() != 40 {
        return Err(Error::Address(format!(
            "EVM address must be 20 bytes (40 hex chars): {s}"
        )));
    }
    let raw = hex::decode(body).map_err(|e| Error::Address(format!("invalid EVM address {s}: {e}")))?;
    let mut out = [0u8; 20];
    out.copy_from_slice(&raw);
    Ok(out)
}

/// Parses a base-10 wei string into a `u128`. Empty is `0`.
fn parse_wei_u128(s: &str) -> Result<u128> {
    let t = s.trim();
    if t.is_empty() {
        return Ok(0);
    }
    t.parse::<u128>()
        .map_err(|_| Error::Denom(format!("invalid wei amount: {s:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectors_match_keccak() {
        // Sanity-check the hand-encoded selectors against keccak256(sig)[..4].
        assert_eq!(selector("aiRiskScore(bytes)"), {
            let h = keccak256(b"aiRiskScore(bytes)");
            [h[0], h[1], h[2], h[3]]
        });
        assert_eq!(selector("aiAnomalyCheck(address,uint256)"), {
            let h = keccak256(b"aiAnomalyCheck(address,uint256)");
            [h[0], h[1], h[2], h[3]]
        });
    }

    #[test]
    fn risk_score_encoding_layout() {
        let enc = encode_risk_score_call(&[0xaa, 0xbb, 0xcc]);
        // 4 selector + 32 offset + 32 length + 32 padded data.
        assert_eq!(enc.len(), 4 + 32 + 32 + 32);
        // offset word == 0x20.
        assert_eq!(enc[4 + 31], 0x20);
        // length word == 3.
        assert_eq!(enc[4 + 32 + 31], 3);
        // data right-padded.
        assert_eq!(&enc[4 + 64..4 + 64 + 3], &[0xaa, 0xbb, 0xcc]);
        assert!(enc[4 + 64 + 3..].iter().all(|&b| b == 0));
    }

    #[test]
    fn risk_score_empty_data_has_no_tail_padding() {
        let enc = encode_risk_score_call(&[]);
        assert_eq!(enc.len(), 4 + 32 + 32);
        assert_eq!(enc[4 + 32 + 31], 0);
    }

    #[test]
    fn anomaly_encoding_layout() {
        let enc =
            encode_anomaly_check_call("0x000000000000000000000000000000000000dEaD", 1_000_000)
                .unwrap();
        assert_eq!(enc.len(), 4 + 32 + 32);
        // address left-padded: 12 zero bytes then the 20 address bytes.
        assert!(enc[4..4 + 12].iter().all(|&b| b == 0));
        assert_eq!(enc[4 + 30], 0xde);
        assert_eq!(enc[4 + 31], 0xad);
        // amount in the low bytes of the second word.
        let mut low = [0u8; 16];
        low.copy_from_slice(&enc[4 + 32 + 16..]);
        assert_eq!(u128::from_be_bytes(low), 1_000_000);
    }

    #[test]
    fn score_u128_and_overflow() {
        let small = Score::from_word(u256_word(42));
        assert_eq!(small.as_u128(), Some(42));
        let mut big = [0u8; 32];
        big[0] = 1; // high byte set -> doesn't fit in u128.
        assert_eq!(Score::from_word(big).as_u128(), None);
    }

    #[test]
    fn word_decoders() {
        let mut w = [0u8; 32];
        w[31] = 4;
        assert_eq!(word_to_u8(&w), 4);
        assert!(word_to_bool(&w));
        assert!(!word_to_bool(&[0u8; 32]));
    }

    #[test]
    fn parse_address_rejects_bad_input() {
        assert!(parse_address_20("0xdead").is_err());
        assert!(parse_address_20("000000000000000000000000000000000000dEaD").is_err());
        assert!(parse_address_20("0x000000000000000000000000000000000000dEaD").is_ok());
    }
}
