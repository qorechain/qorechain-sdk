//! `qorechain.rdk.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::rdk::v1 as pb;
use cosmrs::Any;

/// `/qorechain.rdk.v1.MsgCreateRollup` type URL.
pub const CREATE_ROLLUP: &str = "/qorechain.rdk.v1.MsgCreateRollup";
/// `/qorechain.rdk.v1.MsgSubmitBatch` type URL.
pub const SUBMIT_BATCH: &str = "/qorechain.rdk.v1.MsgSubmitBatch";
/// `/qorechain.rdk.v1.MsgChallengeBatch` type URL.
pub const CHALLENGE_BATCH: &str = "/qorechain.rdk.v1.MsgChallengeBatch";
/// `/qorechain.rdk.v1.MsgResolveChallenge` type URL.
pub const RESOLVE_CHALLENGE: &str = "/qorechain.rdk.v1.MsgResolveChallenge";
/// `/qorechain.rdk.v1.MsgPauseRollup` type URL.
pub const PAUSE_ROLLUP: &str = "/qorechain.rdk.v1.MsgPauseRollup";
/// `/qorechain.rdk.v1.MsgResumeRollup` type URL.
pub const RESUME_ROLLUP: &str = "/qorechain.rdk.v1.MsgResumeRollup";
/// `/qorechain.rdk.v1.MsgStopRollup` type URL.
pub const STOP_ROLLUP: &str = "/qorechain.rdk.v1.MsgStopRollup";
/// `/qorechain.rdk.v1.MsgExecuteWithdrawal` type URL.
pub const EXECUTE_WITHDRAWAL: &str = "/qorechain.rdk.v1.MsgExecuteWithdrawal";

/// Builds `MsgCreateRollup`.
pub fn create_rollup(
    creator: impl Into<String>,
    rollup_id: impl Into<String>,
    profile: impl Into<String>,
    vm_type: impl Into<String>,
    stake_amount: i64,
) -> pb::MsgCreateRollup {
    pb::MsgCreateRollup {
        creator: creator.into(),
        rollup_id: rollup_id.into(),
        profile: profile.into(),
        vm_type: vm_type.into(),
        stake_amount,
    }
}

/// Builds `MsgCreateRollup` packed into an `Any`.
pub fn create_rollup_any(
    creator: impl Into<String>,
    rollup_id: impl Into<String>,
    profile: impl Into<String>,
    vm_type: impl Into<String>,
    stake_amount: i64,
) -> Any {
    to_any(
        &create_rollup(creator, rollup_id, profile, vm_type, stake_amount),
        CREATE_ROLLUP,
    )
}

/// Builds `MsgSubmitBatch`.
///
/// `withdrawals_root` commits the L2->L1 messages (withdrawals) in this batch as
/// a binary Merkle root; pass an empty `Vec` when the batch carries no
/// cross-layer messages.
#[allow(clippy::too_many_arguments)]
pub fn submit_batch(
    sequencer: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    state_root: Vec<u8>,
    prev_state_root: Vec<u8>,
    tx_count: u64,
    data_hash: Vec<u8>,
    proof: Vec<u8>,
    withdrawals_root: Vec<u8>,
) -> pb::MsgSubmitBatch {
    pb::MsgSubmitBatch {
        sequencer: sequencer.into(),
        rollup_id: rollup_id.into(),
        batch_index,
        state_root,
        prev_state_root,
        tx_count,
        data_hash,
        proof,
        withdrawals_root,
    }
}

/// Builds `MsgSubmitBatch` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn submit_batch_any(
    sequencer: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    state_root: Vec<u8>,
    prev_state_root: Vec<u8>,
    tx_count: u64,
    data_hash: Vec<u8>,
    proof: Vec<u8>,
    withdrawals_root: Vec<u8>,
) -> Any {
    to_any(
        &submit_batch(
            sequencer,
            rollup_id,
            batch_index,
            state_root,
            prev_state_root,
            tx_count,
            data_hash,
            proof,
            withdrawals_root,
        ),
        SUBMIT_BATCH,
    )
}

/// Builds `MsgChallengeBatch`.
pub fn challenge_batch(
    challenger: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    proof: Vec<u8>,
) -> pb::MsgChallengeBatch {
    pb::MsgChallengeBatch {
        challenger: challenger.into(),
        rollup_id: rollup_id.into(),
        batch_index,
        proof,
    }
}

/// Builds `MsgChallengeBatch` packed into an `Any`.
pub fn challenge_batch_any(
    challenger: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    proof: Vec<u8>,
) -> Any {
    to_any(
        &challenge_batch(challenger, rollup_id, batch_index, proof),
        CHALLENGE_BATCH,
    )
}

/// Builds `MsgResolveChallenge`.
pub fn resolve_challenge(
    resolver: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    fraud_upheld: bool,
) -> pb::MsgResolveChallenge {
    pb::MsgResolveChallenge {
        resolver: resolver.into(),
        rollup_id: rollup_id.into(),
        batch_index,
        fraud_upheld,
    }
}

/// Builds `MsgResolveChallenge` packed into an `Any`.
pub fn resolve_challenge_any(
    resolver: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    fraud_upheld: bool,
) -> Any {
    to_any(
        &resolve_challenge(resolver, rollup_id, batch_index, fraud_upheld),
        RESOLVE_CHALLENGE,
    )
}

/// Builds `MsgPauseRollup`.
pub fn pause_rollup(
    creator: impl Into<String>,
    rollup_id: impl Into<String>,
    reason: impl Into<String>,
) -> pb::MsgPauseRollup {
    pb::MsgPauseRollup {
        creator: creator.into(),
        rollup_id: rollup_id.into(),
        reason: reason.into(),
    }
}

/// Builds `MsgPauseRollup` packed into an `Any`.
pub fn pause_rollup_any(
    creator: impl Into<String>,
    rollup_id: impl Into<String>,
    reason: impl Into<String>,
) -> Any {
    to_any(&pause_rollup(creator, rollup_id, reason), PAUSE_ROLLUP)
}

/// Builds `MsgResumeRollup`.
pub fn resume_rollup(
    creator: impl Into<String>,
    rollup_id: impl Into<String>,
) -> pb::MsgResumeRollup {
    pb::MsgResumeRollup {
        creator: creator.into(),
        rollup_id: rollup_id.into(),
    }
}

/// Builds `MsgResumeRollup` packed into an `Any`.
pub fn resume_rollup_any(creator: impl Into<String>, rollup_id: impl Into<String>) -> Any {
    to_any(&resume_rollup(creator, rollup_id), RESUME_ROLLUP)
}

/// Builds `MsgStopRollup`.
pub fn stop_rollup(creator: impl Into<String>, rollup_id: impl Into<String>) -> pb::MsgStopRollup {
    pb::MsgStopRollup {
        creator: creator.into(),
        rollup_id: rollup_id.into(),
    }
}

/// Builds `MsgStopRollup` packed into an `Any`.
pub fn stop_rollup_any(creator: impl Into<String>, rollup_id: impl Into<String>) -> Any {
    to_any(&stop_rollup(creator, rollup_id), STOP_ROLLUP)
}

/// Builds `MsgExecuteWithdrawal`.
///
/// Finalizes an L2->L1 withdrawal by proving the leaf is committed in a
/// finalized batch's `withdrawals_root`. `proof` is the binary-Merkle sibling
/// hash list from the leaf up to the root.
#[allow(clippy::too_many_arguments)]
pub fn execute_withdrawal(
    submitter: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    withdrawal_index: u64,
    recipient: impl Into<String>,
    denom: impl Into<String>,
    amount: i64,
    proof: Vec<Vec<u8>>,
) -> pb::MsgExecuteWithdrawal {
    pb::MsgExecuteWithdrawal {
        submitter: submitter.into(),
        rollup_id: rollup_id.into(),
        batch_index,
        withdrawal_index,
        recipient: recipient.into(),
        denom: denom.into(),
        amount,
        proof,
    }
}

/// Builds `MsgExecuteWithdrawal` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn execute_withdrawal_any(
    submitter: impl Into<String>,
    rollup_id: impl Into<String>,
    batch_index: u64,
    withdrawal_index: u64,
    recipient: impl Into<String>,
    denom: impl Into<String>,
    amount: i64,
    proof: Vec<Vec<u8>>,
) -> Any {
    to_any(
        &execute_withdrawal(
            submitter,
            rollup_id,
            batch_index,
            withdrawal_index,
            recipient,
            denom,
            amount,
            proof,
        ),
        EXECUTE_WITHDRAWAL,
    )
}
