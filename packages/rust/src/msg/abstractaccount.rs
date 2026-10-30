//! `qorechain.abstractaccount.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::abstractaccount::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

pub use pb::{DenomLimit, SpendingRule};

/// `/qorechain.abstractaccount.v1.MsgCreateAbstractAccount` type URL.
pub const CREATE_ABSTRACT_ACCOUNT: &str = "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount";
/// `/qorechain.abstractaccount.v1.MsgUpdateSpendingRules` type URL.
pub const UPDATE_SPENDING_RULES: &str = "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules";
/// `/qorechain.abstractaccount.v1.MsgRegisterAuthenticator` type URL.
pub const REGISTER_AUTHENTICATOR: &str = "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator";
/// `/qorechain.abstractaccount.v1.MsgRevokeAuthenticator` type URL.
pub const REVOKE_AUTHENTICATOR: &str = "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator";
/// `/qorechain.abstractaccount.v1.MsgExecuteEVM` type URL.
pub const EXECUTE_EVM: &str = "/qorechain.abstractaccount.v1.MsgExecuteEVM";
/// `/qorechain.abstractaccount.v1.MsgExecuteCosmos` type URL.
pub const EXECUTE_COSMOS: &str = "/qorechain.abstractaccount.v1.MsgExecuteCosmos";
/// `/qorechain.abstractaccount.v1.MsgUpdateConfig` type URL (chain v3.2.5,
/// governance only).
pub const UPDATE_CONFIG: &str = "/qorechain.abstractaccount.v1.MsgUpdateConfig";

/// Builds `MsgCreateAbstractAccount`.
pub fn create_abstract_account(
    owner: impl Into<String>,
    account_type: impl Into<String>,
) -> pb::MsgCreateAbstractAccount {
    pb::MsgCreateAbstractAccount {
        owner: owner.into(),
        account_type: account_type.into(),
    }
}

/// Builds `MsgCreateAbstractAccount` packed into an `Any`.
pub fn create_abstract_account_any(
    owner: impl Into<String>,
    account_type: impl Into<String>,
) -> Any {
    to_any(
        &create_abstract_account(owner, account_type),
        CREATE_ABSTRACT_ACCOUNT,
    )
}

/// Builds `MsgUpdateSpendingRules`.
pub fn update_spending_rules(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    rules: Vec<SpendingRule>,
) -> pb::MsgUpdateSpendingRules {
    pb::MsgUpdateSpendingRules {
        owner: owner.into(),
        account_address: account_address.into(),
        rules,
    }
}

/// Builds `MsgUpdateSpendingRules` packed into an `Any`.
pub fn update_spending_rules_any(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    rules: Vec<SpendingRule>,
) -> Any {
    to_any(
        &update_spending_rules(owner, account_address, rules),
        UPDATE_SPENDING_RULES,
    )
}

/// Builds `MsgUpdateSpendingRules` after checking the rules
/// ([`validate_spending_rules`]): an enabled rule that bounds nothing, or a
/// denom limit that would remove the limit for its denom, is refused here
/// rather than stored as a limit that limits nothing. Prefer this over
/// [`update_spending_rules`], which builds the message unchecked.
///
/// # Errors
///
/// [`Error::SpendingRule`](crate::Error::SpendingRule) naming the rule and the
/// problem.
pub fn update_spending_rules_checked(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    rules: Vec<SpendingRule>,
) -> crate::Result<pb::MsgUpdateSpendingRules> {
    validate_spending_rules(&rules)?;
    Ok(update_spending_rules(owner, account_address, rules))
}

/// Builds `MsgUpdateSpendingRules` packed into an `Any`, after checking the
/// rules ([`validate_spending_rules`]).
///
/// # Errors
///
/// [`Error::SpendingRule`](crate::Error::SpendingRule) naming the rule and the
/// problem.
pub fn update_spending_rules_checked_any(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    rules: Vec<SpendingRule>,
) -> crate::Result<Any> {
    Ok(to_any(
        &update_spending_rules_checked(owner, account_address, rules)?,
        UPDATE_SPENDING_RULES,
    ))
}

// Client-side checks for `MsgUpdateSpendingRules`.
//
// They follow the chain's own `ValidateBasic` (limits non-negative, at most
// MAX_DENOM_LIMITS denom limits and MAX_ALLOWED_EVM_CALLS allowed calls, one
// limit per denom, amounts as non-negative decimal integers with "" meaning
// "no limit of that kind") and refuse one shape the chain does not yet: an
// ENABLED rule that bounds nothing. A rule bounds something when it sets a
// rule-level per-tx or daily limit, a denom list, an allowed-call list, or a
// denom limit with a non-zero amount.
//
// From chain v3.2.5 the chain itself refuses these shapes when the rules are
// saved (abstractaccount code 8, "invalid spending rule"), and also an EVM token
// denom whose contract address does not parse: an `erc20/`, `erc721/` or
// `erc1155/` denom (prefix in any case) must carry a 0x-prefixed 20-byte hex
// address, and an `erc20/` denom is the address alone (no `/<token id>`).
//
// A denom limit with both amounts empty or zero is refused too, whatever else
// the rule sets. When a denom has an entry the chain applies only that entry
// and skips the rule-level limits for the denom, so such an entry silently
// removes every limit on it while the rule still reads as limited.

/// At most this many `denom_limits` per rule (chain `MaxDenomLimits`).
pub const MAX_DENOM_LIMITS: usize = 64;
/// At most this many `allowed_evm_calls` per rule (chain `MaxAllowedEVMCalls`).
pub const MAX_ALLOWED_EVM_CALLS: usize = 64;

fn rule_error(msg: String) -> crate::Error {
    crate::Error::SpendingRule(msg)
}

/// The EVM token denom prefixes the spending policy reads an address from.
pub const EVM_DENOM_PREFIXES: [&str; 3] = ["erc20/", "erc721/", "erc1155/"];

/// The chain's v3.2.5 check on an EVM token denom (`ValidateEVMDenom`): a denom
/// that starts with `erc20/`, `erc721/` or `erc1155/` (any case) must follow it
/// with a `0x`-prefixed 20-byte hex contract address, and an `erc20/` denom is
/// that address alone. Any other denom passes.
///
/// # Errors
///
/// [`Error::SpendingRule`](crate::Error::SpendingRule) naming the denom.
pub fn validate_evm_denom(denom: &str) -> crate::Result<()> {
    let lower = denom.to_ascii_lowercase();
    let Some(prefix) = EVM_DENOM_PREFIXES.iter().find(|p| lower.starts_with(**p)) else {
        return Ok(());
    };
    let rest = &denom[prefix.len()..];
    let (addr, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let ok = addr.len() == 42
        && (addr.starts_with("0x") || addr.starts_with("0X"))
        && addr[2..].bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        return Err(rule_error(format!(
            "denom {denom:?}: {prefix} must be followed by a 0x-prefixed 20-byte contract address"
        )));
    }
    if *prefix == "erc20/" && !tail.is_empty() {
        return Err(rule_error(format!(
            "denom {denom:?}: an erc20/ denom is the contract address alone"
        )));
    }
    Ok(())
}

/// A denom-limit amount: `""` is zero, otherwise a non-negative decimal
/// integer. Returns whether it is non-zero.
fn limit_amount_nonzero(s: &str, what: &str, i: usize) -> crate::Result<bool> {
    if s.is_empty() {
        return Ok(false);
    }
    if !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(rule_error(format!(
            "spending rule {i}: {what} {s:?} is not a non-negative decimal integer"
        )));
    }
    Ok(s.bytes().any(|b| b != b'0'))
}

fn strip_rule(e: crate::Error) -> String {
    match e {
        crate::Error::SpendingRule(m) => m,
        other => other.to_string(),
    }
}

/// Checks the rules of a `MsgUpdateSpendingRules` (see
/// [`update_spending_rules_checked`]): limits non-negative, at most
/// [`MAX_DENOM_LIMITS`] denom limits and [`MAX_ALLOWED_EVM_CALLS`] allowed
/// calls, one limit per denom (case-insensitive), amounts as non-negative
/// decimal integers, no denom limit with both amounts empty or zero (it would
/// remove the limit for its denom), no enabled rule that bounds nothing, and
/// EVM token denoms whose contract address parses ([`validate_evm_denom`]).
/// Chain v3.2.5 refuses the same rules when they are saved (code 8).
///
/// # Errors
///
/// [`Error::SpendingRule`](crate::Error::SpendingRule) naming the rule index
/// and the problem.
pub fn validate_spending_rules(rules: &[SpendingRule]) -> crate::Result<()> {
    for (i, rule) in rules.iter().enumerate() {
        if rule.daily_limit < 0 {
            return Err(rule_error(format!(
                "spending rule {i}: daily limit must be non-negative"
            )));
        }
        if rule.per_tx_limit < 0 {
            return Err(rule_error(format!(
                "spending rule {i}: per-tx limit must be non-negative"
            )));
        }
        let calls = &rule.allowed_evm_calls;
        let limits = &rule.denom_limits;
        if calls.len() > MAX_ALLOWED_EVM_CALLS {
            return Err(rule_error(format!(
                "spending rule {i}: at most {MAX_ALLOWED_EVM_CALLS} allowed EVM calls, got {}",
                calls.len()
            )));
        }
        if limits.len() > MAX_DENOM_LIMITS {
            return Err(rule_error(format!(
                "spending rule {i}: at most {MAX_DENOM_LIMITS} denom limits, got {}",
                limits.len()
            )));
        }
        let mut seen = std::collections::HashSet::new();
        let mut bounding_denom_limit = false;
        for dl in limits {
            let denom = dl.denom.as_str();
            if denom.trim().is_empty() {
                return Err(rule_error(format!(
                    "spending rule {i}: a denom limit has no denom"
                )));
            }
            if denom.encode_utf16().count() > 256
                || denom.chars().any(|c| c <= '\u{20}' || c == '\u{7f}')
            {
                return Err(rule_error(format!(
                    "spending rule {i}: denom {denom:?} is too long or contains whitespace"
                )));
            }
            validate_evm_denom(denom)
                .map_err(|e| rule_error(format!("spending rule {i}: {}", strip_rule(e))))?;
            if !seen.insert(denom.to_lowercase()) {
                return Err(rule_error(format!(
                    "spending rule {i}: denom {denom} has more than one limit"
                )));
            }
            let a =
                limit_amount_nonzero(&dl.per_tx_limit, &format!("denom {denom} per-tx limit"), i)?;
            let b =
                limit_amount_nonzero(&dl.daily_limit, &format!("denom {denom} daily limit"), i)?;
            if !a && !b {
                return Err(rule_error(format!(
                    "spending rule {i}: the limit for {denom} sets neither a per-tx nor a daily amount, \
                     which would remove the limit for {denom} (an entry replaces the rule-level limits \
                     for its denom); set an amount or drop the entry"
                )));
            }
            bounding_denom_limit = true;
        }
        for d in &rule.allowed_denoms {
            validate_evm_denom(d)
                .map_err(|e| rule_error(format!("spending rule {i}: {}", strip_rule(e))))?;
        }
        let bounded = rule.daily_limit > 0
            || rule.per_tx_limit > 0
            || !rule.allowed_denoms.is_empty()
            || !calls.is_empty()
            || bounding_denom_limit;
        if rule.enabled && !bounded {
            return Err(rule_error(format!(
                "spending rule {i} is enabled but bounds nothing: no per-tx or daily limit, no denom \
                 list, no allowed calls, and no denom limit with a non-zero amount. It would permit \
                 everything while showing as a spending limit; set at least one bound or disable it."
            )));
        }
    }
    Ok(())
}

/// Builds `MsgRegisterAuthenticator`, linking a foreign-scheme wallet key (e.g. a
/// Phantom ed25519 key) to `account_address` under time-bounded, revocable terms.
/// Only the account owner (root key) may call it.
#[allow(clippy::too_many_arguments)]
pub fn register_authenticator(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    permissions: Vec<String>,
    expiry_unix: i64,
    label: impl Into<String>,
) -> pb::MsgRegisterAuthenticator {
    pb::MsgRegisterAuthenticator {
        owner: owner.into(),
        account_address: account_address.into(),
        scheme: scheme.into(),
        pubkey,
        permissions,
        expiry_unix,
        label: label.into(),
    }
}

/// Builds `MsgRegisterAuthenticator` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn register_authenticator_any(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    permissions: Vec<String>,
    expiry_unix: i64,
    label: impl Into<String>,
) -> Any {
    to_any(
        &register_authenticator(
            owner,
            account_address,
            scheme,
            pubkey,
            permissions,
            expiry_unix,
            label,
        ),
        REGISTER_AUTHENTICATOR,
    )
}

/// Builds `MsgRevokeAuthenticator`, instantly disabling a previously linked wallet
/// key. Only the account owner (root key) may call it.
pub fn revoke_authenticator(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
) -> pb::MsgRevokeAuthenticator {
    pb::MsgRevokeAuthenticator {
        owner: owner.into(),
        account_address: account_address.into(),
        scheme: scheme.into(),
        pubkey,
    }
}

/// Builds `MsgRevokeAuthenticator` packed into an `Any`.
pub fn revoke_authenticator_any(
    owner: impl Into<String>,
    account_address: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
) -> Any {
    to_any(
        &revoke_authenticator(owner, account_address, scheme, pubkey),
        REVOKE_AUTHENTICATOR,
    )
}

/// Builds `MsgExecuteEVM` (v3.1.85 EVM authenticator lane): an EVM call/transfer
/// executed FROM the canonical `account`'s EVM address, authorized by a linked
/// authenticator `(scheme, pubkey, signature)` and broadcast by `relayer` (the
/// fee payer / message signer). `signature` is over the EVM auth sign-bytes (see
/// [`crate::authenticator::evm_auth_sign_bytes`]); `to` is the 0x-hex recipient
/// (empty = contract create), `value` the decimal wei (aqor) string, `data` the
/// calldata, and `nonce` MUST equal the linked key's authenticator sequence (not
/// the account's EVM nonce).
#[allow(clippy::too_many_arguments)]
pub fn execute_evm(
    relayer: impl Into<String>,
    account: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    signature: Vec<u8>,
    to: impl Into<String>,
    value: impl Into<String>,
    data: Vec<u8>,
    gas_limit: u64,
    nonce: u64,
) -> pb::MsgExecuteEvm {
    pb::MsgExecuteEvm {
        relayer: relayer.into(),
        account: account.into(),
        scheme: scheme.into(),
        pubkey,
        signature,
        to: to.into(),
        value: value.into(),
        data,
        gas_limit,
        nonce,
    }
}

/// Builds `MsgExecuteEVM` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn execute_evm_any(
    relayer: impl Into<String>,
    account: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    signature: Vec<u8>,
    to: impl Into<String>,
    value: impl Into<String>,
    data: Vec<u8>,
    gas_limit: u64,
    nonce: u64,
) -> Any {
    to_any(
        &execute_evm(
            relayer, account, scheme, pubkey, signature, to, value, data, gas_limit, nonce,
        ),
        EXECUTE_EVM,
    )
}

/// Builds `MsgExecuteCosmos` (v3.1.85 Native authenticator lane): a bank send
/// executed FROM the canonical `account`, authorized by a linked authenticator
/// `(scheme, pubkey, signature)` and broadcast by `relayer` (the fee payer /
/// message signer). `signature` is over the Cosmos auth sign-bytes (see
/// [`crate::authenticator::cosmos_auth_sign_bytes`]); `amount` is the coins to
/// move (canonical `sdk.Coins`, e.g. one `uqor` coin), and `nonce` MUST equal the
/// account+key's current per-authenticator sequence.
#[allow(clippy::too_many_arguments)]
pub fn execute_cosmos(
    relayer: impl Into<String>,
    account: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    signature: Vec<u8>,
    to: impl Into<String>,
    amount: Vec<Coin>,
    nonce: u64,
) -> pb::MsgExecuteCosmos {
    pb::MsgExecuteCosmos {
        relayer: relayer.into(),
        account: account.into(),
        scheme: scheme.into(),
        pubkey,
        signature,
        to: to.into(),
        amount,
        nonce,
    }
}

/// Builds `MsgExecuteCosmos` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn execute_cosmos_any(
    relayer: impl Into<String>,
    account: impl Into<String>,
    scheme: impl Into<String>,
    pubkey: Vec<u8>,
    signature: Vec<u8>,
    to: impl Into<String>,
    amount: Vec<Coin>,
    nonce: u64,
) -> Any {
    to_any(
        &execute_cosmos(
            relayer, account, scheme, pubkey, signature, to, amount, nonce,
        ),
        EXECUTE_COSMOS,
    )
}

/// Builds `MsgUpdateConfig` (chain v3.2.5): replace the abstract-account
/// configuration wholesale. Governance only: `authority` is the gov module
/// account, so it runs from a passed proposal. Copy the current values from
/// `/qorechain/abstractaccount/v1/config` and change only what you mean to;
/// `enabled` gates account creation, authenticator registration and both
/// execute lanes.
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) when `authority` is
/// empty or a limit is not positive (the chain requires all three positive).
pub fn update_config(
    authority: impl Into<String>,
    enabled: bool,
    max_session_keys: i32,
    max_spending_rules: i32,
    default_session_ttl: i64,
) -> crate::Result<pb::MsgUpdateConfig> {
    let authority = authority.into();
    if authority.is_empty() {
        return Err(crate::Error::InvalidInput(
            "update_config: authority is required".into(),
        ));
    }
    for (name, v) in [
        ("max_session_keys", i64::from(max_session_keys)),
        ("max_spending_rules", i64::from(max_spending_rules)),
        ("default_session_ttl", default_session_ttl),
    ] {
        if v <= 0 {
            return Err(crate::Error::InvalidInput(format!(
                "update_config: {name} must be positive, got {v}"
            )));
        }
    }
    Ok(pb::MsgUpdateConfig {
        authority,
        enabled,
        max_session_keys,
        max_spending_rules,
        default_session_ttl,
    })
}

/// Builds `MsgUpdateConfig` packed into an `Any`.
///
/// # Errors
///
/// As [`update_config`].
pub fn update_config_any(
    authority: impl Into<String>,
    enabled: bool,
    max_session_keys: i32,
    max_spending_rules: i32,
    default_session_ttl: i64,
) -> crate::Result<Any> {
    Ok(to_any(
        &update_config(
            authority,
            enabled,
            max_session_keys,
            max_spending_rules,
            default_session_ttl,
        )?,
        UPDATE_CONFIG,
    ))
}
