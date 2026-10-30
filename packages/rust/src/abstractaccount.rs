//! Abstract-account reads added in chain v3.2.5: the spending rules stored for
//! an account and the keys linked to it. The composers are in
//! [`crate::msg::abstractaccount`].
//!
//! Before v3.2.5 the account view only counted the rules, so an owner could not
//! read back what `MsgUpdateSpendingRules` saved. A network below v3.2.5 has no
//! such routes (an HTTP 404 / 501 error).

use serde_json::Value;

use crate::error::{Error, Result};
use crate::proto::qorechain::abstractaccount::v1::{DenomLimit, SpendingRule};
use crate::query::RestClient;

/// The REST path of an account's stored spending rules.
pub fn spending_rules_path(address: &str) -> String {
    format!("/qorechain/abstractaccount/v1/accounts/{address}/spending_rules")
}

/// The REST path of an account's linked keys.
pub fn authenticators_path(address: &str) -> String {
    format!("/qorechain/abstractaccount/v1/accounts/{address}/authenticators")
}

/// The rule a linked key carries itself.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthenticatorRule {
    /// The key's scheme (e.g. `secp256k1`, `ed25519`).
    pub scheme: String,
    /// The key, hex encoded.
    pub pubkey_hex: String,
    /// The key's own rule.
    pub rule: SpendingRule,
}

/// The stored spending rules of an account.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SpendingRules {
    /// The account-wide rules in stored order; the first enabled one bounds
    /// every linked key without a rule of its own.
    pub rules: Vec<SpendingRule>,
    /// The per-key rules.
    pub authenticator_rules: Vec<AuthenticatorRule>,
}

/// A linked key, revoked ones included.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuthenticatorView {
    /// The key's scheme.
    pub scheme: String,
    /// The key, hex encoded.
    pub pubkey_hex: String,
    /// What the key may do.
    pub permissions: Vec<String>,
    /// Expiry, unix seconds.
    pub expiry_unix: i64,
    /// The owner's label.
    pub label: String,
    /// When it was linked, unix seconds.
    pub created_at_unix: i64,
    /// Whether it was revoked.
    pub revoked: bool,
    /// Whether the key carries a rule of its own (see [`fetch_spending_rules`]).
    pub has_spend_rule: bool,
}

fn int(v: &Value, what: &str) -> Result<i64> {
    match v {
        Value::Null => Ok(0),
        Value::String(s) if s.is_empty() => Ok(0),
        Value::String(s) => s
            .trim()
            .parse()
            .map_err(|_| Error::InvalidResponse(format!("{what} is not an integer: {s:?}"))),
        Value::Number(n) => n
            .as_i64()
            .ok_or_else(|| Error::InvalidResponse(format!("{what} is not an integer: {n}"))),
        other => Err(Error::InvalidResponse(format!(
            "{what} is not an integer: {other}"
        ))),
    }
}

fn str_of(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_rule(v: &Value) -> Result<SpendingRule> {
    let denom_limits = v["denom_limits"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|d| DenomLimit {
                    denom: str_of(&d["denom"]),
                    per_tx_limit: str_of(&d["per_tx_limit"]),
                    daily_limit: str_of(&d["daily_limit"]),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SpendingRule {
        id: str_of(&v["id"]),
        daily_limit: int(&v["daily_limit"], "daily_limit")?,
        per_tx_limit: int(&v["per_tx_limit"], "per_tx_limit")?,
        allowed_denoms: strings(&v["allowed_denoms"]),
        enabled: v["enabled"].as_bool().unwrap_or(false),
        allowed_evm_calls: strings(&v["allowed_evm_calls"]),
        denom_limits,
    })
}

/// Parses a `.../spending_rules` body.
///
/// # Errors
///
/// [`Error::InvalidResponse`] on a malformed body.
pub fn parse_spending_rules(b: &Value) -> Result<SpendingRules> {
    let rules = b["rules"]
        .as_array()
        .map(|a| a.iter().map(parse_rule).collect::<Result<Vec<_>>>())
        .transpose()?
        .unwrap_or_default();
    let authenticator_rules = b["authenticator_rules"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|r| {
                    Ok(AuthenticatorRule {
                        scheme: str_of(&r["scheme"]),
                        pubkey_hex: str_of(&r["pubkey_hex"]),
                        rule: parse_rule(&r["rule"])?,
                    })
                })
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?
        .unwrap_or_default();
    Ok(SpendingRules {
        rules,
        authenticator_rules,
    })
}

/// Parses a `.../authenticators` body.
///
/// # Errors
///
/// [`Error::InvalidResponse`] on a malformed body.
pub fn parse_authenticators(b: &Value) -> Result<Vec<AuthenticatorView>> {
    b["authenticators"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|v| {
                    Ok(AuthenticatorView {
                        scheme: str_of(&v["scheme"]),
                        pubkey_hex: str_of(&v["pubkey_hex"]),
                        permissions: strings(&v["permissions"]),
                        expiry_unix: int(&v["expiry_unix"], "expiry_unix")?,
                        label: str_of(&v["label"]),
                        created_at_unix: int(&v["created_at_unix"], "created_at_unix")?,
                        revoked: v["revoked"].as_bool().unwrap_or(false),
                        has_spend_rule: v["has_spend_rule"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

/// Reads the spending rules stored for `address` (chain v3.2.5).
///
/// # Errors
///
/// Transport / HTTP errors (the chain answers code 5 for an address that is
/// not an abstract account), or [`Error::InvalidResponse`].
pub async fn fetch_spending_rules(rest: &RestClient, address: &str) -> Result<SpendingRules> {
    parse_spending_rules(&rest.get(&spending_rules_path(address), &[]).await?)
}

/// Reads the keys linked to `address`, revoked ones included (chain v3.2.5).
///
/// # Errors
///
/// As [`fetch_spending_rules`].
pub async fn fetch_authenticators(
    rest: &RestClient,
    address: &str,
) -> Result<Vec<AuthenticatorView>> {
    parse_authenticators(&rest.get(&authenticators_path(address), &[]).await?)
}
