//! The chain's protocol feature switches (chain v3.2.4,
//! `/qorechain/pqc/v1/protocol_features`).
//!
//! Each consensus change ships behind a named switch that a governance upgrade
//! turns on at its height. Reading the switch tells a client whether the
//! network enforces a rule today, without inferring it from upgrade plan
//! names. Networks below v3.2.4 do not serve the route: use
//! [`crate::upgrades::is_upgrade_applied`] there.
//!
//! The switches are the first source for every "auto" choice that depends on
//! a chain upgrade: forks, fresh devnets and fest chains run the new rules from
//! genesis and answer `applied_plan` with height 0, so reading the plans first
//! picks the old form and the chain refuses the transaction.
//! [`read_protocol_feature`] tells a definitive "the node does not serve this
//! switch" (fall back to the plans) apart from "the node could not be asked"
//! (an error: never fall back, never guess).

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
/// To decide a wire format, use [`read_protocol_feature`] instead: it keeps
/// "not listed" apart from "listed and off".
///
/// # Errors
///
/// As [`fetch_protocol_features`].
pub async fn is_protocol_feature_enabled(rest: &RestClient, name: &str) -> Result<bool> {
    Ok(fetch_protocol_features(rest).await?.is_enabled(name))
}

/// What a node answered about one switch, from [`read_protocol_feature`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProtocolFeatureState {
    /// The node lists the switch and it is on.
    Enabled,
    /// The node lists the switch and it is off.
    Disabled,
    /// The node definitively does not serve the switch: the route answers
    /// HTTP 404 or 501 (the gateway's "Not Implemented", gRPC code 12), or
    /// HTTP 200 with no `features` list, an empty one, or one without the
    /// switch. The caller falls back to the upgrade plans.
    NotServed,
}

/// Classifies a `protocol_features` answer (the result of
/// `RestClient::get(PROTOCOL_FEATURES_PATH)`) for the switch `name`.
///
/// # Errors
///
/// Every answer that is not definitive: a transport error or timeout, an HTTP
/// status other than 2xx, 404 and 501 (for example 429 or 500), a body that is
/// not JSON, or a JSON body that is not a features payload. The caller must not
/// fall back to the upgrade plans on these: the network could not be asked.
pub fn classify_protocol_feature(
    answer: Result<Value>,
    name: &str,
) -> Result<ProtocolFeatureState> {
    let body = match answer {
        Ok(body) => body,
        Err(Error::Http { status, .. }) if status == 404 || status == 501 => {
            return Ok(ProtocolFeatureState::NotServed)
        }
        Err(e) => return Err(e),
    };
    if !body.is_object() {
        return Err(Error::InvalidResponse(format!(
            "protocol_features answer is not an object: {body}"
        )));
    }
    match &body["features"] {
        Value::Null => return Ok(ProtocolFeatureState::NotServed),
        Value::Array(_) => {}
        other => {
            return Err(Error::InvalidResponse(format!(
                "protocol_features `features` is not a list: {other}"
            )))
        }
    }
    let parsed = parse_protocol_features(&body)?;
    Ok(match parsed.features.iter().find(|f| f.name == name) {
        Some(f) if f.enabled => ProtocolFeatureState::Enabled,
        Some(_) => ProtocolFeatureState::Disabled,
        None => ProtocolFeatureState::NotServed,
    })
}

/// Asks the node behind `rest` about the switch `name` and classifies the
/// answer (see [`classify_protocol_feature`]).
///
/// # Errors
///
/// When the node could not be asked (see [`classify_protocol_feature`]).
pub async fn read_protocol_feature(rest: &RestClient, name: &str) -> Result<ProtocolFeatureState> {
    classify_protocol_feature(rest.get(PROTOCOL_FEATURES_PATH, &[]).await, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn http(status: u16) -> Result<Value> {
        Err(Error::Http {
            status,
            url: "http://node".into(),
            body: r#"{"code":12,"message":"Not Implemented"}"#.into(),
        })
    }

    #[test]
    fn classify_answers() {
        let name = "pqc-possession-flag";
        let body = |enabled: bool| {
            Ok(
                json!({"features":[{"name":name,"enabled":enabled,"known":true,"staged":false}],"height":"7"}),
            )
        };
        assert_eq!(
            classify_protocol_feature(body(true), name).unwrap(),
            ProtocolFeatureState::Enabled
        );
        assert_eq!(
            classify_protocol_feature(body(false), name).unwrap(),
            ProtocolFeatureState::Disabled
        );
        for not_served in [
            http(404),
            http(501),
            Ok(json!({"features":[],"height":"7"})),
            Ok(json!({"height":"7"})),
            Ok(json!({"features":[{"name":"other","enabled":true}],"height":"7"})),
        ] {
            assert_eq!(
                classify_protocol_feature(not_served, name).unwrap(),
                ProtocolFeatureState::NotServed
            );
        }
        for failed in [
            http(500),
            http(502),
            http(429),
            http(400),
            Err(Error::InvalidResponse("not json".into())),
            Ok(json!("text")),
            Ok(json!({"features":"yes"})),
            Ok(json!({"features":[{"name":name,"enabled":true}],"height":"x"})),
        ] {
            assert!(classify_protocol_feature(failed, name).is_err());
        }
    }
}
