/**
 * High-level Multilayer client — ergonomic sidechain / paychain operations.
 *
 * The multilayer module lets an app register additional execution layers
 * (sidechains and paychains), periodically anchor their state roots back to the
 * main chain, and route individual transactions to the cheapest/fastest layer.
 * This helper wraps the typed message composers ({@link msg.multilayer}) and the
 * typed query client so a developer never has to hand-build a `{ typeUrl, value }`
 * or remember a service/method name.
 *
 * Lifecycle, end to end:
 *  1. `registerSidechain` / `registerPaychain` — declare a new layer.
 *  2. `anchorState` — commit a layer's state root to the main chain (the relayer
 *     does this on each settlement interval).
 *  3. `routeTransaction` — submit a payload and let the chain pick the best layer.
 *  4. `getLayer` / `listLayers` / `routingStats` — read layer state and metrics.
 *
 * Construct one with {@link createMultilayerClient}, passing a connected
 * {@link TxClient} (for writes) and, optionally, a {@link MultilayerQueryClient}
 * (for the typed reads).
 *
 * Note on running a layer: this SDK is the *app-developer* surface — it submits
 * and reads multilayer transactions. Operating the off-chain layer node itself
 * (block production, the relayer that calls `anchorState`) is a separate concern.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { multilayer as multilayerMsg } from "../messages/qorechain";
import type { TxClient, FeeInput, AutoFeeOptions } from "../tx/builder";
import type { BroadcastResult } from "../tx/broadcast";
import type { MultilayerQueryClient } from "../query/grpc";
import type {
  QueryLayerResponse,
  QueryLayersResponse,
  QueryParamsResponse,
  QueryRoutingStatsView,
} from "../codegen/qorechain/multilayer/v1/query";

/** Shared write-path options forwarded to {@link TxClient.signAndBroadcast}. */
export interface MultilayerWriteOptions {
  /** Fee: an explicit `StdFee` or `"auto"` (simulate + price). Default `"auto"`. */
  fee?: FeeInput;
  /** Optional memo string. */
  memo?: string;
  /** Auto-fee tuning (gas multiplier / gas price) when `fee` is `"auto"`. */
  autoFee?: AutoFeeOptions;
}

/** Options for {@link MultilayerClient.registerSidechain}. */
export interface RegisterSidechainOptions extends MultilayerWriteOptions {
  /** Unique layer identifier (e.g. `"game-sidechain"`). */
  layerId: string;
  /** Human-readable description of the layer's purpose. */
  description?: string;
  /** Target block time in milliseconds. */
  targetBlockTimeMs?: bigint | number | string;
  /** Soft cap on transactions per block. */
  maxTransactionsPerBlock?: bigint | number | string;
  /** Minimum validators required for the layer. */
  minValidators?: number;
  /** How many layer blocks between main-chain settlements (anchors). */
  settlementIntervalBlocks?: bigint | number | string;
  /** VM types the layer supports (e.g. `["evm", "wasm"]`). */
  supportedVmTypes?: string[];
  /** Application domains the layer is registered to serve. */
  supportedDomains?: string[];
}

/** Options for {@link MultilayerClient.registerPaychain}. */
export interface RegisterPaychainOptions extends MultilayerWriteOptions {
  /** Unique layer identifier (e.g. `"payments-paychain"`). */
  layerId: string;
  /** Human-readable description of the paychain's purpose. */
  description?: string;
  /** Soft cap on transactions per block. */
  maxTransactionsPerBlock?: bigint | number | string;
  /** How many layer blocks between main-chain settlements (anchors). */
  settlementIntervalBlocks?: bigint | number | string;
  /** Base fee multiplier as a decimal string (e.g. `"0.5"`). */
  baseFeeMultiplier?: string;
}

/** Options for {@link MultilayerClient.anchorState}. */
export interface AnchorStateOptions extends MultilayerWriteOptions {
  /** The layer whose state is being anchored. */
  layerId: string;
  /** The layer block height the state root corresponds to. */
  layerHeight: bigint | number | string;
  /** The layer's state root at `layerHeight`. */
  stateRoot: Uint8Array;
  /** Hash of the layer's validator set that signed this anchor. */
  validatorSetHash?: Uint8Array;
  /** PQC aggregate signature over the anchor. */
  pqcAggregateSignature?: Uint8Array;
  /** Number of transactions included since the previous anchor. */
  transactionCount?: bigint | number | string;
  /** Optional compressed proof of the anchored state. */
  compressedStateProof?: Uint8Array;
}

/** Options for {@link MultilayerClient.routeTransaction}. */
export interface RouteTransactionOptions extends MultilayerWriteOptions {
  /** The opaque transaction payload to route. */
  transactionPayload: Uint8Array;
  /** Preferred layer id; empty lets the router choose freely. */
  preferredLayer?: string;
  /** Acceptable upper bound on latency, in milliseconds. */
  maxLatencyMs?: bigint | number | string;
  /** Maximum fee the sender is willing to pay, as a string amount. */
  maxFee?: string;
}

/**
 * Ergonomic client for the multilayer (sidechain / paychain) module.
 *
 * Writes return the raw {@link BroadcastResult}; reads return the typed query
 * responses. Build the message offline with the `*Msg` methods if you want to
 * batch several messages into a single tx yourself.
 */
export interface MultilayerClient {
  /** Register a new sidechain layer. */
  registerSidechain(opts: RegisterSidechainOptions): Promise<BroadcastResult>;
  /** Register a new paychain layer. */
  registerPaychain(opts: RegisterPaychainOptions): Promise<BroadcastResult>;
  /** Anchor a layer's state root to the main chain. */
  anchorState(opts: AnchorStateOptions): Promise<BroadcastResult>;
  /** Route a transaction payload to the best-fit layer. */
  routeTransaction(opts: RouteTransactionOptions): Promise<BroadcastResult>;

  /** Build the `RegisterSidechain` message without broadcasting. */
  registerSidechainMsg(opts: Omit<RegisterSidechainOptions, keyof MultilayerWriteOptions>): EncodeObject;
  /** Build the `RegisterPaychain` message without broadcasting. */
  registerPaychainMsg(opts: Omit<RegisterPaychainOptions, keyof MultilayerWriteOptions>): EncodeObject;
  /** Build the `AnchorState` message without broadcasting. */
  anchorStateMsg(opts: Omit<AnchorStateOptions, keyof MultilayerWriteOptions>): EncodeObject;
  /** Build the `RouteTransaction` message without broadcasting. */
  routeTransactionMsg(opts: Omit<RouteTransactionOptions, keyof MultilayerWriteOptions>): EncodeObject;

  /** Read a single layer config by id. Requires a query client. */
  getLayer(layerId: string): Promise<QueryLayerResponse>;
  /** List all registered layers. Requires a query client. */
  listLayers(): Promise<QueryLayersResponse>;
  /** Read cross-layer routing statistics. Requires a query client. */
  routingStats(): Promise<QueryRoutingStatsView>;
  /** Read the module parameters. Requires a query client. */
  getParams(): Promise<QueryParamsResponse>;
}

/** Options for {@link createMultilayerClient}. */
export interface CreateMultilayerClientOptions {
  /**
   * Typed query client for the reads (`getLayer`, `listLayers`, `routingStats`,
   * `getParams`). Obtain it via {@link connectQueryClients} /
   * {@link createQueryClients}. If omitted, the read methods throw.
   */
  query?: MultilayerQueryClient;
}

/** Coerce a numeric-ish input to the string ts-proto expects for 64-bit ints. */
function toUint(value: bigint | number | string | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function requireQuery(
  q: MultilayerQueryClient | undefined,
): MultilayerQueryClient {
  if (!q) {
    throw new Error(
      "multilayer reads require a query client — pass { query } to createMultilayerClient (e.g. from connectQueryClients)",
    );
  }
  return q;
}

/**
 * Create a {@link MultilayerClient} bound to a connected {@link TxClient}.
 *
 * The `TxClient`'s sender address is used as the message signer
 * (creator/relayer/sender depending on the message), so the caller never repeats
 * their address.
 *
 * @param tx - A connected signing client (from `client.connectTx(signer)`).
 * @param opts - Optional typed query client for the read methods.
 */
export function createMultilayerClient(
  tx: TxClient,
  opts: CreateMultilayerClientOptions = {},
): MultilayerClient {
  const sender = tx.senderAddress;
  const query = opts.query;

  const send = (
    message: EncodeObject,
    w: MultilayerWriteOptions,
  ): Promise<BroadcastResult> =>
    tx.signAndBroadcast([message], w.fee ?? "auto", w.memo ?? "", {
      autoFee: w.autoFee,
    });

  const registerSidechainMsg = (
    o: Omit<RegisterSidechainOptions, keyof MultilayerWriteOptions>,
  ): EncodeObject =>
    multilayerMsg.registerSidechain({
      creator: sender,
      layerId: o.layerId,
      description: o.description,
      targetBlockTimeMs: toUint(o.targetBlockTimeMs),
      maxTransactionsPerBlock: toUint(o.maxTransactionsPerBlock),
      minValidators: o.minValidators,
      settlementIntervalBlocks: toUint(o.settlementIntervalBlocks),
      supportedVmTypes: o.supportedVmTypes,
      supportedDomains: o.supportedDomains,
    });

  const registerPaychainMsg = (
    o: Omit<RegisterPaychainOptions, keyof MultilayerWriteOptions>,
  ): EncodeObject =>
    multilayerMsg.registerPaychain({
      creator: sender,
      layerId: o.layerId,
      description: o.description,
      maxTransactionsPerBlock: toUint(o.maxTransactionsPerBlock),
      settlementIntervalBlocks: toUint(o.settlementIntervalBlocks),
      baseFeeMultiplier: o.baseFeeMultiplier,
    });

  const anchorStateMsg = (
    o: Omit<AnchorStateOptions, keyof MultilayerWriteOptions>,
  ): EncodeObject =>
    multilayerMsg.anchorState({
      relayer: sender,
      layerId: o.layerId,
      layerHeight: toUint(o.layerHeight),
      stateRoot: o.stateRoot,
      validatorSetHash: o.validatorSetHash,
      pqcAggregateSignature: o.pqcAggregateSignature,
      transactionCount: toUint(o.transactionCount),
      compressedStateProof: o.compressedStateProof,
    });

  const routeTransactionMsg = (
    o: Omit<RouteTransactionOptions, keyof MultilayerWriteOptions>,
  ): EncodeObject =>
    multilayerMsg.routeTransaction({
      sender,
      transactionPayload: o.transactionPayload,
      preferredLayer: o.preferredLayer,
      maxLatencyMs: toUint(o.maxLatencyMs),
      maxFee: o.maxFee,
    });

  return {
    registerSidechainMsg,
    registerPaychainMsg,
    anchorStateMsg,
    routeTransactionMsg,

    registerSidechain: (o) => send(registerSidechainMsg(o), o),
    registerPaychain: (o) => send(registerPaychainMsg(o), o),
    anchorState: (o) => send(anchorStateMsg(o), o),
    routeTransaction: (o) => send(routeTransactionMsg(o), o),

    getLayer: (layerId) => requireQuery(query).layer({ layerId }),
    listLayers: () => requireQuery(query).layers({}),
    routingStats: () => requireQuery(query).routingStats({}),
    getParams: () => requireQuery(query).params({}),
  };
}
