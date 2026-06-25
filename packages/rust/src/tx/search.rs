//! Transaction and block search over REST, mirroring the TS / Go SDKs.

use crate::error::{Error, Result};
use crate::tx::track::{fetch_tx_result, parse_tx_response, TxResult};
use serde_json::Value;

/// Fetches a single transaction by hash and parses it into a [`TxResult`].
/// Returns an error if the tx is not found.
pub async fn get_tx(rest_url: &str, hash: &str) -> Result<TxResult> {
    let url = format!(
        "{}/cosmos/tx/v1beta1/txs/{hash}",
        rest_url.trim_end_matches('/')
    );
    let http = reqwest::Client::new();
    match fetch_tx_result(&http, &url).await? {
        Some(result) => Ok(result),
        None => Err(Error::InvalidResponse(format!("tx {hash} not found"))),
    }
}

/// Fetches a block by height, returning the raw JSON body.
pub async fn get_block(rest_url: &str, height: i64) -> Result<Value> {
    let url = format!(
        "{}/cosmos/base/tendermint/v1beta1/blocks/{height}",
        rest_url.trim_end_matches('/')
    );
    get_json(&url).await
}

/// Fetches the latest block, returning the raw JSON body.
pub async fn get_latest_block(rest_url: &str) -> Result<Value> {
    let url = format!(
        "{}/cosmos/base/tendermint/v1beta1/blocks/latest",
        rest_url.trim_end_matches('/')
    );
    get_json(&url).await
}

/// A page of transactions matching a [`search_txs`] query.
#[derive(Debug, Clone)]
pub struct TxSearchResult {
    /// The matched transactions.
    pub txs: Vec<TxResult>,
    /// The total number of matches across all pages, when reported.
    pub total: u64,
    /// The full `/cosmos/tx/v1beta1/txs` JSON response.
    pub raw: Value,
}

/// Queries the REST tx-search endpoint by event predicates, returning a page of
/// results.
///
/// `events` is a list of `"key=value"` predicates (e.g.
/// `"message.sender=qor1..."`). They are combined as the chain's `query`
/// parameter joined by `" AND "`. `page` is 1-based; `limit` caps the page size.
pub async fn search_txs(
    rest_url: &str,
    events: &[&str],
    page: u64,
    limit: u64,
) -> Result<TxSearchResult> {
    let page = if page == 0 { 1 } else { page };
    let limit = if limit == 0 { 100 } else { limit };
    let query = build_event_query(events);
    if query.is_empty() {
        return Err(Error::InvalidResponse(
            "at least one event predicate is required".into(),
        ));
    }
    let http = reqwest::Client::new();
    let resp = http
        .get(format!(
            "{}/cosmos/tx/v1beta1/txs",
            rest_url.trim_end_matches('/')
        ))
        .header("Accept", "application/json")
        .query(&[
            ("query", query.as_str()),
            ("page", &page.to_string()),
            ("limit", &limit.to_string()),
        ])
        .send()
        .await?;
    let status = resp.status();
    let url = resp.url().to_string();
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
    Ok(parse_tx_search(v))
}

/// Joins event predicates into the chain's tx-search query string.
///
/// Each `"key=value"` predicate gets its value single-quoted (values already
/// quoted are left as-is). Predicates without `"="` are passed through verbatim
/// (allowing pre-built expressions). Empty predicates are skipped.
pub fn build_event_query(events: &[&str]) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(events.len());
    for e in events {
        let e = e.trim();
        if e.is_empty() {
            continue;
        }
        match e.split_once('=') {
            Some((key, value)) => {
                let value = value.trim();
                let quoted = if value.starts_with('\'') || value.starts_with('"') {
                    value.to_string()
                } else {
                    format!("'{value}'")
                };
                parts.push(format!("{}={}", key.trim(), quoted));
            }
            None => parts.push(e.to_string()),
        }
    }
    parts.join(" AND ")
}

fn parse_tx_search(v: Value) -> TxSearchResult {
    let mut txs = Vec::new();
    if let Some(arr) = v["tx_responses"].as_array() {
        for entry in arr {
            // Wrap each TxResponse so parse_tx_response can read the envelope.
            let wrapped = serde_json::json!({ "tx_response": entry });
            txs.push(parse_tx_response(&wrapped));
        }
    }
    let total = match (&v["total"], &v["pagination"]["total"]) {
        (Value::String(s), _) if !s.is_empty() => s.parse().unwrap_or(0),
        (_, Value::String(s)) if !s.is_empty() => s.parse().unwrap_or(0),
        _ => 0,
    };
    TxSearchResult { txs, total, raw: v }
}

async fn get_json(url: &str) -> Result<Value> {
    let http = reqwest::Client::new();
    let resp = http
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::Http {
            status: status.as_u16(),
            url: url.to_string(),
            body,
        });
    }
    serde_json::from_str(&body).map_err(|e| Error::InvalidResponse(e.to_string()))
}
