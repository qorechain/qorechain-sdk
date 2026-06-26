package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * Client for the QoreChain {@code qor_*} JSON-RPC namespace, exposed against the
 * EVM JSON-RPC endpoint ({@code endpoints.evmRpc}).
 *
 * <p>Each method maps one-to-one to a chain RPC method using the chain's exact
 * casing (e.g. {@code qor_getPQCKeyStatus}, {@code qor_getAIStats}). The wire
 * method names must not be altered.
 */
public final class QorClient extends JsonRpcClient {

    public QorClient(String url) {
        super(url);
    }

    public QorClient(String url, Http.Options options) {
        super(url, options);
    }

    /** {@code qor_getPQCKeyStatus} — PQC key registration status for an address. */
    public JsonNode getPqcKeyStatus(String address) {
        return call("qor_getPQCKeyStatus", List.of(address));
    }

    /** {@code qor_getHybridSignatureMode} — active hybrid-signature policy. */
    public JsonNode getHybridSignatureMode() {
        return call("qor_getHybridSignatureMode", List.of());
    }

    /** {@code qor_getAIStats} — QCAI engine statistics. */
    public JsonNode getAiStats() {
        return call("qor_getAIStats", List.of());
    }

    /** {@code qor_getCrossVMMessage} — a cross-VM message by id. */
    public JsonNode getCrossVmMessage(String messageId) {
        return call("qor_getCrossVMMessage", List.of(messageId));
    }

    /** {@code qor_getReputationScore} — reputation score for a validator. */
    public JsonNode getReputationScore(String validator) {
        return call("qor_getReputationScore", List.of(validator));
    }

    /** {@code qor_getLayerInfo} — info about a chain layer. */
    public JsonNode getLayerInfo(String layerId) {
        return call("qor_getLayerInfo", List.of(layerId));
    }

    /** {@code qor_getBridgeStatus} — bridge status for a remote chain id. */
    public JsonNode getBridgeStatus(String chainId) {
        return call("qor_getBridgeStatus", List.of(chainId));
    }

    /** {@code qor_getRLAgentStatus} — reinforcement-learning agent status. */
    public JsonNode getRlAgentStatus() {
        return call("qor_getRLAgentStatus", List.of());
    }

    /** {@code qor_getRLObservation} — latest RL observation vector. */
    public JsonNode getRlObservation() {
        return call("qor_getRLObservation", List.of());
    }

    /** {@code qor_getRLReward} — latest RL reward signal. */
    public JsonNode getRlReward() {
        return call("qor_getRLReward", List.of());
    }

    /** {@code qor_getPoolClassification} — validator pool classification. */
    public JsonNode getPoolClassification(String validator) {
        return call("qor_getPoolClassification", List.of(validator));
    }

    /** {@code qor_getBurnStats} — token burn statistics. */
    public JsonNode getBurnStats() {
        return call("qor_getBurnStats", List.of());
    }

    /** {@code qor_getXQOREPosition} — xQORE staking position for an address. */
    public JsonNode getXqorePosition(String address) {
        return call("qor_getXQOREPosition", List.of(address));
    }

    /** {@code qor_getInflationRate} — current inflation rate. */
    public JsonNode getInflationRate() {
        return call("qor_getInflationRate", List.of());
    }

    /** {@code qor_getTokenomicsOverview} — aggregate tokenomics snapshot. */
    public JsonNode getTokenomicsOverview() {
        return call("qor_getTokenomicsOverview", List.of());
    }

    /** {@code qor_getRollupStatus} — status of a rollup. */
    public JsonNode getRollupStatus(String rollupId) {
        return call("qor_getRollupStatus", List.of(rollupId));
    }

    /** {@code qor_listRollups} — all known rollups. */
    public JsonNode listRollups() {
        return call("qor_listRollups", List.of());
    }

    /** {@code qor_getSettlementBatch} — a settlement batch by rollup and index. */
    public JsonNode getSettlementBatch(String rollupId, int batchIndex) {
        return call("qor_getSettlementBatch", List.of(rollupId, batchIndex));
    }

    /** {@code qor_suggestRollupProfile} — a suggested rollup profile for a use case. */
    public JsonNode suggestRollupProfile(String useCase) {
        return call("qor_suggestRollupProfile", List.of(useCase));
    }

    /** {@code qor_getDABlobStatus} — data-availability blob status by rollup and index. */
    public JsonNode getDaBlobStatus(String rollupId, int blobIndex) {
        return call("qor_getDABlobStatus", List.of(rollupId, blobIndex));
    }

    /** {@code qor_getBTCStakingPosition} — BTC staking position for an address. */
    public JsonNode getBtcStakingPosition(String address) {
        return call("qor_getBTCStakingPosition", List.of(address));
    }

    /** {@code qor_getAbstractAccount} — account-abstraction record for an address. */
    public JsonNode getAbstractAccount(String address) {
        return call("qor_getAbstractAccount", List.of(address));
    }

    /** {@code qor_getFairBlockStatus} — fair-ordering / fair-block status. */
    public JsonNode getFairBlockStatus() {
        return call("qor_getFairBlockStatus", List.of());
    }

    /** {@code qor_getGasAbstractionConfig} — gas-abstraction configuration. */
    public JsonNode getGasAbstractionConfig() {
        return call("qor_getGasAbstractionConfig", List.of());
    }

    /** {@code qor_getLaneConfiguration} — mempool lane configuration. */
    public JsonNode getLaneConfiguration() {
        return call("qor_getLaneConfiguration", List.of());
    }
}
