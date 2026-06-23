"""Typed wrappers for the QoreChain ``qor_*`` JSON-RPC namespace (sync + async).

Each method maps one-to-one to a chain RPC method, exposed against the EVM
JSON-RPC endpoint. The on-the-wire method names use the chain's exact casing
(e.g. ``qor_getPQCKeyStatus``, ``qor_getAIStats``) and must not be altered.

Results are returned untyped (the chain returns rich, evolving JSON the SDK does
not model). The sync and async clients share one authoritative mapping of
Python method name -> wire method name in :data:`QOR_METHODS`, so they can never
drift apart.
"""

from __future__ import annotations

from typing import Any

from .jsonrpc import AsyncJsonRpcClient, JsonRpcClient

#: Authoritative map of snake_case Python method name -> exact wire method name.
#: The sync and async clients are both generated from this single table.
QOR_METHODS: dict[str, str] = {
    "get_pqc_key_status": "qor_getPQCKeyStatus",
    "get_hybrid_signature_mode": "qor_getHybridSignatureMode",
    "get_ai_stats": "qor_getAIStats",
    "get_cross_vm_message": "qor_getCrossVMMessage",
    "get_reputation_score": "qor_getReputationScore",
    "get_layer_info": "qor_getLayerInfo",
    "get_bridge_status": "qor_getBridgeStatus",
    "get_rl_agent_status": "qor_getRLAgentStatus",
    "get_rl_observation": "qor_getRLObservation",
    "get_rl_reward": "qor_getRLReward",
    "get_pool_classification": "qor_getPoolClassification",
    "get_burn_stats": "qor_getBurnStats",
    "get_xqore_position": "qor_getXQOREPosition",
    "get_inflation_rate": "qor_getInflationRate",
    "get_tokenomics_overview": "qor_getTokenomicsOverview",
    "get_rollup_status": "qor_getRollupStatus",
    "list_rollups": "qor_listRollups",
    "get_settlement_batch": "qor_getSettlementBatch",
    "suggest_rollup_profile": "qor_suggestRollupProfile",
    "get_da_blob_status": "qor_getDABlobStatus",
    "get_btc_staking_position": "qor_getBTCStakingPosition",
    "get_abstract_account": "qor_getAbstractAccount",
    "get_fair_block_status": "qor_getFairBlockStatus",
    "get_gas_abstraction_config": "qor_getGasAbstractionConfig",
    "get_lane_configuration": "qor_getLaneConfiguration",
}


class QorClient(JsonRpcClient):
    """Synchronous client for the QoreChain ``qor_*`` JSON-RPC namespace.

    Point it at the network's ``evm_rpc`` endpoint.
    """

    # --- PQC / signatures ---
    def get_pqc_key_status(self, address: str) -> Any:
        return self.call("qor_getPQCKeyStatus", [address])

    def get_hybrid_signature_mode(self) -> Any:
        return self.call("qor_getHybridSignatureMode", [])

    # --- AI engine ---
    def get_ai_stats(self) -> Any:
        return self.call("qor_getAIStats", [])

    # --- Cross-VM ---
    def get_cross_vm_message(self, message_id: str) -> Any:
        return self.call("qor_getCrossVMMessage", [message_id])

    # --- Reputation / pools ---
    def get_reputation_score(self, validator: str) -> Any:
        return self.call("qor_getReputationScore", [validator])

    def get_pool_classification(self, validator: str) -> Any:
        return self.call("qor_getPoolClassification", [validator])

    # --- Layers / bridge ---
    def get_layer_info(self, layer_id: str) -> Any:
        return self.call("qor_getLayerInfo", [layer_id])

    def get_bridge_status(self, chain_id: str) -> Any:
        return self.call("qor_getBridgeStatus", [chain_id])

    # --- Reinforcement learning ---
    def get_rl_agent_status(self) -> Any:
        return self.call("qor_getRLAgentStatus", [])

    def get_rl_observation(self) -> Any:
        return self.call("qor_getRLObservation", [])

    def get_rl_reward(self) -> Any:
        return self.call("qor_getRLReward", [])

    # --- Tokenomics ---
    def get_burn_stats(self) -> Any:
        return self.call("qor_getBurnStats", [])

    def get_xqore_position(self, address: str) -> Any:
        return self.call("qor_getXQOREPosition", [address])

    def get_inflation_rate(self) -> Any:
        return self.call("qor_getInflationRate", [])

    def get_tokenomics_overview(self) -> Any:
        return self.call("qor_getTokenomicsOverview", [])

    # --- Rollups / DA / settlement ---
    def get_rollup_status(self, rollup_id: str) -> Any:
        return self.call("qor_getRollupStatus", [rollup_id])

    def list_rollups(self) -> Any:
        return self.call("qor_listRollups", [])

    def get_settlement_batch(self, rollup_id: str, batch_index: int) -> Any:
        return self.call("qor_getSettlementBatch", [rollup_id, batch_index])

    def suggest_rollup_profile(self, use_case: str) -> Any:
        return self.call("qor_suggestRollupProfile", [use_case])

    def get_da_blob_status(self, rollup_id: str, blob_index: int) -> Any:
        return self.call("qor_getDABlobStatus", [rollup_id, blob_index])

    # --- BTC staking / accounts ---
    def get_btc_staking_position(self, address: str) -> Any:
        return self.call("qor_getBTCStakingPosition", [address])

    def get_abstract_account(self, address: str) -> Any:
        return self.call("qor_getAbstractAccount", [address])

    # --- Ordering / gas / lanes ---
    def get_fair_block_status(self) -> Any:
        return self.call("qor_getFairBlockStatus", [])

    def get_gas_abstraction_config(self) -> Any:
        return self.call("qor_getGasAbstractionConfig", [])

    def get_lane_configuration(self) -> Any:
        return self.call("qor_getLaneConfiguration", [])


class AsyncQorClient(AsyncJsonRpcClient):
    """Asynchronous mirror of :class:`QorClient`."""

    async def get_pqc_key_status(self, address: str) -> Any:
        return await self.call("qor_getPQCKeyStatus", [address])

    async def get_hybrid_signature_mode(self) -> Any:
        return await self.call("qor_getHybridSignatureMode", [])

    async def get_ai_stats(self) -> Any:
        return await self.call("qor_getAIStats", [])

    async def get_cross_vm_message(self, message_id: str) -> Any:
        return await self.call("qor_getCrossVMMessage", [message_id])

    async def get_reputation_score(self, validator: str) -> Any:
        return await self.call("qor_getReputationScore", [validator])

    async def get_pool_classification(self, validator: str) -> Any:
        return await self.call("qor_getPoolClassification", [validator])

    async def get_layer_info(self, layer_id: str) -> Any:
        return await self.call("qor_getLayerInfo", [layer_id])

    async def get_bridge_status(self, chain_id: str) -> Any:
        return await self.call("qor_getBridgeStatus", [chain_id])

    async def get_rl_agent_status(self) -> Any:
        return await self.call("qor_getRLAgentStatus", [])

    async def get_rl_observation(self) -> Any:
        return await self.call("qor_getRLObservation", [])

    async def get_rl_reward(self) -> Any:
        return await self.call("qor_getRLReward", [])

    async def get_burn_stats(self) -> Any:
        return await self.call("qor_getBurnStats", [])

    async def get_xqore_position(self, address: str) -> Any:
        return await self.call("qor_getXQOREPosition", [address])

    async def get_inflation_rate(self) -> Any:
        return await self.call("qor_getInflationRate", [])

    async def get_tokenomics_overview(self) -> Any:
        return await self.call("qor_getTokenomicsOverview", [])

    async def get_rollup_status(self, rollup_id: str) -> Any:
        return await self.call("qor_getRollupStatus", [rollup_id])

    async def list_rollups(self) -> Any:
        return await self.call("qor_listRollups", [])

    async def get_settlement_batch(self, rollup_id: str, batch_index: int) -> Any:
        return await self.call("qor_getSettlementBatch", [rollup_id, batch_index])

    async def suggest_rollup_profile(self, use_case: str) -> Any:
        return await self.call("qor_suggestRollupProfile", [use_case])

    async def get_da_blob_status(self, rollup_id: str, blob_index: int) -> Any:
        return await self.call("qor_getDABlobStatus", [rollup_id, blob_index])

    async def get_btc_staking_position(self, address: str) -> Any:
        return await self.call("qor_getBTCStakingPosition", [address])

    async def get_abstract_account(self, address: str) -> Any:
        return await self.call("qor_getAbstractAccount", [address])

    async def get_fair_block_status(self) -> Any:
        return await self.call("qor_getFairBlockStatus", [])

    async def get_gas_abstraction_config(self) -> Any:
        return await self.call("qor_getGasAbstractionConfig", [])

    async def get_lane_configuration(self) -> Any:
        return await self.call("qor_getLaneConfiguration", [])
