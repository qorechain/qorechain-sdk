//! Standard Cosmos SDK message composers (bank, staking, distribution, gov,
//! authz, feegrant, ibc) built from the `cosmrs`/`cosmos-sdk-proto` types, with
//! the canonical type URLs.
//!
//! These cover the messages a dApp commonly sends alongside the QoreChain custom
//! modules. Each returns a prost message; the `*_any` variants pack it into a
//! `cosmrs::Any`.

use crate::msg::to_any;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

use cosmrs::proto::cosmos::bank::v1beta1::MsgSend;
use cosmrs::proto::cosmos::distribution::v1beta1::{
    MsgWithdrawDelegatorReward, MsgWithdrawValidatorCommission,
};
use cosmrs::proto::cosmos::staking::v1beta1::{MsgBeginRedelegate, MsgDelegate, MsgUndelegate};

// --- bank ---

/// `/cosmos.bank.v1beta1.MsgSend` type URL.
pub const MSG_SEND: &str = "/cosmos.bank.v1beta1.MsgSend";

/// Builds the standard bank `MsgSend`.
pub fn bank_send(
    from_address: impl Into<String>,
    to_address: impl Into<String>,
    amount: Vec<Coin>,
) -> MsgSend {
    MsgSend {
        from_address: from_address.into(),
        to_address: to_address.into(),
        amount,
    }
}

/// Builds `MsgSend` packed into an `Any`.
pub fn bank_send_any(
    from_address: impl Into<String>,
    to_address: impl Into<String>,
    amount: Vec<Coin>,
) -> Any {
    to_any(&bank_send(from_address, to_address, amount), MSG_SEND)
}

// --- staking ---

/// `/cosmos.staking.v1beta1.MsgDelegate` type URL.
pub const MSG_DELEGATE: &str = "/cosmos.staking.v1beta1.MsgDelegate";
/// `/cosmos.staking.v1beta1.MsgUndelegate` type URL.
pub const MSG_UNDELEGATE: &str = "/cosmos.staking.v1beta1.MsgUndelegate";
/// `/cosmos.staking.v1beta1.MsgBeginRedelegate` type URL.
pub const MSG_BEGIN_REDELEGATE: &str = "/cosmos.staking.v1beta1.MsgBeginRedelegate";

/// Builds the staking `MsgDelegate`.
pub fn delegate(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
    amount: Coin,
) -> MsgDelegate {
    MsgDelegate {
        delegator_address: delegator_address.into(),
        validator_address: validator_address.into(),
        amount: Some(amount),
    }
}

/// Builds `MsgDelegate` packed into an `Any`.
pub fn delegate_any(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
    amount: Coin,
) -> Any {
    to_any(
        &delegate(delegator_address, validator_address, amount),
        MSG_DELEGATE,
    )
}

/// Builds the staking `MsgUndelegate`.
pub fn undelegate(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
    amount: Coin,
) -> MsgUndelegate {
    MsgUndelegate {
        delegator_address: delegator_address.into(),
        validator_address: validator_address.into(),
        amount: Some(amount),
    }
}

/// Builds `MsgUndelegate` packed into an `Any`.
pub fn undelegate_any(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
    amount: Coin,
) -> Any {
    to_any(
        &undelegate(delegator_address, validator_address, amount),
        MSG_UNDELEGATE,
    )
}

/// Builds the staking `MsgBeginRedelegate`.
pub fn begin_redelegate(
    delegator_address: impl Into<String>,
    validator_src_address: impl Into<String>,
    validator_dst_address: impl Into<String>,
    amount: Coin,
) -> MsgBeginRedelegate {
    MsgBeginRedelegate {
        delegator_address: delegator_address.into(),
        validator_src_address: validator_src_address.into(),
        validator_dst_address: validator_dst_address.into(),
        amount: Some(amount),
    }
}

/// Builds `MsgBeginRedelegate` packed into an `Any`.
pub fn begin_redelegate_any(
    delegator_address: impl Into<String>,
    validator_src_address: impl Into<String>,
    validator_dst_address: impl Into<String>,
    amount: Coin,
) -> Any {
    to_any(
        &begin_redelegate(
            delegator_address,
            validator_src_address,
            validator_dst_address,
            amount,
        ),
        MSG_BEGIN_REDELEGATE,
    )
}

// --- distribution ---

/// `/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward` type URL.
pub const MSG_WITHDRAW_DELEGATOR_REWARD: &str =
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward";
/// `/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission` type URL.
pub const MSG_WITHDRAW_VALIDATOR_COMMISSION: &str =
    "/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission";

/// Builds the distribution `MsgWithdrawDelegatorReward`.
pub fn withdraw_delegator_reward(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
) -> MsgWithdrawDelegatorReward {
    MsgWithdrawDelegatorReward {
        delegator_address: delegator_address.into(),
        validator_address: validator_address.into(),
    }
}

/// Builds `MsgWithdrawDelegatorReward` packed into an `Any`.
pub fn withdraw_delegator_reward_any(
    delegator_address: impl Into<String>,
    validator_address: impl Into<String>,
) -> Any {
    to_any(
        &withdraw_delegator_reward(delegator_address, validator_address),
        MSG_WITHDRAW_DELEGATOR_REWARD,
    )
}

/// Builds the distribution `MsgWithdrawValidatorCommission`.
pub fn withdraw_validator_commission(
    validator_address: impl Into<String>,
) -> MsgWithdrawValidatorCommission {
    MsgWithdrawValidatorCommission {
        validator_address: validator_address.into(),
    }
}

/// Builds `MsgWithdrawValidatorCommission` packed into an `Any`.
pub fn withdraw_validator_commission_any(validator_address: impl Into<String>) -> Any {
    to_any(
        &withdraw_validator_commission(validator_address),
        MSG_WITHDRAW_VALIDATOR_COMMISSION,
    )
}

// --- gov (v1) ---

/// `/cosmos.gov.v1.MsgVote` type URL.
pub const MSG_VOTE: &str = "/cosmos.gov.v1.MsgVote";

/// Builds the gov `MsgVote`. `option` is the numeric `VoteOption`
/// (1 = yes, 2 = abstain, 3 = no, 4 = no-with-veto).
pub fn vote(
    proposal_id: u64,
    voter: impl Into<String>,
    option: i32,
    metadata: impl Into<String>,
) -> cosmrs::proto::cosmos::gov::v1::MsgVote {
    cosmrs::proto::cosmos::gov::v1::MsgVote {
        proposal_id,
        voter: voter.into(),
        option,
        metadata: metadata.into(),
    }
}

/// Builds `MsgVote` packed into an `Any`.
pub fn vote_any(
    proposal_id: u64,
    voter: impl Into<String>,
    option: i32,
    metadata: impl Into<String>,
) -> Any {
    to_any(&vote(proposal_id, voter, option, metadata), MSG_VOTE)
}

// --- authz ---

/// `/cosmos.authz.v1beta1.MsgExec` type URL.
pub const MSG_EXEC: &str = "/cosmos.authz.v1beta1.MsgExec";
/// `/cosmos.authz.v1beta1.MsgRevoke` type URL.
pub const MSG_REVOKE: &str = "/cosmos.authz.v1beta1.MsgRevoke";

/// Builds the authz `MsgExec`, wrapping the inner messages for `grantee` to
/// execute on behalf of the granter.
pub fn authz_exec(
    grantee: impl Into<String>,
    msgs: Vec<Any>,
) -> cosmrs::proto::cosmos::authz::v1beta1::MsgExec {
    cosmrs::proto::cosmos::authz::v1beta1::MsgExec {
        grantee: grantee.into(),
        msgs,
    }
}

/// Builds `MsgExec` packed into an `Any`.
pub fn authz_exec_any(grantee: impl Into<String>, msgs: Vec<Any>) -> Any {
    to_any(&authz_exec(grantee, msgs), MSG_EXEC)
}

/// Builds the authz `MsgRevoke` for a granted `msg_type_url`.
pub fn authz_revoke(
    granter: impl Into<String>,
    grantee: impl Into<String>,
    msg_type_url: impl Into<String>,
) -> cosmrs::proto::cosmos::authz::v1beta1::MsgRevoke {
    cosmrs::proto::cosmos::authz::v1beta1::MsgRevoke {
        granter: granter.into(),
        grantee: grantee.into(),
        msg_type_url: msg_type_url.into(),
    }
}

/// Builds `MsgRevoke` packed into an `Any`.
pub fn authz_revoke_any(
    granter: impl Into<String>,
    grantee: impl Into<String>,
    msg_type_url: impl Into<String>,
) -> Any {
    to_any(&authz_revoke(granter, grantee, msg_type_url), MSG_REVOKE)
}

// --- feegrant ---

/// `/cosmos.feegrant.v1beta1.MsgRevokeAllowance` type URL.
pub const MSG_REVOKE_ALLOWANCE: &str = "/cosmos.feegrant.v1beta1.MsgRevokeAllowance";

/// Builds the feegrant `MsgRevokeAllowance`.
pub fn revoke_allowance(
    granter: impl Into<String>,
    grantee: impl Into<String>,
) -> cosmrs::proto::cosmos::feegrant::v1beta1::MsgRevokeAllowance {
    cosmrs::proto::cosmos::feegrant::v1beta1::MsgRevokeAllowance {
        granter: granter.into(),
        grantee: grantee.into(),
    }
}

/// Builds `MsgRevokeAllowance` packed into an `Any`.
pub fn revoke_allowance_any(granter: impl Into<String>, grantee: impl Into<String>) -> Any {
    to_any(&revoke_allowance(granter, grantee), MSG_REVOKE_ALLOWANCE)
}

// --- ibc transfer ---
//
// The ICS-20 `MsgTransfer` is not bundled here: `cosmos-sdk-proto` (the proto
// crate `cosmrs` re-exports) does not ship the IBC types, and `to_any` accepts
// any prost message, so a caller wanting IBC can build the message from the
// `ibc-proto` crate and pack it directly:
//
// ```ignore
// use qorechain::msg::to_any;
// let any = to_any(&ibc_proto::ibc::applications::transfer::v1::MsgTransfer { .. },
//                  "/ibc.applications.transfer.v1.MsgTransfer");
// ```
/// `/ibc.applications.transfer.v1.MsgTransfer` type URL, exposed so callers can
/// pack an `ibc-proto` `MsgTransfer` with [`crate::msg::to_any`].
pub const MSG_TRANSFER: &str = "/ibc.applications.transfer.v1.MsgTransfer";
