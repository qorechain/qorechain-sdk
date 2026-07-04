//! `qorechain.abstractaccount.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::abstractaccount::v1 as pb;
use cosmrs::Any;

pub use pb::SpendingRule;

/// `/qorechain.abstractaccount.v1.MsgCreateAbstractAccount` type URL.
pub const CREATE_ABSTRACT_ACCOUNT: &str = "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount";
/// `/qorechain.abstractaccount.v1.MsgUpdateSpendingRules` type URL.
pub const UPDATE_SPENDING_RULES: &str = "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules";
/// `/qorechain.abstractaccount.v1.MsgRegisterAuthenticator` type URL.
pub const REGISTER_AUTHENTICATOR: &str = "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator";
/// `/qorechain.abstractaccount.v1.MsgRevokeAuthenticator` type URL.
pub const REVOKE_AUTHENTICATOR: &str = "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator";

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
