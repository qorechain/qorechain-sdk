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
/// `/qorechain.rdk.v1.MsgUpdateParams` type URL (chain v3.2.5, governance only).
pub const UPDATE_PARAMS: &str = "/qorechain.rdk.v1.MsgUpdateParams";

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
        // Optional fields (v3.2.7 / v3.2.8) stay off the wire unless set on the
        // returned struct: a node below them refuses a message that sets them.
        verification_key: Vec::new(),
        sequencing: String::new(),
        execution_vm: String::new(),
        privacy: String::new(),
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
        // Optional anchoring (chain v3.2.2). Left empty, the batch settles
        // unanchored as before, and the empty fields stay off the wire, so a
        // node below v3.2.2 accepts the message. Set them on the returned
        // struct to anchor the batch in the same transaction.
        anchor_signature: Vec::new(),
        validator_set_hash: Vec::new(),
        // Based rollups only (v3.2.8): set on the returned struct; zero for
        // every other rollup and off the wire.
        inbox_end: 0,
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

crate::msg::crossvm::params_update! {
    /// Every field of rdk `MsgUpdateParams` except `authority` (chain v3.2.8
    /// shape, fields 2..14). The message replaces the parameters wholesale, so
    /// [`update_params`] requires each one to be given explicitly (`Some`).
    /// Build it from the chain with [`fetch_params_update`] /
    /// [`update_params_from_current`].
    RdkParamsUpdate {
        /// Field 2.
        max_rollups: u32,
        /// Field 3, uqor.
        min_stake_for_rollup: i64,
        /// Field 4, a decimal in `[0, 1)`.
        rollup_creation_burn_rate: String,
        /// Field 5, seconds.
        default_challenge_window: u64,
        /// Field 6.
        max_da_blob_size: u64,
        /// Field 7.
        blob_retention_blocks: u64,
        /// Field 8.
        max_batches_per_block: u32,
        /// Field 9 (0 = default).
        finalized_batch_retention_blocks: u64,
        /// Field 10 (0 = default).
        max_posted_data_bytes: u64,
        /// Field 11 (0 = default).
        max_posted_data_bytes_per_block: u64,
        /// Field 12 (0 = default), uqor per byte.
        posted_data_fee_per_byte: u64,
        /// Field 13 (0 = default).
        posted_data_retention_blocks: u64,
        /// Field 14 (0 = default), uqor.
        min_submitter_bond: u64,
    }
}

impl RdkParamsUpdate {
    /// Every field from a typed `Query/Params` view.
    pub fn from_view(v: &pb::ParamsView) -> Self {
        Self {
            max_rollups: Some(v.max_rollups),
            min_stake_for_rollup: Some(v.min_stake_for_rollup),
            rollup_creation_burn_rate: Some(v.rollup_creation_burn_rate.clone()),
            default_challenge_window: Some(v.default_challenge_window),
            max_da_blob_size: Some(v.max_da_blob_size),
            blob_retention_blocks: Some(v.blob_retention_blocks),
            max_batches_per_block: Some(v.max_batches_per_block),
            finalized_batch_retention_blocks: Some(v.finalized_batch_retention_blocks),
            max_posted_data_bytes: Some(v.max_posted_data_bytes),
            max_posted_data_bytes_per_block: Some(v.max_posted_data_bytes_per_block),
            posted_data_fee_per_byte: Some(v.posted_data_fee_per_byte),
            posted_data_retention_blocks: Some(v.posted_data_retention_blocks),
            min_submitter_bond: Some(v.min_submitter_bond),
        }
    }

    /// The fields of the REST `/qorechain/rdk/v1/params` JSON (the `params`
    /// object). A field the answer lacks stays `None`, which [`update_params`]
    /// then refuses (an older node).
    ///
    /// # Errors
    ///
    /// [`Error::InvalidResponse`](crate::Error::InvalidResponse) when a number
    /// does not parse.
    pub fn from_rest_json(body: &serde_json::Value) -> crate::Result<Self> {
        use crate::msg::json_num as n;
        let v = body.get("params").filter(|p| p.is_object()).unwrap_or(body);
        Ok(Self {
            max_rollups: n(v, "max_rollups")?,
            min_stake_for_rollup: n(v, "min_stake_for_rollup")?,
            rollup_creation_burn_rate: v
                .get("rollup_creation_burn_rate")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            default_challenge_window: n(v, "default_challenge_window")?,
            max_da_blob_size: n(v, "max_da_blob_size")?,
            blob_retention_blocks: n(v, "blob_retention_blocks")?,
            max_batches_per_block: n(v, "max_batches_per_block")?,
            finalized_batch_retention_blocks: n(v, "finalized_batch_retention_blocks")?,
            max_posted_data_bytes: n(v, "max_posted_data_bytes")?,
            max_posted_data_bytes_per_block: n(v, "max_posted_data_bytes_per_block")?,
            posted_data_fee_per_byte: n(v, "posted_data_fee_per_byte")?,
            posted_data_retention_blocks: n(v, "posted_data_retention_blocks")?,
            min_submitter_bond: n(v, "min_submitter_bond")?,
        })
    }
}

/// The REST path of the rdk parameters.
pub const PARAMS_PATH: &str = "/qorechain/rdk/v1/params";

/// Reads the rdk parameters over REST as a [`RdkParamsUpdate`].
///
/// # Errors
///
/// Transport / HTTP errors, or
/// [`Error::InvalidResponse`](crate::Error::InvalidResponse).
pub async fn fetch_params_update(
    rest: &crate::query::RestClient,
) -> crate::Result<RdkParamsUpdate> {
    RdkParamsUpdate::from_rest_json(&rest.get(PARAMS_PATH, &[]).await?)
}

/// The way to build an rdk params proposal: reads the current parameters
/// ([`fetch_params_update`]), applies the fields `changes` gives (`Some`) and
/// builds `MsgUpdateParams` with [`update_params`].
///
/// # Errors
///
/// As [`fetch_params_update`] and [`update_params`].
pub async fn update_params_from_current(
    rest: &crate::query::RestClient,
    authority: impl Into<String>,
    changes: &RdkParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let current = fetch_params_update(rest).await?;
    update_params(authority, &current.merged(changes))
}

/// Builds rdk `MsgUpdateParams` (chain v3.2.5; fields 9..14 from v3.2.8):
/// replace the rdk parameters wholesale. Governance only: `authority` is the
/// gov module account. Every field must be given (`Some`); build a proposal
/// with [`update_params_from_current`]. `default_challenge_window` is in
/// seconds; a new optimistic rollup takes its challenge window from it.
///
/// # Errors
///
/// [`Error::InvalidInput`](crate::Error::InvalidInput) when `authority` is
/// empty, fields are not given (named), `min_stake_for_rollup` is negative, or
/// `rollup_creation_burn_rate` is not a decimal in `[0, 1)`.
pub fn update_params(
    authority: impl Into<String>,
    params: &RdkParamsUpdate,
) -> crate::Result<pb::MsgUpdateParams> {
    let authority = authority.into();
    let bad = |m: String| crate::Error::InvalidInput(format!("rdk update_params: {m}"));
    if authority.is_empty() {
        return Err(bad("authority is required".into()));
    }
    let missing = params.missing();
    if !missing.is_empty() {
        return Err(bad(format!(
            "every field must be given (the message replaces all parameters); missing: {}. \
             Copy the current values with update_params_from_current",
            missing.join(", ")
        )));
    }
    let p = params.clone();
    let min_stake_for_rollup = p.min_stake_for_rollup.unwrap_or_default();
    if min_stake_for_rollup < 0 {
        return Err(bad("min_stake_for_rollup must not be negative".into()));
    }
    let burn = p.rollup_creation_burn_rate.unwrap_or_default();
    let rate = burn.trim();
    let (int, frac) = rate.split_once('.').unwrap_or((rate, ""));
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    let well_formed = !int.is_empty() && digits(int) && digits(frac);
    if !well_formed || int.bytes().any(|b| b != b'0') {
        return Err(bad(format!(
            "rollup_creation_burn_rate {burn:?} must be a decimal in [0, 1)"
        )));
    }
    Ok(pb::MsgUpdateParams {
        authority,
        max_rollups: p.max_rollups.unwrap_or_default(),
        min_stake_for_rollup,
        rollup_creation_burn_rate: burn,
        default_challenge_window: p.default_challenge_window.unwrap_or_default(),
        max_da_blob_size: p.max_da_blob_size.unwrap_or_default(),
        blob_retention_blocks: p.blob_retention_blocks.unwrap_or_default(),
        max_batches_per_block: p.max_batches_per_block.unwrap_or_default(),
        finalized_batch_retention_blocks: p.finalized_batch_retention_blocks.unwrap_or_default(),
        max_posted_data_bytes: p.max_posted_data_bytes.unwrap_or_default(),
        max_posted_data_bytes_per_block: p.max_posted_data_bytes_per_block.unwrap_or_default(),
        posted_data_fee_per_byte: p.posted_data_fee_per_byte.unwrap_or_default(),
        posted_data_retention_blocks: p.posted_data_retention_blocks.unwrap_or_default(),
        min_submitter_bond: p.min_submitter_bond.unwrap_or_default(),
    })
}

/// Builds rdk `MsgUpdateParams` packed into an `Any`.
///
/// # Errors
///
/// As [`update_params`].
pub fn update_params_any(
    authority: impl Into<String>,
    params: &RdkParamsUpdate,
) -> crate::Result<Any> {
    Ok(to_any(&update_params(authority, params)?, UPDATE_PARAMS))
}
