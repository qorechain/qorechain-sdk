//! `qorechain.abstractaccount.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::abstractaccount::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
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
/// `/qorechain.abstractaccount.v1.MsgExecuteEVM` type URL.
pub const EXECUTE_EVM: &str = "/qorechain.abstractaccount.v1.MsgExecuteEVM";
/// `/qorechain.abstractaccount.v1.MsgExecuteCosmos` type URL.
pub const EXECUTE_COSMOS: &str = "/qorechain.abstractaccount.v1.MsgExecuteCosmos";

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

/// Builds `MsgExecuteEVM` (v3.1.85 EVM authenticator lane): an EVM call/transfer
/// executed FROM the canonical `account`'s EVM address, authorized by a linked
/// authenticator `(scheme, pubkey, signature)` and broadcast by `relayer` (the
/// fee payer / message signer). `signature` is over the EVM auth sign-bytes (see
/// [`crate::authenticator::evm_auth_sign_bytes`]); `to` is the 0x-hex recipient
/// (empty = contract create), `value` the decimal wei (aqor) string, `data` the
/// calldata, and `nonce` MUST equal the account's current EVM nonce.
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
