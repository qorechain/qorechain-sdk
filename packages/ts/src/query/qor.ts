/**
 * Typed wrappers for the QoreChain `qor_*` JSON-RPC namespace.
 *
 * Each method maps one-to-one to a chain RPC method, exposed against the EVM
 * JSON-RPC endpoint (`endpoints.evmRpc`). The on-the-wire method names use the
 * chain's exact casing (e.g. `qor_getPQCKeyStatus`, `qor_getAIStats`) and must
 * not be altered.
 *
 * Results are intentionally returned as generics defaulting to
 * {@link Record}<string, unknown>: the chain returns rich, evolving JSON and the
 * SDK does not model every field. Callers pass a concrete type argument when
 * they know the shape.
 */

import { JsonRpcClient, type JsonRpcClientOptions } from "./jsonrpc";

/** Convenience default for unmodeled `qor_*` responses. */
type Json = Record<string, unknown>;

/**
 * Client for the QoreChain `qor_*` JSON-RPC namespace.
 *
 * Built on {@link JsonRpcClient}; point it at the network's `evmRpc` endpoint.
 */
export class QorClient extends JsonRpcClient {
  constructor(url: string, opts: JsonRpcClientOptions = {}) {
    super(url, opts);
  }

  /** `qor_getPQCKeyStatus` — PQC key registration status for an address. */
  getPqcKeyStatus<T = Json>(address: string): Promise<T> {
    return this.call<T>("qor_getPQCKeyStatus", [address]);
  }

  /** `qor_getHybridSignatureMode` — active hybrid-signature policy. */
  getHybridSignatureMode<T = Json>(): Promise<T> {
    return this.call<T>("qor_getHybridSignatureMode", []);
  }

  /** `qor_getAIStats` — QCAI engine statistics. */
  getAiStats<T = Json>(): Promise<T> {
    return this.call<T>("qor_getAIStats", []);
  }

  /** `qor_getCrossVMMessage` — a cross-VM message by id. */
  getCrossVmMessage<T = Json>(messageId: string): Promise<T> {
    return this.call<T>("qor_getCrossVMMessage", [messageId]);
  }

  /** `qor_getReputationScore` — reputation score for a validator. */
  getReputationScore<T = Json>(validator: string): Promise<T> {
    return this.call<T>("qor_getReputationScore", [validator]);
  }

  /** `qor_getLayerInfo` — info about a chain layer. */
  getLayerInfo<T = Json>(layerId: string): Promise<T> {
    return this.call<T>("qor_getLayerInfo", [layerId]);
  }

  /** `qor_getBridgeStatus` — bridge status for a remote chain id. */
  getBridgeStatus<T = Json>(chainId: string): Promise<T> {
    return this.call<T>("qor_getBridgeStatus", [chainId]);
  }

  /** `qor_getRLAgentStatus` — reinforcement-learning agent status. */
  getRlAgentStatus<T = Json>(): Promise<T> {
    return this.call<T>("qor_getRLAgentStatus", []);
  }

  /** `qor_getRLObservation` — latest RL observation vector. */
  getRlObservation<T = Json>(): Promise<T> {
    return this.call<T>("qor_getRLObservation", []);
  }

  /** `qor_getRLReward` — latest RL reward signal. */
  getRlReward<T = Json>(): Promise<T> {
    return this.call<T>("qor_getRLReward", []);
  }

  /** `qor_getPoolClassification` — validator pool classification. */
  getPoolClassification<T = Json>(validator: string): Promise<T> {
    return this.call<T>("qor_getPoolClassification", [validator]);
  }

  /** `qor_getBurnStats` — token burn statistics. */
  getBurnStats<T = Json>(): Promise<T> {
    return this.call<T>("qor_getBurnStats", []);
  }

  /** `qor_getXQOREPosition` — xQORE staking position for an address. */
  getXqorePosition<T = Json>(address: string): Promise<T> {
    return this.call<T>("qor_getXQOREPosition", [address]);
  }

  /** `qor_getInflationRate` — current inflation rate. */
  getInflationRate<T = Json>(): Promise<T> {
    return this.call<T>("qor_getInflationRate", []);
  }

  /** `qor_getTokenomicsOverview` — aggregate tokenomics snapshot. */
  getTokenomicsOverview<T = Json>(): Promise<T> {
    return this.call<T>("qor_getTokenomicsOverview", []);
  }

  /** `qor_getRollupStatus` — status of a rollup. */
  getRollupStatus<T = Json>(rollupId: string): Promise<T> {
    return this.call<T>("qor_getRollupStatus", [rollupId]);
  }

  /** `qor_listRollups` — all known rollups. */
  listRollups<T = Json>(): Promise<T> {
    return this.call<T>("qor_listRollups", []);
  }

  /** `qor_getSettlementBatch` — a settlement batch by rollup and index. */
  getSettlementBatch<T = Json>(rollupId: string, batchIndex: number): Promise<T> {
    return this.call<T>("qor_getSettlementBatch", [rollupId, batchIndex]);
  }

  /** `qor_suggestRollupProfile` — a suggested rollup profile for a use case. */
  suggestRollupProfile<T = Json>(useCase: string): Promise<T> {
    return this.call<T>("qor_suggestRollupProfile", [useCase]);
  }

  /** `qor_getDABlobStatus` — data-availability blob status by rollup and index. */
  getDaBlobStatus<T = Json>(rollupId: string, blobIndex: number): Promise<T> {
    return this.call<T>("qor_getDABlobStatus", [rollupId, blobIndex]);
  }

  /** `qor_getBTCStakingPosition` — BTC staking position for an address. */
  getBtcStakingPosition<T = Json>(address: string): Promise<T> {
    return this.call<T>("qor_getBTCStakingPosition", [address]);
  }

  /** `qor_getAbstractAccount` — account-abstraction record for an address. */
  getAbstractAccount<T = Json>(address: string): Promise<T> {
    return this.call<T>("qor_getAbstractAccount", [address]);
  }

  /** `qor_getFairBlockStatus` — fair-ordering / fair-block status. */
  getFairBlockStatus<T = Json>(): Promise<T> {
    return this.call<T>("qor_getFairBlockStatus", []);
  }

  /** `qor_getGasAbstractionConfig` — gas-abstraction configuration. */
  getGasAbstractionConfig<T = Json>(): Promise<T> {
    return this.call<T>("qor_getGasAbstractionConfig", []);
  }

  /** `qor_getLaneConfiguration` — mempool lane configuration. */
  getLaneConfiguration<T = Json>(): Promise<T> {
    return this.call<T>("qor_getLaneConfiguration", []);
  }
}
