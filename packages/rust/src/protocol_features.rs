//! The chain's protocol feature switches (chain v3.2.4,
//! `/qorechain/pqc/v1/protocol_features`).
//!
//! Each consensus change ships behind a named switch that a governance upgrade
//! turns on at its height. Reading the switch tells a client whether the
//! network enforces a rule today, without inferring it from upgrade plan
//! names. Networks below v3.2.4 do not serve the route: use
//! [`crate::upgrades::is_upgrade_applied`] there.

use crate::error::{Error, Result};
use crate::query::RestClient;
use serde_json::Value;

/// The REST path of the protocol features query.
pub const PROTOCOL_FEATURES_PATH: &str = "/qorechain/pqc/v1/protocol_features";

/// One switch.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProtocolFeature {
    /// The switch name.
    pub name: String,
    /// On at the current height.
    pub enabled: bool,
    /// False for a switch a newer release enabled and this node does not know.
    pub known: bool,
    /// Carried by the node's binary but not enabled by any release yet.
    pub staged: bool,
}

/// Every switch the node knows, at `height`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProtocolFeatures {
    /// The switches.
    pub features: Vec<ProtocolFeature>,
    /// The height the answer was read at.
    pub height: u64,
}

impl ProtocolFeatures {
    /// Whether the switch `name` is on. A switch the node does not list is off.
    pub fn is_enabled(&self, name: &str) -> bool {
        self.features.iter().any(|f| f.name == name && f.enabled)
    }
}

/// Parses a `protocol_features` payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when `height` is not an integer.
pub fn parse_protocol_features(b: &Value) -> Result<ProtocolFeatures> {
    let features = b["features"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| ProtocolFeature {
                    name: x["name"].as_str().unwrap_or_default().to_string(),
                    enabled: x["enabled"].as_bool().unwrap_or(false),
                    known: x["known"].as_bool().unwrap_or(false),
                    staged: x["staged"].as_bool().unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    let height = match &b["height"] {
        Value::Null => 0,
        Value::String(s) if s.trim().is_empty() => 0,
        Value::String(s) => s.trim().parse::<u64>().map_err(|_| {
            Error::InvalidResponse(format!("protocol_features height is not an integer: {s:?}"))
        })?,
        Value::Number(n) => n.as_u64().ok_or_else(|| {
            Error::InvalidResponse(format!("protocol_features height is not an integer: {n}"))
        })?,
        other => {
            return Err(Error::InvalidResponse(format!(
                "protocol_features height is not an integer: {other}"
            )))
        }
    };
    Ok(ProtocolFeatures { features, height })
}

/// Reads the network's protocol feature switches.
///
/// # Errors
///
/// Transport / HTTP errors from the REST client (a node below v3.2.4 answers
/// an HTTP error), or [`Error::InvalidResponse`] on an unparsable body.
pub async fn fetch_protocol_features(rest: &RestClient) -> Result<ProtocolFeatures> {
    parse_protocol_features(&rest.get(PROTOCOL_FEATURES_PATH, &[]).await?)
}

/// Whether the switch `name` is on. A switch the node does not list is off.
///
/// # Errors
///
/// As [`fetch_protocol_features`].
pub async fn is_protocol_feature_enabled(rest: &RestClient, name: &str) -> Result<bool> {
    Ok(fetch_protocol_features(rest).await?.is_enabled(name))
}
