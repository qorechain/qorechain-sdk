//! `qorechain.multilayer.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::multilayer::v1 as pb;
use cosmrs::Any;

/// `/qorechain.multilayer.v1.MsgRegisterSidechain` type URL.
pub const REGISTER_SIDECHAIN: &str = "/qorechain.multilayer.v1.MsgRegisterSidechain";
/// `/qorechain.multilayer.v1.MsgRegisterPaychain` type URL.
pub const REGISTER_PAYCHAIN: &str = "/qorechain.multilayer.v1.MsgRegisterPaychain";
/// `/qorechain.multilayer.v1.MsgAnchorState` type URL.
pub const ANCHOR_STATE: &str = "/qorechain.multilayer.v1.MsgAnchorState";
/// `/qorechain.multilayer.v1.MsgRouteTransaction` type URL.
pub const ROUTE_TRANSACTION: &str = "/qorechain.multilayer.v1.MsgRouteTransaction";
/// `/qorechain.multilayer.v1.MsgUpdateLayerStatus` type URL.
pub const UPDATE_LAYER_STATUS: &str = "/qorechain.multilayer.v1.MsgUpdateLayerStatus";
/// `/qorechain.multilayer.v1.MsgChallengeAnchor` type URL.
pub const CHALLENGE_ANCHOR: &str = "/qorechain.multilayer.v1.MsgChallengeAnchor";

/// Builds `MsgRegisterSidechain`.
#[allow(clippy::too_many_arguments)]
pub fn register_sidechain(
    creator: impl Into<String>,
    layer_id: impl Into<String>,
    description: impl Into<String>,
    target_block_time_ms: u64,
    max_transactions_per_block: u64,
    min_validators: u32,
    settlement_interval_blocks: u64,
    supported_vm_types: Vec<String>,
    supported_domains: Vec<String>,
) -> pb::MsgRegisterSidechain {
    pb::MsgRegisterSidechain {
        creator: creator.into(),
        layer_id: layer_id.into(),
        description: description.into(),
        target_block_time_ms,
        max_transactions_per_block,
        min_validators,
        settlement_interval_blocks,
        supported_vm_types,
        supported_domains,
    }
}

/// Builds `MsgRegisterSidechain` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn register_sidechain_any(
    creator: impl Into<String>,
    layer_id: impl Into<String>,
    description: impl Into<String>,
    target_block_time_ms: u64,
    max_transactions_per_block: u64,
    min_validators: u32,
    settlement_interval_blocks: u64,
    supported_vm_types: Vec<String>,
    supported_domains: Vec<String>,
) -> Any {
    to_any(
        &register_sidechain(
            creator,
            layer_id,
            description,
            target_block_time_ms,
            max_transactions_per_block,
            min_validators,
            settlement_interval_blocks,
            supported_vm_types,
            supported_domains,
        ),
        REGISTER_SIDECHAIN,
    )
}

/// Builds `MsgRegisterPaychain`.
pub fn register_paychain(
    creator: impl Into<String>,
    layer_id: impl Into<String>,
    description: impl Into<String>,
    max_transactions_per_block: u64,
    settlement_interval_blocks: u64,
    base_fee_multiplier: impl Into<String>,
) -> pb::MsgRegisterPaychain {
    pb::MsgRegisterPaychain {
        creator: creator.into(),
        layer_id: layer_id.into(),
        description: description.into(),
        max_transactions_per_block,
        settlement_interval_blocks,
        base_fee_multiplier: base_fee_multiplier.into(),
    }
}

/// Builds `MsgRegisterPaychain` packed into an `Any`.
pub fn register_paychain_any(
    creator: impl Into<String>,
    layer_id: impl Into<String>,
    description: impl Into<String>,
    max_transactions_per_block: u64,
    settlement_interval_blocks: u64,
    base_fee_multiplier: impl Into<String>,
) -> Any {
    to_any(
        &register_paychain(
            creator,
            layer_id,
            description,
            max_transactions_per_block,
            settlement_interval_blocks,
            base_fee_multiplier,
        ),
        REGISTER_PAYCHAIN,
    )
}

/// Builds `MsgAnchorState`.
#[allow(clippy::too_many_arguments)]
pub fn anchor_state(
    relayer: impl Into<String>,
    layer_id: impl Into<String>,
    layer_height: u64,
    state_root: Vec<u8>,
    validator_set_hash: Vec<u8>,
    pqc_aggregate_signature: Vec<u8>,
    transaction_count: u64,
    compressed_state_proof: Vec<u8>,
) -> pb::MsgAnchorState {
    pb::MsgAnchorState {
        relayer: relayer.into(),
        layer_id: layer_id.into(),
        layer_height,
        state_root,
        validator_set_hash,
        pqc_aggregate_signature,
        transaction_count,
        compressed_state_proof,
    }
}

/// Builds `MsgAnchorState` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn anchor_state_any(
    relayer: impl Into<String>,
    layer_id: impl Into<String>,
    layer_height: u64,
    state_root: Vec<u8>,
    validator_set_hash: Vec<u8>,
    pqc_aggregate_signature: Vec<u8>,
    transaction_count: u64,
    compressed_state_proof: Vec<u8>,
) -> Any {
    to_any(
        &anchor_state(
            relayer,
            layer_id,
            layer_height,
            state_root,
            validator_set_hash,
            pqc_aggregate_signature,
            transaction_count,
            compressed_state_proof,
        ),
        ANCHOR_STATE,
    )
}

/// Builds `MsgRouteTransaction`.
pub fn route_transaction(
    sender: impl Into<String>,
    transaction_payload: Vec<u8>,
    preferred_layer: impl Into<String>,
    max_latency_ms: u64,
    max_fee: impl Into<String>,
) -> pb::MsgRouteTransaction {
    pb::MsgRouteTransaction {
        sender: sender.into(),
        transaction_payload,
        preferred_layer: preferred_layer.into(),
        max_latency_ms,
        max_fee: max_fee.into(),
    }
}

/// Builds `MsgRouteTransaction` packed into an `Any`.
pub fn route_transaction_any(
    sender: impl Into<String>,
    transaction_payload: Vec<u8>,
    preferred_layer: impl Into<String>,
    max_latency_ms: u64,
    max_fee: impl Into<String>,
) -> Any {
    to_any(
        &route_transaction(
            sender,
            transaction_payload,
            preferred_layer,
            max_latency_ms,
            max_fee,
        ),
        ROUTE_TRANSACTION,
    )
}

/// Builds `MsgUpdateLayerStatus`.
pub fn update_layer_status(
    authority: impl Into<String>,
    layer_id: impl Into<String>,
    new_status: impl Into<String>,
    reason: impl Into<String>,
) -> pb::MsgUpdateLayerStatus {
    pb::MsgUpdateLayerStatus {
        authority: authority.into(),
        layer_id: layer_id.into(),
        new_status: new_status.into(),
        reason: reason.into(),
    }
}

/// Builds `MsgUpdateLayerStatus` packed into an `Any`.
pub fn update_layer_status_any(
    authority: impl Into<String>,
    layer_id: impl Into<String>,
    new_status: impl Into<String>,
    reason: impl Into<String>,
) -> Any {
    to_any(
        &update_layer_status(authority, layer_id, new_status, reason),
        UPDATE_LAYER_STATUS,
    )
}

/// Builds `MsgChallengeAnchor`.
pub fn challenge_anchor(
    challenger: impl Into<String>,
    layer_id: impl Into<String>,
    anchor_height: u64,
    fraud_proof: Vec<u8>,
    challenge_reason: impl Into<String>,
) -> pb::MsgChallengeAnchor {
    pb::MsgChallengeAnchor {
        challenger: challenger.into(),
        layer_id: layer_id.into(),
        anchor_height,
        fraud_proof,
        challenge_reason: challenge_reason.into(),
    }
}

/// Builds `MsgChallengeAnchor` packed into an `Any`.
pub fn challenge_anchor_any(
    challenger: impl Into<String>,
    layer_id: impl Into<String>,
    anchor_height: u64,
    fraud_proof: Vec<u8>,
    challenge_reason: impl Into<String>,
) -> Any {
    to_any(
        &challenge_anchor(
            challenger,
            layer_id,
            anchor_height,
            fraud_proof,
            challenge_reason,
        ),
        CHALLENGE_ANCHOR,
    )
}
