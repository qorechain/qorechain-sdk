//! Staking tiers (chain v3.2.4, `x/stakingtier`).
//!
//! A delegator locks part of an existing delegation for 3, 6 or 12 months and
//! earns a bonus on top of the staking reward (the terms and bonus rates are
//! governance parameters, read them with [`fetch_staking_tier_params`]).
//! Running a light node or a validator adds to the bonus, up to a total cap.
//! Leaving a lock early burns a penalty and forfeits the bonus.
//!
//! Messages: [`crate::msg::stakingtier::lock_delegation`], `unlock_early`,
//! `claim_bonus`. Reads (REST): [`fetch_staking_tier_params`],
//! [`fetch_staking_locks`], [`fetch_staking_tier_pool`].
//!
//! Every integer the chain renders as a string (`int64`, `uint64`, amounts)
//! is parsed exactly: amounts are `u128`, heights and Unix times `i64`, ids
//! and counts `u64`. Decimal fields stay strings.

use crate::error::{Error, Result};
use crate::query::RestClient;
use serde_json::Value;

/// The lock terms the chain accepts (`AllowedLockMonths`).
pub const STAKING_LOCK_MONTHS: [u32; 3] = [3, 6, 12];

/// The codespace the module's refusals are reported under.
pub const STAKINGTIER_CODESPACE: &str = "stakingtier";

/// The REST path of the module parameters.
pub const STAKING_TIER_PARAMS_PATH: &str = "/qorechain/stakingtier/v1/params";

/// The REST path of the bonus pool.
pub const STAKING_TIER_POOL_PATH: &str = "/qorechain/stakingtier/v1/pool";

/// The REST path of a holder's locks.
pub fn staking_locks_path(holder: &str) -> String {
    format!("/qorechain/stakingtier/v1/locks/{holder}")
}

/// The chain's stateless checks on `MsgLockDelegation`, run by
/// [`crate::msg::stakingtier::lock_delegation`] before encoding: delegator and
/// validator set, `amount` a positive integer in base units, `months` one of
/// [`STAKING_LOCK_MONTHS`].
///
/// # Errors
///
/// [`Error::StakingTier`] naming the field.
pub fn validate_lock_delegation(
    delegator: &str,
    validator: &str,
    amount: &str,
    months: u32,
) -> Result<()> {
    if delegator.is_empty() {
        return Err(Error::StakingTier(
            "lock_delegation: delegator is required".into(),
        ));
    }
    if validator.is_empty() {
        return Err(Error::StakingTier(
            "lock_delegation: validator is required".into(),
        ));
    }
    let digits = !amount.is_empty() && amount.bytes().all(|b| b.is_ascii_digit());
    if !digits || amount.bytes().all(|b| b == b'0') {
        return Err(Error::StakingTier(format!(
            "lock_delegation: amount must be a positive integer in base units, got {amount:?}"
        )));
    }
    if !STAKING_LOCK_MONTHS.contains(&months) {
        return Err(Error::StakingTier(format!(
            "lock_delegation: months must be one of 3, 6, 12, got {months}"
        )));
    }
    Ok(())
}

/// The stable kind of a `stakingtier` refusal code (2–13), matching the other
/// SDKs' kind strings; `None` for any other code. The reason text is in
/// [`crate::tx::decode_tx_error`].
pub fn stakingtier_error_kind(code: u32) -> Option<&'static str> {
    Some(match code {
        2 => "stakingtier_invalid_params",
        3 => "stakingtier_not_active",
        4 => "stakingtier_disabled",
        5 => "stakingtier_invalid_term",
        6 => "stakingtier_invalid_amount",
        7 => "stakingtier_insufficient_unlocked",
        8 => "stakingtier_lock_not_found",
        9 => "stakingtier_not_lock_owner",
        10 => "stakingtier_lock_expired",
        11 => "stakingtier_too_many_locks",
        12 => "stakingtier_nothing_to_claim",
        13 => "stakingtier_stake_locked",
        _ => return None,
    })
}

/// One offered term and its bonus.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StakingLockTier {
    /// The term, in months.
    pub months: u32,
    /// The bonus, in basis points of APY.
    pub bonus_bps: u32,
}

/// Module parameters (`/qorechain/stakingtier/v1/params`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StakingTierParams {
    /// Offered terms and their bonus.
    pub lock_tiers: Vec<StakingLockTier>,
    /// Extra bonus for a holder that runs an active light node.
    pub light_node_bonus_bps: u32,
    /// Extra bonus for a holder that runs a validator.
    pub validator_bonus_bps: u32,
    /// Cap on the total yield (staking reward plus every bonus).
    pub max_total_apy_bps: u32,
    /// Share of the locked amount burned on an early unlock.
    pub early_unlock_penalty_bps: u32,
    /// Whether governance has the module switched on.
    pub enabled: bool,
    /// Smallest lock, in base units.
    pub min_lock_amount: u128,
}

/// One lock (`/qorechain/stakingtier/v1/locks/{holder}`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StakingLock {
    /// The lock id.
    pub id: u64,
    /// The validator the locked delegation is with.
    pub validator: String,
    /// What the lock covers today, in base units (shrinks with a slash).
    pub locked_amount: u128,
    /// The locked delegation shares (decimal string).
    pub locked_shares: String,
    /// The term, in months.
    pub months: u32,
    /// The term's bonus, fixed when the lock was made.
    pub tier_bonus_bps: u32,
    /// The height the lock was made at.
    pub start_height: i64,
    /// Unix seconds.
    pub start_time: i64,
    /// Unix seconds; the lock is released at this block time.
    pub end_time: i64,
    /// Credited and not yet claimed; an early unlock forfeits it.
    pub accrued_bonus: u128,
    /// The lock has expired and no longer restricts the delegation.
    pub released: bool,
    /// The light-node bonus that would apply at the next settlement.
    pub light_node_bonus_bps: u32,
    /// The validator bonus that would apply at the next settlement.
    pub validator_bonus_bps: u32,
    /// Decimal string.
    pub projected_bonus_bps: String,
    /// What that rate earns from the last settlement to the lock's end.
    pub projected_bonus_to_expiry: u128,
}

/// A holder's locks and claimable bonus.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StakingLocks {
    /// The holder's locks.
    pub locks: Vec<StakingLock>,
    /// Credited outside any open lock (expired locks, validator self-bond).
    pub claimable: u128,
    /// What `MsgClaimBonus` would pay now.
    pub total_claimable: u128,
}

/// The bonus pool (`/qorechain/stakingtier/v1/pool`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StakingTierPool {
    /// The module account balance.
    pub balance: u128,
    /// Credited to holders and not yet claimed.
    pub outstanding: u128,
    /// Balance less outstanding.
    pub surplus: u128,
    /// Minted into the pool so far.
    pub total_minted: u128,
    /// Paid out so far.
    pub total_paid: u128,
    /// Forfeited by early unlocks so far.
    pub total_forfeited: u128,
    /// Burned as early-unlock penalties so far.
    pub total_penalty_burned: u128,
    /// Unix seconds of the latest settlement.
    pub last_settle_time: i64,
    /// Height of the latest settlement.
    pub last_settle_height: i64,
    /// Decimal string.
    pub last_base_apy_bps: String,
    /// Open (not yet expired) locks.
    pub lock_count: u64,
}

fn bad(field: &str, v: &Value) -> Error {
    Error::InvalidResponse(format!(
        "stakingtier field {field:?} is not an integer: {v}"
    ))
}

/// An exact integer from a JSON string or number; absent is zero.
fn int<T: std::str::FromStr + Default + TryFrom<u64> + TryFrom<i64>>(
    v: &Value,
    field: &str,
) -> Result<T> {
    let x = &v[field];
    match x {
        Value::Null => Ok(T::default()),
        Value::String(s) if s.trim().is_empty() => Ok(T::default()),
        Value::String(s) => s.trim().parse::<T>().map_err(|_| bad(field, x)),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                T::try_from(u).map_err(|_| bad(field, x))
            } else if let Some(i) = n.as_i64() {
                T::try_from(i).map_err(|_| bad(field, x))
            } else {
                Err(bad(field, x))
            }
        }
        _ => Err(bad(field, x)),
    }
}

fn string(v: &Value, field: &str) -> String {
    v[field].as_str().unwrap_or_default().to_string()
}

fn flag(v: &Value, field: &str) -> bool {
    v[field].as_bool().unwrap_or(false)
}

fn items<'a>(v: &'a Value, field: &str) -> &'a [Value] {
    v[field].as_array().map(Vec::as_slice).unwrap_or_default()
}

/// Parses a `params` payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when an integer field is not an integer.
pub fn parse_staking_tier_params(b: &Value) -> Result<StakingTierParams> {
    Ok(StakingTierParams {
        lock_tiers: items(b, "lock_tiers")
            .iter()
            .map(|t| {
                Ok(StakingLockTier {
                    months: int(t, "months")?,
                    bonus_bps: int(t, "bonus_bps")?,
                })
            })
            .collect::<Result<_>>()?,
        light_node_bonus_bps: int(b, "light_node_bonus_bps")?,
        validator_bonus_bps: int(b, "validator_bonus_bps")?,
        max_total_apy_bps: int(b, "max_total_apy_bps")?,
        early_unlock_penalty_bps: int(b, "early_unlock_penalty_bps")?,
        enabled: flag(b, "enabled"),
        min_lock_amount: int(b, "min_lock_amount")?,
    })
}

/// Parses a `locks/{holder}` payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when an integer field is not an integer.
pub fn parse_staking_locks(b: &Value) -> Result<StakingLocks> {
    Ok(StakingLocks {
        locks: items(b, "locks")
            .iter()
            .map(|l| {
                Ok(StakingLock {
                    id: int(l, "id")?,
                    validator: string(l, "validator"),
                    locked_amount: int(l, "locked_amount")?,
                    locked_shares: string(l, "locked_shares"),
                    months: int(l, "months")?,
                    tier_bonus_bps: int(l, "tier_bonus_bps")?,
                    start_height: int(l, "start_height")?,
                    start_time: int(l, "start_time")?,
                    end_time: int(l, "end_time")?,
                    accrued_bonus: int(l, "accrued_bonus")?,
                    released: flag(l, "released"),
                    light_node_bonus_bps: int(l, "light_node_bonus_bps")?,
                    validator_bonus_bps: int(l, "validator_bonus_bps")?,
                    projected_bonus_bps: string(l, "projected_bonus_bps"),
                    projected_bonus_to_expiry: int(l, "projected_bonus_to_expiry")?,
                })
            })
            .collect::<Result<_>>()?,
        claimable: int(b, "claimable")?,
        total_claimable: int(b, "total_claimable")?,
    })
}

/// Parses a `pool` payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when an integer field is not an integer.
pub fn parse_staking_tier_pool(b: &Value) -> Result<StakingTierPool> {
    Ok(StakingTierPool {
        balance: int(b, "balance")?,
        outstanding: int(b, "outstanding")?,
        surplus: int(b, "surplus")?,
        total_minted: int(b, "total_minted")?,
        total_paid: int(b, "total_paid")?,
        total_forfeited: int(b, "total_forfeited")?,
        total_penalty_burned: int(b, "total_penalty_burned")?,
        last_settle_time: int(b, "last_settle_time")?,
        last_settle_height: int(b, "last_settle_height")?,
        last_base_apy_bps: string(b, "last_base_apy_bps"),
        lock_count: int(b, "lock_count")?,
    })
}

/// Reads the module parameters.
///
/// # Errors
///
/// Transport / HTTP errors from the REST client, or [`Error::InvalidResponse`]
/// on an unparsable body.
pub async fn fetch_staking_tier_params(rest: &RestClient) -> Result<StakingTierParams> {
    parse_staking_tier_params(&rest.get(STAKING_TIER_PARAMS_PATH, &[]).await?)
}

/// Reads a holder's locks and claimable bonus (`holder` is the `qor1…`
/// account).
///
/// # Errors
///
/// Transport / HTTP errors from the REST client, or [`Error::InvalidResponse`]
/// on an unparsable body.
pub async fn fetch_staking_locks(rest: &RestClient, holder: &str) -> Result<StakingLocks> {
    parse_staking_locks(&rest.get(&staking_locks_path(holder), &[]).await?)
}

/// Reads the bonus pool.
///
/// # Errors
///
/// Transport / HTTP errors from the REST client, or [`Error::InvalidResponse`]
/// on an unparsable body.
pub async fn fetch_staking_tier_pool(rest: &RestClient) -> Result<StakingTierPool> {
    parse_staking_tier_pool(&rest.get(STAKING_TIER_POOL_PATH, &[]).await?)
}
