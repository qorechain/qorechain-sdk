//! Post-quantum consent for EIP-7702 delegations (chain v3.2.2, `x/pqc`).
//!
//! An EIP-7702 authorization tuple installs code on the account that signed it,
//! with the classical key alone. From v3.2.2 the EVM lane admits a type-4
//! transaction only if every account whose tuple would take effect holds a
//! registered post-quantum key AND has consented, with
//! `MsgAuthorizeEVMDelegation` signed by that key, to exactly the delegate the
//! tuple names. Clearing a delegation (the zero address) needs consent too.
//!
//! # How a delegation goes through
//!
//! 1. Broadcast [`crate::msg::pqc::authorize_evm_delegation`] (Cosmos lane,
//!    hybrid signature). It ADVANCES the account's nonce: the Cosmos sequence
//!    and the EVM nonce are one counter.
//! 2. Read [`get_evm_delegation_consent`]. Its `nonce` is the EVM nonce NOW.
//! 3. Sign the tuple with that nonce if someone else sponsors the type-4
//!    transaction, or `nonce + 1` if the account sends it itself
//!    ([`EvmDelegationConsent::tuple_nonce`]).
//! 4. Send the type-4 transaction. The sender still needs an open EVM window.
//!
//! The consent is single use, expires after `blocks`, is replaced by a new one
//! and revoked by `MsgCloseEVMWindow`.
//! [`crate::msg::pqc::clear_evm_delegation`] removes an installed delegation
//! without any EVM transaction.

use serde_json::Value;

use crate::evm_window::MAX_EVM_WINDOW_BLOCKS;
use crate::query::RestClient;
use crate::{Error, Result};

/// The longest a consent may wait to be used, in blocks (the window's bound).
pub const MAX_EVM_DELEGATION_CONSENT_BLOCKS: u64 = MAX_EVM_WINDOW_BLOCKS;
/// The most authorization tuples the EVM lane accepts in one type-4 transaction.
pub const MAX_EVM_AUTHORIZATIONS_PER_TX: usize = 8;
/// The delegate to consent to when the intent is to CLEAR the delegation.
pub const EVM_DELEGATION_CLEAR: &str = "0x0000000000000000000000000000000000000000";
/// `pqc` 60 — no live consent for the delegation a tuple would install.
pub const ERR_NO_EVM_DELEGATION_CONSENT: u32 = 60;
/// `pqc` 61 — a malformed consent or clear request, or no PQC key.
pub const ERR_INVALID_EVM_DELEGATION: u32 = 61;

/// Checks a consent request against the chain's rules and returns the delegate
/// lower-cased (the chain compares case-insensitively; lower-casing keeps the
/// message identical across clients).
///
/// # Errors
///
/// [`Error::Pqc`] naming the rule that was violated.
pub fn validate_evm_delegation_consent(delegate: &str, blocks: u64) -> Result<String> {
    let hex_part = delegate.strip_prefix("0x");
    let ok =
        matches!(hex_part, Some(h) if h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()));
    if !ok {
        return Err(Error::Pqc(format!(
            "delegate must be a 0x-prefixed 20-byte address (EVM_DELEGATION_CLEAR to consent to clearing), got {delegate:?}"
        )));
    }
    if blocks == 0 || blocks > MAX_EVM_DELEGATION_CONSENT_BLOCKS {
        return Err(Error::Pqc(format!(
            "blocks must be in 1..={MAX_EVM_DELEGATION_CONSENT_BLOCKS}, got {blocks}"
        )));
    }
    Ok(delegate.to_ascii_lowercase())
}

/// The REST path of the consent query for `address` (`qor1…` or 0x).
pub fn evm_delegation_consent_path(address: &str) -> String {
    format!("/qorechain/pqc/v1/evm_delegation_consent/{address}")
}

/// An account's delegation consent, and what a client needs to sign the tuple.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EvmDelegationConsent {
    /// Whether a consent is stored. A stored consent may be expired.
    pub found: bool,
    /// Whether it can still be used at the current height.
    pub live: bool,
    /// The 0x address the consent names, lower case; zero address = clearing.
    pub delegate: String,
    /// The height the consent was recorded at.
    pub granted_height: u64,
    /// The last height at which it can be used.
    pub expiry_height: u64,
    /// The delegation installed on the account now; empty when there is none.
    pub current_delegate: String,
    /// The account's EVM nonce now.
    pub nonce: u64,
}

impl EvmDelegationConsent {
    /// The nonce an authorization tuple must carry, from a consent read AFTER
    /// the consent message was included: `nonce` for a SPONSORED type-4
    /// transaction, `nonce + 1` for the account's own.
    pub fn tuple_nonce(&self, sponsored: bool) -> u64 {
        if sponsored {
            self.nonce
        } else {
            self.nonce + 1
        }
    }
}

fn as_u64(payload: &Value, field: &str) -> Result<u64> {
    match &payload[field] {
        Value::Null => Ok(0),
        Value::String(s) if s.trim().is_empty() => Ok(0),
        Value::String(s) => s.trim().parse::<u64>().map_err(|_| {
            Error::InvalidResponse(format!(
                "evm_delegation_consent field {field:?} is not an integer: {s:?}"
            ))
        }),
        Value::Number(n) => n.as_u64().ok_or_else(|| {
            Error::InvalidResponse(format!(
                "evm_delegation_consent field {field:?} is not an integer: {n}"
            ))
        }),
        other => Err(Error::InvalidResponse(format!(
            "evm_delegation_consent field {field:?} is not an integer: {other}"
        ))),
    }
}

/// Parses the `evm_delegation_consent` REST payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when a numeric field is not an exact integer.
pub fn parse_evm_delegation_consent(payload: &Value) -> Result<EvmDelegationConsent> {
    Ok(EvmDelegationConsent {
        found: payload["found"].as_bool().unwrap_or(false),
        live: payload["live"].as_bool().unwrap_or(false),
        delegate: payload["delegate"].as_str().unwrap_or_default().to_string(),
        granted_height: as_u64(payload, "granted_height")?,
        expiry_height: as_u64(payload, "expiry_height")?,
        current_delegate: payload["current_delegate"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        nonce: as_u64(payload, "nonce")?,
    })
}

/// Reads an account's delegation consent over REST. The route exists from
/// chain v3.2.2; an older node answers an HTTP error, which is returned rather
/// than read as "no consent".
///
/// # Errors
///
/// The transport error, or [`Error::InvalidResponse`] on an unparsable body.
pub async fn get_evm_delegation_consent(
    rest: &RestClient,
    address: &str,
) -> Result<EvmDelegationConsent> {
    parse_evm_delegation_consent(&rest.get(&evm_delegation_consent_path(address), &[]).await?)
}

/// Why the chain refused a delegation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvmDelegationRefusal {
    /// No live consent for that delegate: consent first (again, if it expired
    /// or was used).
    NoConsent,
    /// A malformed consent or clear request, or an account without a PQC key.
    InvalidDelegation,
}

/// Classifies a delegation refusal from its text first (over EVM JSON-RPC only
/// the text arrives), then its code; `None` when it is something else.
pub fn classify_evm_delegation_error(
    code: u32,
    codespace: &str,
    message: &str,
) -> Option<EvmDelegationRefusal> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("no post-quantum consent for this eip-7702 delegation") {
        return Some(EvmDelegationRefusal::NoConsent);
    }
    if lower.contains("invalid eip-7702 delegation request") {
        return Some(EvmDelegationRefusal::InvalidDelegation);
    }
    if codespace == "pqc" {
        match code {
            ERR_NO_EVM_DELEGATION_CONSENT => return Some(EvmDelegationRefusal::NoConsent),
            ERR_INVALID_EVM_DELEGATION => return Some(EvmDelegationRefusal::InvalidDelegation),
            _ => {}
        }
    }
    None
}
