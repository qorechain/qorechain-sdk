//! `qorechain.abstractaccount.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::abstractaccount::v1 as pb;
use cosmrs::Any;

pub use pb::SpendingRule;

/// `/qorechain.abstractaccount.v1.MsgCreateAbstractAccount` type URL.
pub const CREATE_ABSTRACT_ACCOUNT: &str = "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount";
/// `/qorechain.abstractaccount.v1.MsgUpdateSpendingRules` type URL.
pub const UPDATE_SPENDING_RULES: &str = "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules";

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
