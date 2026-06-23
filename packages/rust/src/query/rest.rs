//! Cosmos + QoreChain REST (LCD) read client.

use crate::error::{Error, Result};
use crate::query::DEFAULT_USER_AGENT;
use serde_json::Value;

/// A Cosmos + QoreChain REST read client.
#[derive(Debug, Clone)]
pub struct RestClient {
    base_url: String,
    http: reqwest::Client,
}

impl RestClient {
    /// Creates a `RestClient` for the given base URL using a fresh HTTP client.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_client(base_url, reqwest::Client::new())
    }

    /// Creates a `RestClient` for the given base URL using the supplied HTTP
    /// client (e.g. one shared across the SDK).
    pub fn with_client(base_url: impl Into<String>, http: reqwest::Client) -> Self {
        let base = base_url.into();
        Self {
            base_url: base.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// The configured base URL (without a trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn join(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    /// Generic GET escape hatch for any documented REST route. The response body
    /// is parsed into a [`serde_json::Value`].
    pub async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value> {
        let url = self.join(path);
        let mut req = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .header("User-Agent", DEFAULT_USER_AGENT);
        let filtered: Vec<(&str, &str)> = query
            .iter()
            .copied()
            .filter(|(_, v)| !v.is_empty())
            .collect();
        if !filtered.is_empty() {
            req = req.query(&filtered);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(Error::Http {
                status: status.as_u16(),
                url,
                body,
            });
        }
        serde_json::from_str(&body).map_err(|e| Error::InvalidResponse(e.to_string()))
    }

    /// Returns all balances for a Cosmos account.
    pub async fn get_all_balances(&self, address: &str) -> Result<Value> {
        self.get(&format!("/cosmos/bank/v1beta1/balances/{address}"), &[])
            .await
    }

    /// Returns the AI engine statistics.
    pub async fn get_ai_stats(&self) -> Result<Value> {
        self.get("/qorechain/ai/v1/stats", &[]).await
    }

    /// Returns an AI-assisted fee estimate for the given urgency
    /// (`"fast"`, `"normal"`, `"slow"`).
    pub async fn get_fee_estimate(&self, urgency: &str) -> Result<Value> {
        self.get("/qorechain/ai/v1/fee-estimate", &[("urgency", urgency)])
            .await
    }

    /// Returns the supported bridge chains.
    pub async fn get_bridge_chains(&self) -> Result<Value> {
        self.get("/qorechain/bridge/v1/chains", &[]).await
    }

    /// Returns the PQC account record for an address.
    pub async fn get_pqc_account(&self, address: &str) -> Result<Value> {
        self.get(&format!("/qorechain/pqc/v1/accounts/{address}"), &[])
            .await
    }

    /// Returns the reputation record for a validator address.
    pub async fn get_reputation(&self, validator_address: &str) -> Result<Value> {
        self.get(
            &format!("/qorechain/reputation/v1/validators/{validator_address}"),
            &[],
        )
        .await
    }

    /// Returns the token burn statistics.
    pub async fn get_burn_stats(&self) -> Result<Value> {
        self.get("/qorechain/burn/v1/stats", &[]).await
    }

    /// Returns the xQORE position for an address.
    pub async fn get_xqore_position(&self, address: &str) -> Result<Value> {
        self.get(&format!("/qorechain/xqore/v1/position/{address}"), &[])
            .await
    }

    /// Returns the current inflation rate.
    pub async fn get_inflation_rate(&self) -> Result<Value> {
        self.get("/qorechain/inflation/v1/rate", &[]).await
    }
}
