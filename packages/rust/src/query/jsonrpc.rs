//! Minimal JSON-RPC 2.0 client over HTTP POST.

use crate::error::{Error, Result};
use crate::query::DEFAULT_USER_AGENT;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

/// A JSON-RPC 2.0 client over HTTP POST. Request ids auto-increment per client.
#[derive(Debug, Clone)]
pub struct JsonRpcClient {
    url: String,
    http: reqwest::Client,
    next_id: Arc<AtomicI64>,
}

impl JsonRpcClient {
    /// Creates a JSON-RPC client targeting the given URL using a fresh HTTP
    /// client.
    pub fn new(url: impl Into<String>) -> Self {
        Self::with_client(url, reqwest::Client::new())
    }

    /// Creates a JSON-RPC client targeting the given URL using the supplied HTTP
    /// client.
    pub fn with_client(url: impl Into<String>, http: reqwest::Client) -> Self {
        Self {
            url: url.into(),
            http,
            next_id: Arc::new(AtomicI64::new(1)),
        }
    }

    /// The configured endpoint URL.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Invokes a JSON-RPC method and returns its `result`.
    ///
    /// Returns [`Error::JsonRpc`] when the response carries an error member, or
    /// [`Error::Http`] on a non-2xx transport response.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let params = match params {
            Value::Null => json!([]),
            other => other,
        };
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let resp = self
            .http
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("User-Agent", DEFAULT_USER_AGENT)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(Error::Http {
                status: status.as_u16(),
                url: self.url.clone(),
                body: text,
            });
        }

        let parsed: Value =
            serde_json::from_str(&text).map_err(|e| Error::InvalidResponse(e.to_string()))?;
        if let Some(err) = parsed.get("error").filter(|e| !e.is_null()) {
            let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
            let message = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown JSON-RPC error")
                .to_string();
            return Err(Error::JsonRpc { code, message });
        }
        Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
    }
}
