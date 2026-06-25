//! Transaction tracking: poll for inclusion, broadcast-and-wait, and retry,
//! mirroring the TS / Go SDKs.

use crate::error::{Error, Result};
use crate::tx::errors::decode_tx_error;
use crate::tx::{broadcast, BroadcastMode};
use serde_json::Value;
use std::future::Future;
use std::time::Duration;

/// Default polling timeout for [`wait_for_tx`].
pub const DEFAULT_WAIT_TIMEOUT: Duration = Duration::from_secs(60);
/// Default poll interval for [`wait_for_tx`].
pub const DEFAULT_WAIT_POLL: Duration = Duration::from_secs(2);

/// Polling options for [`wait_for_tx`]. `None` fields fall back to the defaults
/// (60s timeout, 2s poll).
#[derive(Debug, Clone, Copy, Default)]
pub struct WaitOptions {
    /// Overall timeout before giving up.
    pub timeout: Option<Duration>,
    /// The interval between polls.
    pub poll: Option<Duration>,
}

/// The confirmed on-chain result of a transaction.
#[derive(Debug, Clone)]
pub struct TxResult {
    /// The tx hash.
    pub tx_hash: String,
    /// The block height the tx was included in.
    pub height: i64,
    /// The ABCI result code (0 = success).
    pub code: u32,
    /// The error codespace (empty on success).
    pub codespace: String,
    /// Gas requested.
    pub gas_wanted: i64,
    /// Gas consumed.
    pub gas_used: i64,
    /// The chain's `raw_log` string.
    pub raw_log: String,
    /// The full `/cosmos/tx/v1beta1/txs/{hash}` JSON response.
    pub raw: Value,
}

/// Polls the REST tx-by-hash endpoint until the tx is found in a block or the
/// timeout elapses.
///
/// A "not found yet" (HTTP 404 / a body mentioning "not found") is treated as
/// pending and retried; a confirmed tx with a non-zero delivery code is returned
/// as a [`Error::Tx`] carrying the decoded [`crate::tx::QoreTxError`].
pub async fn wait_for_tx(rest_url: &str, hash: &str, opts: WaitOptions) -> Result<TxResult> {
    let timeout = opts.timeout.unwrap_or(DEFAULT_WAIT_TIMEOUT);
    let poll = opts.poll.unwrap_or(DEFAULT_WAIT_POLL);
    let url = format!(
        "{}/cosmos/tx/v1beta1/txs/{hash}",
        rest_url.trim_end_matches('/')
    );
    let deadline = std::time::Instant::now() + timeout;
    let http = reqwest::Client::new();
    loop {
        if let Some(result) = fetch_tx_result(&http, &url).await? {
            if result.code != 0 {
                let mut err = decode_tx_error(result.code, &result.codespace, &result.raw_log)
                    .expect("non-zero code yields an error");
                err.tx_hash = result.tx_hash.clone();
                return Err(Error::Tx(err));
            }
            return Ok(result);
        }
        if std::time::Instant::now() >= deadline {
            return Err(Error::Transport(format!(
                "timed out after {timeout:?} waiting for tx {hash}"
            )));
        }
        tokio::time::sleep(poll).await;
    }
}

/// Broadcasts `tx_bytes` (sync mode), then [`wait_for_tx`] on the returned hash.
pub async fn broadcast_and_wait(
    rest_url: &str,
    tx_bytes: &[u8],
    opts: WaitOptions,
) -> Result<TxResult> {
    let resp = broadcast(rest_url, tx_bytes, BroadcastMode::Sync).await?;
    let hash = resp["tx_response"]["txhash"]
        .as_str()
        .ok_or_else(|| Error::InvalidResponse("broadcast response missing txhash".into()))?;
    // A non-zero broadcast (CheckTx) code fails fast without polling.
    if let Some(code) = resp["tx_response"]["code"].as_u64() {
        if code != 0 {
            let codespace = resp["tx_response"]["codespace"].as_str().unwrap_or("");
            let raw_log = resp["tx_response"]["raw_log"].as_str().unwrap_or("");
            let mut err = decode_tx_error(code as u32, codespace, raw_log)
                .expect("non-zero code yields an error");
            err.tx_hash = hash.to_string();
            return Err(Error::Tx(err));
        }
    }
    wait_for_tx(rest_url, hash, opts).await
}

/// Runs `f` up to `attempts` times, sleeping `delay` between tries, returning the
/// first success or the last error. `attempts == 0` is treated as 1.
pub async fn with_retry<T, F, Fut>(attempts: u32, delay: Duration, mut f: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let attempts = attempts.max(1);
    let mut last_err: Option<Error> = None;
    for i in 0..attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = Some(e);
                if i + 1 < attempts {
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
    Err(last_err.expect("at least one attempt ran"))
}

/// Fetches a single tx by hash; `Ok(None)` for a pending (not-yet-included) tx.
pub(crate) async fn fetch_tx_result(http: &reqwest::Client, url: &str) -> Result<Option<TxResult>> {
    let resp = http
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        if body.to_lowercase().contains("not found") {
            return Ok(None);
        }
        return Err(Error::Http {
            status: status.as_u16(),
            url: url.to_string(),
            body,
        });
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| Error::InvalidResponse(e.to_string()))?;
    let result = parse_tx_response(&v);
    if result.tx_hash.is_empty() {
        return Ok(None);
    }
    Ok(Some(result))
}

/// Parses a `/cosmos/tx/v1beta1/txs/{hash}` JSON value into a [`TxResult`].
pub(crate) fn parse_tx_response(v: &Value) -> TxResult {
    let tr = &v["tx_response"];
    TxResult {
        tx_hash: tr["txhash"].as_str().unwrap_or("").to_string(),
        height: str_to_i64(&tr["height"]),
        code: tr["code"].as_u64().unwrap_or(0) as u32,
        codespace: tr["codespace"].as_str().unwrap_or("").to_string(),
        gas_wanted: str_to_i64(&tr["gas_wanted"]),
        gas_used: str_to_i64(&tr["gas_used"]),
        raw_log: tr["raw_log"].as_str().unwrap_or("").to_string(),
        raw: v.clone(),
    }
}

fn str_to_i64(v: &Value) -> i64 {
    match v {
        Value::String(s) => s.parse().unwrap_or(0),
        Value::Number(n) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}
