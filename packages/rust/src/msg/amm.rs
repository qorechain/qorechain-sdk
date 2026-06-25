//! `qorechain.amm.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::amm::v1 as pb;
use cosmrs::proto::cosmos::base::v1beta1::Coin;
use cosmrs::Any;

/// `/qorechain.amm.v1.MsgCreatePool` type URL.
pub const CREATE_POOL: &str = "/qorechain.amm.v1.MsgCreatePool";
/// `/qorechain.amm.v1.MsgAddLiquidity` type URL.
pub const ADD_LIQUIDITY: &str = "/qorechain.amm.v1.MsgAddLiquidity";
/// `/qorechain.amm.v1.MsgRemoveLiquidity` type URL.
pub const REMOVE_LIQUIDITY: &str = "/qorechain.amm.v1.MsgRemoveLiquidity";
/// `/qorechain.amm.v1.MsgSwapExactIn` type URL.
pub const SWAP_EXACT_IN: &str = "/qorechain.amm.v1.MsgSwapExactIn";
/// `/qorechain.amm.v1.MsgSwapExactOut` type URL.
pub const SWAP_EXACT_OUT: &str = "/qorechain.amm.v1.MsgSwapExactOut";
/// `/qorechain.amm.v1.MsgPausePool` type URL.
pub const PAUSE_POOL: &str = "/qorechain.amm.v1.MsgPausePool";
/// `/qorechain.amm.v1.MsgResumePool` type URL.
pub const RESUME_POOL: &str = "/qorechain.amm.v1.MsgResumePool";

/// Builds `MsgCreatePool`.
pub fn create_pool(
    creator: impl Into<String>,
    pool_type: impl Into<String>,
    initial_deposit_a: Coin,
    initial_deposit_b: Coin,
    amplification_coefficient: u32,
) -> pb::MsgCreatePool {
    pb::MsgCreatePool {
        creator: creator.into(),
        pool_type: pool_type.into(),
        initial_deposit_a: Some(initial_deposit_a),
        initial_deposit_b: Some(initial_deposit_b),
        amplification_coefficient,
    }
}

/// Builds `MsgCreatePool` packed into an `Any`.
pub fn create_pool_any(
    creator: impl Into<String>,
    pool_type: impl Into<String>,
    initial_deposit_a: Coin,
    initial_deposit_b: Coin,
    amplification_coefficient: u32,
) -> Any {
    to_any(
        &create_pool(
            creator,
            pool_type,
            initial_deposit_a,
            initial_deposit_b,
            amplification_coefficient,
        ),
        CREATE_POOL,
    )
}

/// Builds `MsgAddLiquidity`.
pub fn add_liquidity(
    sender: impl Into<String>,
    pool_id: u64,
    amount_a: Coin,
    amount_b: Coin,
    min_lp_out: impl Into<String>,
) -> pb::MsgAddLiquidity {
    pb::MsgAddLiquidity {
        sender: sender.into(),
        pool_id,
        amount_a: Some(amount_a),
        amount_b: Some(amount_b),
        min_lp_out: min_lp_out.into(),
    }
}

/// Builds `MsgAddLiquidity` packed into an `Any`.
pub fn add_liquidity_any(
    sender: impl Into<String>,
    pool_id: u64,
    amount_a: Coin,
    amount_b: Coin,
    min_lp_out: impl Into<String>,
) -> Any {
    to_any(
        &add_liquidity(sender, pool_id, amount_a, amount_b, min_lp_out),
        ADD_LIQUIDITY,
    )
}

/// Builds `MsgRemoveLiquidity`.
pub fn remove_liquidity(
    sender: impl Into<String>,
    pool_id: u64,
    lp_amount: impl Into<String>,
    min_amount_a: impl Into<String>,
    min_amount_b: impl Into<String>,
) -> pb::MsgRemoveLiquidity {
    pb::MsgRemoveLiquidity {
        sender: sender.into(),
        pool_id,
        lp_amount: lp_amount.into(),
        min_amount_a: min_amount_a.into(),
        min_amount_b: min_amount_b.into(),
    }
}

/// Builds `MsgRemoveLiquidity` packed into an `Any`.
pub fn remove_liquidity_any(
    sender: impl Into<String>,
    pool_id: u64,
    lp_amount: impl Into<String>,
    min_amount_a: impl Into<String>,
    min_amount_b: impl Into<String>,
) -> Any {
    to_any(
        &remove_liquidity(sender, pool_id, lp_amount, min_amount_a, min_amount_b),
        REMOVE_LIQUIDITY,
    )
}

/// Builds `MsgSwapExactIn`.
pub fn swap_exact_in(
    sender: impl Into<String>,
    pool_id: u64,
    token_in: Coin,
    denom_out: impl Into<String>,
    min_out: impl Into<String>,
) -> pb::MsgSwapExactIn {
    pb::MsgSwapExactIn {
        sender: sender.into(),
        pool_id,
        token_in: Some(token_in),
        denom_out: denom_out.into(),
        min_out: min_out.into(),
    }
}

/// Builds `MsgSwapExactIn` packed into an `Any`.
pub fn swap_exact_in_any(
    sender: impl Into<String>,
    pool_id: u64,
    token_in: Coin,
    denom_out: impl Into<String>,
    min_out: impl Into<String>,
) -> Any {
    to_any(
        &swap_exact_in(sender, pool_id, token_in, denom_out, min_out),
        SWAP_EXACT_IN,
    )
}

/// Builds `MsgSwapExactOut`.
pub fn swap_exact_out(
    sender: impl Into<String>,
    pool_id: u64,
    denom_in: impl Into<String>,
    token_out: Coin,
    max_in: impl Into<String>,
) -> pb::MsgSwapExactOut {
    pb::MsgSwapExactOut {
        sender: sender.into(),
        pool_id,
        denom_in: denom_in.into(),
        token_out: Some(token_out),
        max_in: max_in.into(),
    }
}

/// Builds `MsgSwapExactOut` packed into an `Any`.
pub fn swap_exact_out_any(
    sender: impl Into<String>,
    pool_id: u64,
    denom_in: impl Into<String>,
    token_out: Coin,
    max_in: impl Into<String>,
) -> Any {
    to_any(
        &swap_exact_out(sender, pool_id, denom_in, token_out, max_in),
        SWAP_EXACT_OUT,
    )
}

/// Builds `MsgPausePool`.
pub fn pause_pool(
    authority: impl Into<String>,
    pool_id: u64,
    reason: impl Into<String>,
) -> pb::MsgPausePool {
    pb::MsgPausePool {
        authority: authority.into(),
        pool_id,
        reason: reason.into(),
    }
}

/// Builds `MsgPausePool` packed into an `Any`.
pub fn pause_pool_any(
    authority: impl Into<String>,
    pool_id: u64,
    reason: impl Into<String>,
) -> Any {
    to_any(&pause_pool(authority, pool_id, reason), PAUSE_POOL)
}

/// Builds `MsgResumePool`.
pub fn resume_pool(authority: impl Into<String>, pool_id: u64) -> pb::MsgResumePool {
    pb::MsgResumePool {
        authority: authority.into(),
        pool_id,
    }
}

/// Builds `MsgResumePool` packed into an `Any`.
pub fn resume_pool_any(authority: impl Into<String>, pool_id: u64) -> Any {
    to_any(&resume_pool(authority, pool_id), RESUME_POOL)
}
