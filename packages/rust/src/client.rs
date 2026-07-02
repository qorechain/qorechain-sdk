//! The top-level [`create_client`] factory and [`ClientBuilder`] for the
//! QoreChain Rust SDK.
//!
//! [`create_client`] resolves a [`NetworkConfig`](crate::networks::NetworkConfig)
//! (applying any endpoint overrides) and composes the read clients
//! ([`RestClient`] and the `qor_*` [`QorClient`]) plus a fee-estimate
//! convenience.
//!
//! Network resolution rules:
//! - The default network is `"testnet"`. Both `"testnet"` and `"mainnet"` are
//!   live and ship localhost endpoint defaults; callers can override them with
//!   real hostnames.

use crate::error::{Error, Result};
use crate::networks::{get_network, Endpoints, NetworkConfig};
use crate::query::{QorClient, RestClient};
use serde_json::{json, Value};

/// Optional per-endpoint URL overrides. `None` fields keep their preset defaults.
#[derive(Debug, Clone, Default)]
pub struct EndpointOverrides {
    /// Cosmos REST (LCD) endpoint.
    pub rest: Option<String>,
    /// Cosmos gRPC endpoint.
    pub grpc: Option<String>,
    /// Consensus RPC endpoint.
    pub rpc: Option<String>,
    /// EVM JSON-RPC endpoint.
    pub evm_rpc: Option<String>,
    /// EVM WebSocket endpoint.
    pub evm_ws: Option<String>,
    /// SVM JSON-RPC endpoint.
    pub svm_rpc: Option<String>,
}

/// Builder for a composed [`Client`].
#[derive(Debug, Clone)]
pub struct ClientBuilder {
    network: String,
    overrides: EndpointOverrides,
    chain_id: Option<String>,
    http: Option<reqwest::Client>,
}

impl Default for ClientBuilder {
    fn default() -> Self {
        Self {
            network: "testnet".into(),
            overrides: EndpointOverrides::default(),
            chain_id: None,
            http: None,
        }
    }
}

impl ClientBuilder {
    /// Starts a new builder defaulting to the `testnet` network.
    pub fn new() -> Self {
        Self::default()
    }

    /// Selects the network preset (default `"testnet"`).
    pub fn network(mut self, network: impl Into<String>) -> Self {
        self.network = network.into();
        self
    }

    /// Overrides the REST (LCD) endpoint.
    pub fn rest(mut self, url: impl Into<String>) -> Self {
        self.overrides.rest = Some(url.into());
        self
    }

    /// Overrides the gRPC endpoint.
    pub fn grpc(mut self, url: impl Into<String>) -> Self {
        self.overrides.grpc = Some(url.into());
        self
    }

    /// Overrides the consensus RPC endpoint.
    pub fn rpc(mut self, url: impl Into<String>) -> Self {
        self.overrides.rpc = Some(url.into());
        self
    }

    /// Overrides the EVM JSON-RPC endpoint.
    pub fn evm_rpc(mut self, url: impl Into<String>) -> Self {
        self.overrides.evm_rpc = Some(url.into());
        self
    }

    /// Overrides the EVM WebSocket endpoint.
    pub fn evm_ws(mut self, url: impl Into<String>) -> Self {
        self.overrides.evm_ws = Some(url.into());
        self
    }

    /// Overrides the SVM JSON-RPC endpoint.
    pub fn svm_rpc(mut self, url: impl Into<String>) -> Self {
        self.overrides.svm_rpc = Some(url.into());
        self
    }

    /// Overrides the resolved chain ID (meaningful only for mainnet).
    pub fn chain_id(mut self, chain_id: impl Into<String>) -> Self {
        self.chain_id = Some(chain_id.into());
        self
    }

    /// Supplies the `reqwest::Client` used for all requests. Optional.
    pub fn http_client(mut self, http: reqwest::Client) -> Self {
        self.http = Some(http);
        self
    }

    /// Builds the composed [`Client`].
    ///
    /// Returns an error if the network is unknown or a required endpoint
    /// (`rest`, `evm_rpc`) is missing.
    pub fn build(self) -> Result<Client> {
        let resolved = resolve_network(&self.network, &self.overrides, self.chain_id.as_deref())?;
        let eps = resolved
            .endpoints
            .as_ref()
            .ok_or_else(|| Error::MissingEndpoint("rest".to_string()))?;

        let rest_url = require_endpoint("rest", &eps.rest)?;
        let evm_url = require_endpoint("evm_rpc", &eps.evm_rpc)?;

        let http = self.http.unwrap_or_default();
        let rest = RestClient::with_client(rest_url, http.clone());
        let qor = QorClient::from_jsonrpc(crate::query::JsonRpcClient::with_client(evm_url, http));
        let fees = Fees { rest: rest.clone() };

        Ok(Client {
            network: resolved,
            rest,
            qor,
            fees,
        })
    }
}

/// A composed QoreChain client: resolved config, read clients, fee helper.
#[derive(Debug, Clone)]
pub struct Client {
    /// The resolved network configuration.
    pub network: NetworkConfig,
    /// REST (LCD) read client.
    pub rest: RestClient,
    /// `qor_*` JSON-RPC read client.
    pub qor: QorClient,
    /// Fee-estimate convenience.
    pub fees: Fees,
}

/// The fee-estimate convenience surface bound to a [`RestClient`].
#[derive(Debug, Clone)]
pub struct Fees {
    rest: RestClient,
}

// Static-fallback parameters used when the AI fee oracle is unavailable.
// Above the 0.1uqor/gas genesis min-gas-price (BaseFee) enforced on both networks.
const STATIC_FALLBACK_GAS_PRICE: &str = "0.15";
const STATIC_FALLBACK_DENOM: &str = "uqor";
const STATIC_FALLBACK_GAS: &str = "200000";

impl Fees {
    /// Estimates a fee for the given urgency via the AI fee oracle, falling back
    /// to a deterministic static fee when the oracle is unavailable. The returned
    /// value is a Cosmos `StdFee`-shaped JSON document
    /// (`{"amount":[...],"gas":...}`).
    pub async fn estimate(&self, urgency: &str) -> Result<Value> {
        let urgency = if urgency.is_empty() {
            "normal"
        } else {
            urgency
        };
        if let Ok(raw) = self.rest.get_fee_estimate(urgency).await {
            if let Some(amount) = raw
                .get("suggested_fee_uqor")
                .map(value_to_amount_string)
                .filter(|a| !a.is_empty() && a != "0")
            {
                return static_fee(STATIC_FALLBACK_GAS, "", STATIC_FALLBACK_DENOM, &amount);
            }
        }
        static_fee(
            STATIC_FALLBACK_GAS,
            STATIC_FALLBACK_GAS_PRICE,
            STATIC_FALLBACK_DENOM,
            "",
        )
    }
}

fn value_to_amount_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Builds a `StdFee` JSON doc. When `amount` is non-empty it is used directly;
/// otherwise the fee is computed as `ceil(gas * gas_price)`.
fn static_fee(gas: &str, gas_price: &str, denom: &str, amount: &str) -> Result<Value> {
    let amount = if amount.is_empty() {
        compute_ceil_fee(gas, gas_price)?
    } else {
        amount.to_string()
    };
    Ok(json!({
        "amount": [{ "denom": denom, "amount": amount }],
        "gas": gas,
    }))
}

/// Returns `ceil(gas * gas_price)` using integer (`u128`) math to avoid
/// floating-point drift. `gas_price` is a non-negative decimal string.
fn compute_ceil_fee(gas: &str, gas_price: &str) -> Result<String> {
    let gas_units: u128 = gas
        .parse()
        .map_err(|_| Error::Denom(format!("invalid gas: {gas}")))?;
    let (int_part, frac_part) = match gas_price.split_once('.') {
        Some((i, f)) => (i, f),
        None => (gas_price, ""),
    };
    let ip: u128 = or_zero(int_part)
        .parse()
        .map_err(|_| Error::Denom(format!("invalid gas price: {gas_price}")))?;
    let fp: u128 = or_zero(frac_part)
        .parse()
        .map_err(|_| Error::Denom(format!("invalid gas price: {gas_price}")))?;
    let scale = 10u128.pow(frac_part.len() as u32);
    let numerator = ip * scale + fp;
    let raw = gas_units * numerator;
    // ceil division.
    Ok(raw.div_ceil(scale).to_string())
}

fn or_zero(s: &str) -> &str {
    if s.is_empty() {
        "0"
    } else {
        s
    }
}

fn resolve_network(
    network: &str,
    overrides: &EndpointOverrides,
    chain_id: Option<&str>,
) -> Result<NetworkConfig> {
    // Live preset (testnet or mainnet): start from it, then overlay endpoint
    // overrides onto the defaults.
    let mut resolved = get_network(network)?;
    if let Some(eps) = resolved.endpoints.as_mut() {
        overlay(eps, overrides);
    }
    if let Some(cid) = chain_id {
        resolved.chain_id = Some(cid.to_string());
    }
    Ok(resolved)
}

fn overlay(eps: &mut Endpoints, o: &EndpointOverrides) {
    if let Some(v) = &o.rest {
        eps.rest = v.clone();
    }
    if let Some(v) = &o.grpc {
        eps.grpc = v.clone();
    }
    if let Some(v) = &o.rpc {
        eps.rpc = v.clone();
    }
    if let Some(v) = &o.evm_rpc {
        eps.evm_rpc = v.clone();
    }
    if let Some(v) = &o.evm_ws {
        eps.evm_ws = v.clone();
    }
    if let Some(v) = &o.svm_rpc {
        eps.svm_rpc = v.clone();
    }
}

fn require_endpoint(key: &str, value: &str) -> Result<String> {
    if value.is_empty() {
        return Err(Error::MissingEndpoint(key.to_string()));
    }
    Ok(value.to_string())
}

/// Creates a composed [`Client`] for the given network using default localhost
/// endpoints (testnet) or the supplied overrides.
///
/// This is a convenience wrapper over [`ClientBuilder`]. It returns an error if
/// mainnet is selected without endpoints, or if a required endpoint is missing.
pub fn create_client(network: &str) -> Result<Client> {
    ClientBuilder::new().network(network).build()
}
