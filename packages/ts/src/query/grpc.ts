/**
 * Typed gRPC-style query clients for the QoreChain modules with a query service.
 *
 * The chain exposes module queries over the consensus RPC's ABCI query path. We
 * reuse cosmjs's {@link QueryClient} + {@link createProtobufRpcClient}, which
 * turns that path into a `ProtobufRpcClient` (`request(service, method, data)`
 * → `Uint8Array`). Each typed client below encodes the request, dispatches by
 * the proto service/method name, and decodes the response — so callers get
 * fully typed `Query*Request` → `Query*Response` calls without hand-rolling ABCI
 * paths.
 *
 * Construct one with {@link connectQueryClients}, or wrap an existing
 * `ProtobufRpcClient` (e.g. one you already built) with the per-module helpers.
 */

import {
  QueryClient,
  createProtobufRpcClient,
  type ProtobufRpcClient,
} from "@cosmjs/stargate";

import * as bridge from "../codegen/qorechain/bridge/v1/query";
import * as crossvm from "../codegen/qorechain/crossvm/v1/query";
import * as lightnode from "../codegen/qorechain/lightnode/v1/query";
import * as multilayer from "../codegen/qorechain/multilayer/v1/query";
import * as pqc from "../codegen/qorechain/pqc/v1/query";
import * as qca from "../codegen/qorechain/qca/v1/query";
import * as rdk from "../codegen/qorechain/rdk/v1/query";
import * as reputation from "../codegen/qorechain/reputation/v1/query";
import * as rlconsensus from "../codegen/qorechain/rlconsensus/v1/query";
import * as svm from "../codegen/qorechain/svm/v1/query";

/** Minimal Comet RPC client shape cosmjs's `QueryClient.withExtensions` needs. */
type CometClientLike = Parameters<typeof QueryClient.withExtensions>[0];

/** A generated message with encode/decode (ts-proto `MessageFns`). */
interface Codec<T> {
  encode(message: T): { finish(): Uint8Array };
  decode(input: Uint8Array): T;
}

/**
 * Build a typed unary caller bound to a proto service + method name.
 *
 * Encodes the request, dispatches via the `ProtobufRpcClient`, and decodes the
 * response.
 */
function unary<Req, Res>(
  rpc: ProtobufRpcClient,
  service: string,
  method: string,
  reqCodec: Codec<Req>,
  resCodec: Codec<Res>,
): (request: Req) => Promise<Res> {
  return async (request: Req): Promise<Res> => {
    const data = reqCodec.encode(request).finish();
    const response = await rpc.request(service, method, data);
    return resCodec.decode(response);
  };
}

/** Cross-VM module query client. */
export interface CrossVmQueryClient {
  params(req?: crossvm.QueryParamsRequest): Promise<crossvm.QueryParamsResponse>;
  pendingMessages(
    req?: crossvm.QueryPendingMessagesRequest,
  ): Promise<crossvm.QueryPendingMessagesResponse>;
  message(
    req: crossvm.QueryMessageRequest,
  ): Promise<crossvm.QueryMessageResponse>;
}

/** Light-node module query client. */
export interface LightNodeQueryClient {
  lightNode(
    req: lightnode.QueryLightNodeRequest,
  ): Promise<lightnode.QueryLightNodeResponse>;
  lightNodes(
    req?: lightnode.QueryLightNodesRequest,
  ): Promise<lightnode.QueryLightNodesResponse>;
}

/** Multilayer (sidechain / paychain) module query client. */
export interface MultilayerQueryClient {
  /** Module parameters (limits, stake minimums, routing config). */
  params(
    req?: multilayer.QueryParamsRequest,
  ): Promise<multilayer.QueryParamsResponse>;
  /** A single layer (sidechain/paychain) config by ID. */
  layer(
    req: multilayer.QueryLayerRequest,
  ): Promise<multilayer.QueryLayerResponse>;
  /** All registered layers. */
  layers(
    req?: multilayer.QueryLayersRequest,
  ): Promise<multilayer.QueryLayersResponse>;
  /** Cross-layer routing statistics (gas savings, latency, counts). */
  routingStats(
    req?: multilayer.QueryRoutingStatsRequest,
  ): Promise<multilayer.QueryRoutingStatsView>;
}

/** RDK (rollup) module query client. */
export interface RdkQueryClient {
  /** Module parameters (max rollups, stake/blob limits, challenge window). */
  params(req?: rdk.QueryParamsRequest): Promise<rdk.QueryParamsResponse>;
  /** A single rollup config by ID. */
  rollup(req: rdk.QueryRollupRequest): Promise<rdk.QueryRollupResponse>;
  /** All registered rollups. */
  rollups(req?: rdk.QueryRollupsRequest): Promise<rdk.QueryRollupsResponse>;
  /** A settlement batch by (rollupId, batchIndex). */
  batch(req: rdk.QueryBatchRequest): Promise<rdk.QueryBatchResponse>;
  /** The latest settlement batch for a rollup. */
  latestBatch(
    req: rdk.QueryLatestBatchRequest,
  ): Promise<rdk.QueryLatestBatchResponse>;
}

/** Bridge module query client. */
export interface BridgeQueryClient {
  /** Global bridge config. */
  config(req?: bridge.QueryConfigRequest): Promise<bridge.QueryConfigResponse>;
  /** A single chain config by ID. */
  chainConfig(
    req: bridge.QueryChainConfigRequest,
  ): Promise<bridge.QueryChainConfigResponse>;
  /** All configured chains. */
  chainConfigs(
    req?: bridge.QueryChainConfigsRequest,
  ): Promise<bridge.QueryChainConfigsResponse>;
  /** A single bridge validator by address. */
  validator(
    req: bridge.QueryValidatorRequest,
  ): Promise<bridge.QueryValidatorResponse>;
  /** All bridge validators. */
  validators(
    req?: bridge.QueryValidatorsRequest,
  ): Promise<bridge.QueryValidatorsResponse>;
  /** A single bridge operation by ID. */
  operation(
    req: bridge.QueryOperationRequest,
  ): Promise<bridge.QueryOperationResponse>;
  /** All bridge operations. */
  operations(
    req?: bridge.QueryOperationsRequest,
  ): Promise<bridge.QueryOperationsResponse>;
}

/** PQC module query client. */
export interface PqcQueryClient {
  account(req: pqc.QueryAccountRequest): Promise<pqc.QueryAccountResponse>;
}

/** QCA module query client. */
export interface QcaQueryClient {
  config(req?: qca.QueryConfigRequest): Promise<qca.QueryConfigResponse>;
}

/** Reputation module query client. */
export interface ReputationQueryClient {
  params(
    req?: reputation.QueryParamsRequest,
  ): Promise<reputation.QueryParamsResponse>;
}

/** RL-consensus module query client. */
export interface RlConsensusQueryClient {
  agentStatus(
    req?: rlconsensus.QueryAgentStatusRequest,
  ): Promise<rlconsensus.QueryAgentStatusResponse>;
}

/** SVM module query client. */
export interface SvmQueryClient {
  slot(req?: svm.QuerySlotRequest): Promise<svm.QuerySlotResponse>;
  account(req: svm.QueryAccountRequest): Promise<svm.QueryAccountResponse>;
}

/** All typed module query clients, grouped by module. */
export interface QoreChainQueryClients {
  bridge: BridgeQueryClient;
  crossvm: CrossVmQueryClient;
  lightnode: LightNodeQueryClient;
  multilayer: MultilayerQueryClient;
  pqc: PqcQueryClient;
  qca: QcaQueryClient;
  rdk: RdkQueryClient;
  reputation: ReputationQueryClient;
  rlconsensus: RlConsensusQueryClient;
  svm: SvmQueryClient;
}

/**
 * Build the typed module query clients over an existing `ProtobufRpcClient`.
 *
 * Use this when you already have a cosmjs `QueryClient`/RPC client; otherwise
 * {@link connectQueryClients} sets one up from a Comet RPC client for you.
 */
export function createQueryClients(
  rpc: ProtobufRpcClient,
): QoreChainQueryClients {
  return {
    bridge: {
      config: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "Config",
        bridge.QueryConfigRequest,
        bridge.QueryConfigResponse,
      ),
      chainConfig: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "ChainConfig",
        bridge.QueryChainConfigRequest,
        bridge.QueryChainConfigResponse,
      ),
      chainConfigs: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "ChainConfigs",
        bridge.QueryChainConfigsRequest,
        bridge.QueryChainConfigsResponse,
      ),
      validator: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "Validator",
        bridge.QueryValidatorRequest,
        bridge.QueryValidatorResponse,
      ),
      validators: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "Validators",
        bridge.QueryValidatorsRequest,
        bridge.QueryValidatorsResponse,
      ),
      operation: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "Operation",
        bridge.QueryOperationRequest,
        bridge.QueryOperationResponse,
      ),
      operations: unary(
        rpc,
        "qorechain.bridge.v1.Query",
        "Operations",
        bridge.QueryOperationsRequest,
        bridge.QueryOperationsResponse,
      ),
    },
    crossvm: {
      params: unary(
        rpc,
        "qorechain.crossvm.v1.Query",
        "Params",
        crossvm.QueryParamsRequest,
        crossvm.QueryParamsResponse,
      ),
      pendingMessages: unary(
        rpc,
        "qorechain.crossvm.v1.Query",
        "PendingMessages",
        crossvm.QueryPendingMessagesRequest,
        crossvm.QueryPendingMessagesResponse,
      ),
      message: unary(
        rpc,
        "qorechain.crossvm.v1.Query",
        "Message",
        crossvm.QueryMessageRequest,
        crossvm.QueryMessageResponse,
      ),
    },
    lightnode: {
      lightNode: unary(
        rpc,
        "qorechain.lightnode.v1.Query",
        "LightNode",
        lightnode.QueryLightNodeRequest,
        lightnode.QueryLightNodeResponse,
      ),
      lightNodes: unary(
        rpc,
        "qorechain.lightnode.v1.Query",
        "LightNodes",
        lightnode.QueryLightNodesRequest,
        lightnode.QueryLightNodesResponse,
      ),
    },
    multilayer: {
      params: unary(
        rpc,
        "qorechain.multilayer.v1.Query",
        "Params",
        multilayer.QueryParamsRequest,
        multilayer.QueryParamsResponse,
      ),
      layer: unary(
        rpc,
        "qorechain.multilayer.v1.Query",
        "Layer",
        multilayer.QueryLayerRequest,
        multilayer.QueryLayerResponse,
      ),
      layers: unary(
        rpc,
        "qorechain.multilayer.v1.Query",
        "Layers",
        multilayer.QueryLayersRequest,
        multilayer.QueryLayersResponse,
      ),
      routingStats: unary(
        rpc,
        "qorechain.multilayer.v1.Query",
        "RoutingStats",
        multilayer.QueryRoutingStatsRequest,
        multilayer.QueryRoutingStatsView,
      ),
    },
    pqc: {
      account: unary(
        rpc,
        "qorechain.pqc.v1.Query",
        "Account",
        pqc.QueryAccountRequest,
        pqc.QueryAccountResponse,
      ),
    },
    rdk: {
      params: unary(
        rpc,
        "qorechain.rdk.v1.Query",
        "Params",
        rdk.QueryParamsRequest,
        rdk.QueryParamsResponse,
      ),
      rollup: unary(
        rpc,
        "qorechain.rdk.v1.Query",
        "Rollup",
        rdk.QueryRollupRequest,
        rdk.QueryRollupResponse,
      ),
      rollups: unary(
        rpc,
        "qorechain.rdk.v1.Query",
        "Rollups",
        rdk.QueryRollupsRequest,
        rdk.QueryRollupsResponse,
      ),
      batch: unary(
        rpc,
        "qorechain.rdk.v1.Query",
        "Batch",
        rdk.QueryBatchRequest,
        rdk.QueryBatchResponse,
      ),
      latestBatch: unary(
        rpc,
        "qorechain.rdk.v1.Query",
        "LatestBatch",
        rdk.QueryLatestBatchRequest,
        rdk.QueryLatestBatchResponse,
      ),
    },
    qca: {
      config: unary(
        rpc,
        "qorechain.qca.v1.Query",
        "Config",
        qca.QueryConfigRequest,
        qca.QueryConfigResponse,
      ),
    },
    reputation: {
      params: unary(
        rpc,
        "qorechain.reputation.v1.Query",
        "Params",
        reputation.QueryParamsRequest,
        reputation.QueryParamsResponse,
      ),
    },
    rlconsensus: {
      agentStatus: unary(
        rpc,
        "qorechain.rlconsensus.v1.Query",
        "AgentStatus",
        rlconsensus.QueryAgentStatusRequest,
        rlconsensus.QueryAgentStatusResponse,
      ),
    },
    svm: {
      slot: unary(
        rpc,
        "qorechain.svm.v1.Query",
        "Slot",
        svm.QuerySlotRequest,
        svm.QuerySlotResponse,
      ),
      account: unary(
        rpc,
        "qorechain.svm.v1.Query",
        "Account",
        svm.QueryAccountRequest,
        svm.QueryAccountResponse,
      ),
    },
  };
}

/**
 * Build the typed module query clients from a Comet RPC client.
 *
 * Wraps the RPC client in a cosmjs {@link QueryClient}, derives a
 * `ProtobufRpcClient`, and returns the per-module typed clients. The caller owns
 * the RPC client's lifecycle (disconnect it when done).
 */
export function connectQueryClients(
  cometClient: CometClientLike,
): QoreChainQueryClients {
  const base = QueryClient.withExtensions(cometClient);
  const rpc = createProtobufRpcClient(base);
  return createQueryClients(rpc);
}
