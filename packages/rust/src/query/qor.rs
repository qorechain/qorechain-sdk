//! Typed client for the QoreChain `qor_*` JSON-RPC namespace.

use crate::error::Result;
use crate::query::JsonRpcClient;
use serde_json::{json, Value};

/// The authoritative list of `(rust_method_name, wire_method_name)` pairs for
/// the QoreChain `qor_*` JSON-RPC namespace. The wire names use the chain's
/// exact casing and must not be altered.
pub const QOR_METHODS: &[(&str, &str)] = &[
    ("get_pqc_key_status", "qor_getPQCKeyStatus"),
    ("get_hybrid_signature_mode", "qor_getHybridSignatureMode"),
    ("get_ai_stats", "qor_getAIStats"),
    ("get_cross_vm_message", "qor_getCrossVMMessage"),
    ("get_reputation_score", "qor_getReputationScore"),
    ("get_layer_info", "qor_getLayerInfo"),
    ("get_bridge_status", "qor_getBridgeStatus"),
    ("get_rl_agent_status", "qor_getRLAgentStatus"),
    ("get_rl_observation", "qor_getRLObservation"),
    ("get_rl_reward", "qor_getRLReward"),
    ("get_pool_classification", "qor_getPoolClassification"),
    ("get_burn_stats", "qor_getBurnStats"),
    ("get_xqore_position", "qor_getXQOREPosition"),
    ("get_inflation_rate", "qor_getInflationRate"),
    ("get_tokenomics_overview", "qor_getTokenomicsOverview"),
    ("get_rollup_status", "qor_getRollupStatus"),
    ("list_rollups", "qor_listRollups"),
    ("get_settlement_batch", "qor_getSettlementBatch"),
    ("suggest_rollup_profile", "qor_suggestRollupProfile"),
    ("get_da_blob_status", "qor_getDABlobStatus"),
    ("get_btc_staking_position", "qor_getBTCStakingPosition"),
    ("get_abstract_account", "qor_getAbstractAccount"),
    ("get_fair_block_status", "qor_getFairBlockStatus"),
    ("get_gas_abstraction_config", "qor_getGasAbstractionConfig"),
    ("get_lane_configuration", "qor_getLaneConfiguration"),
];

/// A typed client for the QoreChain `qor_*` JSON-RPC namespace. Point it at the
/// network's EVM JSON-RPC endpoint.
#[derive(Debug, Clone)]
pub struct QorClient {
    rpc: JsonRpcClient,
}

impl QorClient {
    /// Creates a `QorClient` targeting the given (EVM JSON-RPC) URL using a fresh
    /// HTTP client.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            rpc: JsonRpcClient::new(url),
        }
    }

    /// Creates a `QorClient` from an existing JSON-RPC client.
    pub fn from_jsonrpc(rpc: JsonRpcClient) -> Self {
        Self { rpc }
    }

    /// Access the underlying JSON-RPC transport.
    pub fn rpc(&self) -> &JsonRpcClient {
        &self.rpc
    }

    // --- PQC / signatures ---

    /// `qor_getPQCKeyStatus`
    pub async fn get_pqc_key_status(&self, address: &str) -> Result<Value> {
        self.rpc.call("qor_getPQCKeyStatus", json!([address])).await
    }

    /// `qor_getHybridSignatureMode`
    pub async fn get_hybrid_signature_mode(&self) -> Result<Value> {
        self.rpc.call("qor_getHybridSignatureMode", json!([])).await
    }

    // --- AI engine ---

    /// `qor_getAIStats`
    pub async fn get_ai_stats(&self) -> Result<Value> {
        self.rpc.call("qor_getAIStats", json!([])).await
    }

    // --- Cross-VM ---

    /// `qor_getCrossVMMessage`
    pub async fn get_cross_vm_message(&self, message_id: &str) -> Result<Value> {
        self.rpc
            .call("qor_getCrossVMMessage", json!([message_id]))
            .await
    }

    // --- Reputation / pools ---

    /// `qor_getReputationScore`
    pub async fn get_reputation_score(&self, validator: &str) -> Result<Value> {
        self.rpc
            .call("qor_getReputationScore", json!([validator]))
            .await
    }

    /// `qor_getPoolClassification`
    pub async fn get_pool_classification(&self, validator: &str) -> Result<Value> {
        self.rpc
            .call("qor_getPoolClassification", json!([validator]))
            .await
    }

    // --- Layers / bridge ---

    /// `qor_getLayerInfo`
    pub async fn get_layer_info(&self, layer_id: &str) -> Result<Value> {
        self.rpc.call("qor_getLayerInfo", json!([layer_id])).await
    }

    /// `qor_getBridgeStatus`
    pub async fn get_bridge_status(&self, chain_id: &str) -> Result<Value> {
        self.rpc
            .call("qor_getBridgeStatus", json!([chain_id]))
            .await
    }

    // --- Reinforcement learning ---

    /// `qor_getRLAgentStatus`
    pub async fn get_rl_agent_status(&self) -> Result<Value> {
        self.rpc.call("qor_getRLAgentStatus", json!([])).await
    }

    /// `qor_getRLObservation`
    pub async fn get_rl_observation(&self) -> Result<Value> {
        self.rpc.call("qor_getRLObservation", json!([])).await
    }

    /// `qor_getRLReward`
    pub async fn get_rl_reward(&self) -> Result<Value> {
        self.rpc.call("qor_getRLReward", json!([])).await
    }

    // --- Tokenomics ---

    /// `qor_getBurnStats`
    pub async fn get_burn_stats(&self) -> Result<Value> {
        self.rpc.call("qor_getBurnStats", json!([])).await
    }

    /// `qor_getXQOREPosition`
    pub async fn get_xqore_position(&self, address: &str) -> Result<Value> {
        self.rpc
            .call("qor_getXQOREPosition", json!([address]))
            .await
    }

    /// `qor_getInflationRate`
    pub async fn get_inflation_rate(&self) -> Result<Value> {
        self.rpc.call("qor_getInflationRate", json!([])).await
    }

    /// `qor_getTokenomicsOverview`
    pub async fn get_tokenomics_overview(&self) -> Result<Value> {
        self.rpc.call("qor_getTokenomicsOverview", json!([])).await
    }

    // --- Rollups / DA / settlement ---

    /// `qor_getRollupStatus`
    pub async fn get_rollup_status(&self, rollup_id: &str) -> Result<Value> {
        self.rpc
            .call("qor_getRollupStatus", json!([rollup_id]))
            .await
    }

    /// `qor_listRollups`
    pub async fn list_rollups(&self) -> Result<Value> {
        self.rpc.call("qor_listRollups", json!([])).await
    }

    /// `qor_getSettlementBatch`
    pub async fn get_settlement_batch(&self, rollup_id: &str, batch_index: u64) -> Result<Value> {
        self.rpc
            .call("qor_getSettlementBatch", json!([rollup_id, batch_index]))
            .await
    }

    /// `qor_suggestRollupProfile`
    pub async fn suggest_rollup_profile(&self, use_case: &str) -> Result<Value> {
        self.rpc
            .call("qor_suggestRollupProfile", json!([use_case]))
            .await
    }

    /// `qor_getDABlobStatus`
    pub async fn get_da_blob_status(&self, rollup_id: &str, blob_index: u64) -> Result<Value> {
        self.rpc
            .call("qor_getDABlobStatus", json!([rollup_id, blob_index]))
            .await
    }

    // --- BTC staking / accounts ---

    /// `qor_getBTCStakingPosition`
    pub async fn get_btc_staking_position(&self, address: &str) -> Result<Value> {
        self.rpc
            .call("qor_getBTCStakingPosition", json!([address]))
            .await
    }

    /// `qor_getAbstractAccount`
    pub async fn get_abstract_account(&self, address: &str) -> Result<Value> {
        self.rpc
            .call("qor_getAbstractAccount", json!([address]))
            .await
    }

    // --- Ordering / gas / lanes ---

    /// `qor_getFairBlockStatus`
    pub async fn get_fair_block_status(&self) -> Result<Value> {
        self.rpc.call("qor_getFairBlockStatus", json!([])).await
    }

    /// `qor_getGasAbstractionConfig`
    pub async fn get_gas_abstraction_config(&self) -> Result<Value> {
        self.rpc
            .call("qor_getGasAbstractionConfig", json!([]))
            .await
    }

    /// `qor_getLaneConfiguration`
    pub async fn get_lane_configuration(&self) -> Result<Value> {
        self.rpc.call("qor_getLaneConfiguration", json!([])).await
    }
}
