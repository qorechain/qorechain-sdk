//! `qorechain.bridge.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::bridge::v1 as pb;
use cosmrs::Any;

/// `/qorechain.bridge.v1.MsgBridgeDeposit` type URL.
pub const BRIDGE_DEPOSIT: &str = "/qorechain.bridge.v1.MsgBridgeDeposit";
/// `/qorechain.bridge.v1.MsgBridgeWithdraw` type URL.
pub const BRIDGE_WITHDRAW: &str = "/qorechain.bridge.v1.MsgBridgeWithdraw";
/// `/qorechain.bridge.v1.MsgRegisterBridgeValidator` type URL.
pub const REGISTER_BRIDGE_VALIDATOR: &str = "/qorechain.bridge.v1.MsgRegisterBridgeValidator";
/// `/qorechain.bridge.v1.MsgBridgeAttestation` type URL.
pub const BRIDGE_ATTESTATION: &str = "/qorechain.bridge.v1.MsgBridgeAttestation";
/// `/qorechain.bridge.v1.MsgUpdateEthLightClient` type URL.
pub const UPDATE_ETH_LIGHT_CLIENT: &str = "/qorechain.bridge.v1.MsgUpdateEthLightClient";
/// `/qorechain.bridge.v1.MsgUpdateChainConfig` type URL.
pub const UPDATE_CHAIN_CONFIG: &str = "/qorechain.bridge.v1.MsgUpdateChainConfig";
/// `/qorechain.bridge.v1.MsgSetVerifierBootstrap` type URL.
pub const SET_VERIFIER_BOOTSTRAP: &str = "/qorechain.bridge.v1.MsgSetVerifierBootstrap";

// Re-export the verifier bootstrap sub-message types so callers can build a
// `MsgSetVerifierBootstrap` without reaching into the generated `proto` module.
pub use pb::{BitcoinCheckpoint, ValidatorQuorum, WormholeGuardianSet};

/// Builds `MsgBridgeDeposit`.
#[allow(clippy::too_many_arguments)]
pub fn bridge_deposit(
    sender: impl Into<String>,
    source_chain: impl Into<String>,
    source_tx_hash: impl Into<String>,
    asset: impl Into<String>,
    amount: impl Into<String>,
    bridge_validator_sigs: Vec<u8>,
    pqc_commitment: Vec<u8>,
) -> pb::MsgBridgeDeposit {
    pb::MsgBridgeDeposit {
        sender: sender.into(),
        source_chain: source_chain.into(),
        source_tx_hash: source_tx_hash.into(),
        asset: asset.into(),
        amount: amount.into(),
        bridge_validator_sigs,
        pqc_commitment,
    }
}

/// Builds `MsgBridgeDeposit` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn bridge_deposit_any(
    sender: impl Into<String>,
    source_chain: impl Into<String>,
    source_tx_hash: impl Into<String>,
    asset: impl Into<String>,
    amount: impl Into<String>,
    bridge_validator_sigs: Vec<u8>,
    pqc_commitment: Vec<u8>,
) -> Any {
    to_any(
        &bridge_deposit(
            sender,
            source_chain,
            source_tx_hash,
            asset,
            amount,
            bridge_validator_sigs,
            pqc_commitment,
        ),
        BRIDGE_DEPOSIT,
    )
}

/// Builds `MsgBridgeWithdraw`.
pub fn bridge_withdraw(
    sender: impl Into<String>,
    destination_chain: impl Into<String>,
    destination_address: impl Into<String>,
    asset: impl Into<String>,
    amount: impl Into<String>,
) -> pb::MsgBridgeWithdraw {
    pb::MsgBridgeWithdraw {
        sender: sender.into(),
        destination_chain: destination_chain.into(),
        destination_address: destination_address.into(),
        asset: asset.into(),
        amount: amount.into(),
    }
}

/// Builds `MsgBridgeWithdraw` packed into an `Any`.
pub fn bridge_withdraw_any(
    sender: impl Into<String>,
    destination_chain: impl Into<String>,
    destination_address: impl Into<String>,
    asset: impl Into<String>,
    amount: impl Into<String>,
) -> Any {
    to_any(
        &bridge_withdraw(
            sender,
            destination_chain,
            destination_address,
            asset,
            amount,
        ),
        BRIDGE_WITHDRAW,
    )
}

/// Builds `MsgRegisterBridgeValidator`.
pub fn register_bridge_validator(
    validator_address: impl Into<String>,
    pqc_pubkey: Vec<u8>,
    supported_chains: Vec<String>,
) -> pb::MsgRegisterBridgeValidator {
    pb::MsgRegisterBridgeValidator {
        validator_address: validator_address.into(),
        pqc_pubkey,
        supported_chains,
    }
}

/// Builds `MsgRegisterBridgeValidator` packed into an `Any`.
pub fn register_bridge_validator_any(
    validator_address: impl Into<String>,
    pqc_pubkey: Vec<u8>,
    supported_chains: Vec<String>,
) -> Any {
    to_any(
        &register_bridge_validator(validator_address, pqc_pubkey, supported_chains),
        REGISTER_BRIDGE_VALIDATOR,
    )
}

/// Builds `MsgBridgeAttestation`.
#[allow(clippy::too_many_arguments)]
pub fn bridge_attestation(
    validator: impl Into<String>,
    chain: impl Into<String>,
    event_type: impl Into<String>,
    operation_id: impl Into<String>,
    tx_hash: impl Into<String>,
    amount: impl Into<String>,
    asset: impl Into<String>,
    proof: Vec<u8>,
    pqc_signature: Vec<u8>,
) -> pb::MsgBridgeAttestation {
    pb::MsgBridgeAttestation {
        validator: validator.into(),
        chain: chain.into(),
        event_type: event_type.into(),
        operation_id: operation_id.into(),
        tx_hash: tx_hash.into(),
        amount: amount.into(),
        asset: asset.into(),
        proof,
        pqc_signature,
    }
}

/// Builds `MsgBridgeAttestation` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn bridge_attestation_any(
    validator: impl Into<String>,
    chain: impl Into<String>,
    event_type: impl Into<String>,
    operation_id: impl Into<String>,
    tx_hash: impl Into<String>,
    amount: impl Into<String>,
    asset: impl Into<String>,
    proof: Vec<u8>,
    pqc_signature: Vec<u8>,
) -> Any {
    to_any(
        &bridge_attestation(
            validator,
            chain,
            event_type,
            operation_id,
            tx_hash,
            amount,
            asset,
            proof,
            pqc_signature,
        ),
        BRIDGE_ATTESTATION,
    )
}

/// Builds `MsgUpdateEthLightClient`.
///
/// `update` is the encoded Altair LightClientUpdate bundle verified against the
/// stored sync committee before advancing the on-chain light client.
pub fn update_eth_light_client(
    relayer: impl Into<String>,
    update: Vec<u8>,
) -> pb::MsgUpdateEthLightClient {
    pb::MsgUpdateEthLightClient {
        relayer: relayer.into(),
        update,
    }
}

/// Builds `MsgUpdateEthLightClient` packed into an `Any`.
pub fn update_eth_light_client_any(relayer: impl Into<String>, update: Vec<u8>) -> Any {
    to_any(
        &update_eth_light_client(relayer, update),
        UPDATE_ETH_LIGHT_CLIENT,
    )
}

/// Builds `MsgUpdateChainConfig`.
///
/// Empty-string / zero fields fall back to the existing config (merge semantics
/// in the handler), so a caller can flip just `status` plus one verifier flag to
/// activate a chain's bridge post-deploy.
#[allow(clippy::too_many_arguments)]
pub fn update_chain_config(
    admin: impl Into<String>,
    chain_id: impl Into<String>,
    bridge_contract: impl Into<String>,
    confirmations_required: u32,
    architecture: impl Into<String>,
    status: impl Into<String>,
    verifier: impl Into<String>,
    lock_event_sig: impl Into<String>,
) -> pb::MsgUpdateChainConfig {
    pb::MsgUpdateChainConfig {
        admin: admin.into(),
        chain_id: chain_id.into(),
        bridge_contract: bridge_contract.into(),
        confirmations_required,
        architecture: architecture.into(),
        status: status.into(),
        verifier: verifier.into(),
        lock_event_sig: lock_event_sig.into(),
    }
}

/// Builds `MsgUpdateChainConfig` packed into an `Any`.
#[allow(clippy::too_many_arguments)]
pub fn update_chain_config_any(
    admin: impl Into<String>,
    chain_id: impl Into<String>,
    bridge_contract: impl Into<String>,
    confirmations_required: u32,
    architecture: impl Into<String>,
    status: impl Into<String>,
    verifier: impl Into<String>,
    lock_event_sig: impl Into<String>,
) -> Any {
    to_any(
        &update_chain_config(
            admin,
            chain_id,
            bridge_contract,
            confirmations_required,
            architecture,
            status,
            verifier,
            lock_event_sig,
        ),
        UPDATE_CHAIN_CONFIG,
    )
}

/// Builds `MsgSetVerifierBootstrap`.
///
/// Installs a per-architecture trust root for a chain's trustless verifier.
/// Exactly one of the verifier sub-messages should be populated; the handler
/// routes by which is non-empty.
pub fn set_verifier_bootstrap(
    admin: impl Into<String>,
    chain_id: impl Into<String>,
    wormhole: Option<WormholeGuardianSet>,
    ed25519: Option<ValidatorQuorum>,
    bls: Option<ValidatorQuorum>,
    bitcoin: Option<BitcoinCheckpoint>,
    starknet_state_root: Vec<u8>,
) -> pb::MsgSetVerifierBootstrap {
    pb::MsgSetVerifierBootstrap {
        admin: admin.into(),
        chain_id: chain_id.into(),
        wormhole,
        ed25519,
        bls,
        bitcoin,
        starknet_state_root,
    }
}

/// Builds `MsgSetVerifierBootstrap` packed into an `Any`.
pub fn set_verifier_bootstrap_any(
    admin: impl Into<String>,
    chain_id: impl Into<String>,
    wormhole: Option<WormholeGuardianSet>,
    ed25519: Option<ValidatorQuorum>,
    bls: Option<ValidatorQuorum>,
    bitcoin: Option<BitcoinCheckpoint>,
    starknet_state_root: Vec<u8>,
) -> Any {
    to_any(
        &set_verifier_bootstrap(
            admin,
            chain_id,
            wormhole,
            ed25519,
            bls,
            bitcoin,
            starknet_state_root,
        ),
        SET_VERIFIER_BOOTSTRAP,
    )
}
