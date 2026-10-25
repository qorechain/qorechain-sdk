//! `qorechain.stakingtier.v1` message composers (chain v3.2.4).
//!
//! Lock part of a delegation for 3, 6 or 12 months for a bonus on top of the
//! staking reward, leave a lock early (a penalty is burned and the bonus
//! forfeited), and claim the accrued bonus. The reads are in
//! [`crate::stakingtier`].

use crate::msg::to_any;
use crate::proto::qorechain::stakingtier::v1 as pb;
use cosmrs::Any;

pub use pb::LockTierParam;

/// `/qorechain.stakingtier.v1.MsgLockDelegation` type URL.
pub const LOCK_DELEGATION: &str = "/qorechain.stakingtier.v1.MsgLockDelegation";
/// `/qorechain.stakingtier.v1.MsgUnlockEarly` type URL.
pub const UNLOCK_EARLY: &str = "/qorechain.stakingtier.v1.MsgUnlockEarly";
/// `/qorechain.stakingtier.v1.MsgClaimBonus` type URL.
pub const CLAIM_BONUS: &str = "/qorechain.stakingtier.v1.MsgClaimBonus";
/// `/qorechain.stakingtier.v1.MsgUpdateParams` type URL.
pub const UPDATE_PARAMS: &str = "/qorechain.stakingtier.v1.MsgUpdateParams";

/// Builds `MsgLockDelegation`: lock `amount` (base units) of the delegator's
/// existing delegation to `validator` for `months` (one of
/// [`STAKING_LOCK_MONTHS`](crate::stakingtier::STAKING_LOCK_MONTHS)).
///
/// # Errors
///
/// [`Error::StakingTier`](crate::Error::StakingTier) naming the field the
/// chain would refuse ([`crate::stakingtier::validate_lock_delegation`]).
pub fn lock_delegation(
    delegator: impl Into<String>,
    validator: impl Into<String>,
    amount: impl Into<String>,
    months: u32,
) -> crate::Result<pb::MsgLockDelegation> {
    let (delegator, validator, amount) = (delegator.into(), validator.into(), amount.into());
    crate::stakingtier::validate_lock_delegation(&delegator, &validator, &amount, months)?;
    Ok(pb::MsgLockDelegation {
        delegator,
        validator,
        amount,
        months,
    })
}

/// Builds `MsgLockDelegation` packed into an `Any`.
///
/// # Errors
///
/// As [`lock_delegation`].
pub fn lock_delegation_any(
    delegator: impl Into<String>,
    validator: impl Into<String>,
    amount: impl Into<String>,
    months: u32,
) -> crate::Result<Any> {
    Ok(to_any(
        &lock_delegation(delegator, validator, amount, months)?,
        LOCK_DELEGATION,
    ))
}

/// Builds `MsgUnlockEarly`: release lock `lock_id` before its term ends.
pub fn unlock_early(delegator: impl Into<String>, lock_id: u64) -> pb::MsgUnlockEarly {
    pb::MsgUnlockEarly {
        delegator: delegator.into(),
        lock_id,
    }
}

/// Builds `MsgUnlockEarly` packed into an `Any`.
pub fn unlock_early_any(delegator: impl Into<String>, lock_id: u64) -> Any {
    to_any(&unlock_early(delegator, lock_id), UNLOCK_EARLY)
}

/// Builds `MsgClaimBonus`: claim the holder's accrued bonus.
pub fn claim_bonus(holder: impl Into<String>) -> pb::MsgClaimBonus {
    pb::MsgClaimBonus {
        holder: holder.into(),
    }
}

/// Builds `MsgClaimBonus` packed into an `Any`.
pub fn claim_bonus_any(holder: impl Into<String>) -> Any {
    to_any(&claim_bonus(holder), CLAIM_BONUS)
}

/// Packs `MsgUpdateParams`, which replaces the staking-tier parameters
/// wholesale, into an `Any`. Governance only: `params.authority` must be the
/// gov module account.
pub fn update_params_any(params: &pb::MsgUpdateParams) -> Any {
    to_any(params, UPDATE_PARAMS)
}
