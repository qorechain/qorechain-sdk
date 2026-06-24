/**
 * Top-level `createClient` factory for the QoreChain SDK.
 *
 * {@link createClient} resolves a {@link NetworkConfig} (applying any endpoint
 * overrides) and composes the read clients ({@link RestClient}, the EVM
 * {@link JsonRpcClient}, and the `qor_` {@link QorClient}) plus a fee-estimate
 * convenience over {@link estimateFee}. Signing is opt-in: call
 * {@link QoreChainClient.connectTx} with an offline signer to get a
 * {@link TxClient}.
 *
 * Network resolution rules:
 *  - The default network is `testnet`. Both `testnet` and `mainnet` are live and
 *    ship localhost endpoint defaults; pass `endpoints` to point at real
 *    hostnames.
 *
 * Read sub-clients are lazy getters: each only needs its own endpoint, so
 * accessing one whose endpoint is missing throws a clear, actionable error
 * naming the missing endpoint rather than failing later with an opaque request.
 */

import type { OfflineDirectSigner, GeneratedType } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/amino";
import {
  getNetwork,
  type NetworkConfig,
  type NetworkEndpoints,
  type NetworkName,
} from "./config/networks";
import type { FetchLike, HttpOptions } from "./query/http";
import { RestClient } from "./query/rest";
import { JsonRpcClient } from "./query/jsonrpc";
import { QorClient } from "./query/qor";
import { estimateFee } from "./tx/fees";
import type { FeeUrgency } from "./query/rest";
import { TxClient } from "./tx/builder";
import { createCosmWasmClient } from "./cosmwasm";
import type { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import {
  getCrossVmMessage,
  getPendingCrossVmMessages,
  getCrossVmParams,
  type CrossVmMessageResponse,
  type PendingCrossVmMessagesResponse,
  type CrossVmParamsResponse,
} from "./query/crossvm";

/** Options for {@link createClient}. */
export interface CreateClientOptions {
  /** Network preset to target. Defaults to `"testnet"`. */
  network?: NetworkName;
  /**
   * Endpoint overrides, merged over the preset's defaults. Both `testnet` and
   * `mainnet` default to localhost; pass real hostnames here to override them.
   */
  endpoints?: Partial<NetworkEndpoints>;
  /**
   * Chain ID override. Both presets ship a live chain ID, so this is only needed
   * to point at a non-standard chain.
   */
  chainId?: string;
  /** Injectable `fetch` for the read clients (used by tests). */
  fetch?: FetchLike;
  /**
   * Additional HTTP transport options (timeout, retries, headers) shared by the
   * read clients.
   */
  http?: Omit<HttpOptions, "fetch">;
}

/** Options for {@link QoreChainClient.connectTx}. */
export interface ConnectTxOptions {
  /**
   * Extra protobuf message types to register, as `[typeUrl, GeneratedType]`
   * pairs (forwarded to {@link TxClient.connect}).
   */
  registryTypes?: ReadonlyArray<[string, GeneratedType]>;
}

/** Fee convenience surface exposed by {@link QoreChainClient}. */
export interface ClientFees {
  /**
   * Estimate a fee for the given urgency via the AI fee oracle (with a static
   * fallback). See {@link estimateFee}.
   */
  estimate(urgency?: FeeUrgency): Promise<StdFee>;
}

/** Cross-VM read convenience surface, bound to the client's REST endpoint. */
export interface ClientCrossVm {
  /** A cross-VM message by id (`/qorechain/crossvm/v1/message/{id}`). */
  message(id: string): Promise<CrossVmMessageResponse>;
  /** Currently pending cross-VM messages (`/qorechain/crossvm/v1/pending`). */
  pending(): Promise<PendingCrossVmMessagesResponse>;
  /** Cross-VM module params (`/qorechain/crossvm/v1/params`). */
  params(): Promise<CrossVmParamsResponse>;
}

/**
 * A composed QoreChain client: resolved config, read clients, fee helper, and a
 * lazy signing entrypoint.
 */
export interface QoreChainClient {
  /** The resolved network config (with any endpoint/chain-id overrides applied). */
  readonly network: NetworkConfig;
  /** Cosmos + QoreChain REST read client (uses `endpoints.rest`). */
  readonly rest: RestClient;
  /** EVM JSON-RPC client (uses `endpoints.evmRpc`). */
  readonly evm: JsonRpcClient;
  /** QoreChain `qor_` namespace client (uses `endpoints.evmRpc`). */
  readonly qor: QorClient;
  /** Fee-estimate convenience over the REST client. */
  readonly fees: ClientFees;
  /** Cross-VM read helpers over the REST client. */
  readonly crossvm: ClientCrossVm;
  /**
   * Connect a read-only CosmWasm client at `endpoints.rpc`.
   *
   * Async (the cosmjs client opens an RPC connection on connect), so this is a
   * method rather than a lazy getter; the result is memoized across calls.
   */
  cosmwasm(): Promise<CosmWasmClient>;
  /**
   * Connect a signer and return a {@link TxClient} bound to `endpoints.rpc`.
   * The heavy lifting lives in {@link TxClient.connect}.
   */
  connectTx(
    signer: OfflineDirectSigner,
    opts?: ConnectTxOptions,
  ): Promise<TxClient>;
}

/**
 * Resolve the effective {@link NetworkConfig} for the given options.
 *
 * Starts from the live preset (`testnet` or `mainnet`) and overlays
 * `opts.endpoints` and an optional `opts.chainId`.
 */
function resolveNetwork(opts: CreateClientOptions): NetworkConfig {
  const name: NetworkName = opts.network ?? "testnet";
  const overrides = opts.endpoints ?? {};

  const base = getNetwork(name);
  return {
    ...base,
    chainId: opts.chainId ?? base.chainId,
    endpoints: { ...base.endpoints, ...overrides },
  };
}

/** Read a required endpoint or throw an actionable error naming it. */
function requireEndpoint(
  endpoints: NetworkEndpoints,
  key: keyof NetworkEndpoints,
): string {
  const value = endpoints?.[key];
  if (!value) {
    throw new Error(
      `endpoint "${key}" is not configured — pass it via createClient({ endpoints: { ${key}: "..." } })`,
    );
  }
  return value;
}

/**
 * Create a composed {@link QoreChainClient}.
 *
 * @param opts - Network selection, endpoint overrides, and transport options.
 */
export function createClient(opts: CreateClientOptions = {}): QoreChainClient {
  const network = resolveNetwork(opts);
  const httpOptions: HttpOptions = { ...opts.http, fetch: opts.fetch };

  // Memoize each sub-client so repeated access returns the same instance, while
  // still deferring construction (and the missing-endpoint check) until first use.
  let restClient: RestClient | undefined;
  let evmClient: JsonRpcClient | undefined;
  let qorClient: QorClient | undefined;

  const getRest = (): RestClient => {
    if (!restClient) {
      restClient = new RestClient(
        requireEndpoint(network.endpoints, "rest"),
        httpOptions,
      );
    }
    return restClient;
  };
  const getEvm = (): JsonRpcClient => {
    if (!evmClient) {
      evmClient = new JsonRpcClient(
        requireEndpoint(network.endpoints, "evmRpc"),
        httpOptions,
      );
    }
    return evmClient;
  };
  const getQor = (): QorClient => {
    if (!qorClient) {
      qorClient = new QorClient(
        requireEndpoint(network.endpoints, "evmRpc"),
        httpOptions,
      );
    }
    return qorClient;
  };

  const fees: ClientFees = {
    estimate: (urgency?: FeeUrgency) => estimateFee(getRest(), { urgency }),
  };

  const crossvm: ClientCrossVm = {
    message: (id: string) => getCrossVmMessage(getRest(), id),
    pending: () => getPendingCrossVmMessages(getRest()),
    params: () => getCrossVmParams(getRest()),
  };

  // Memoize the (async) CosmWasm client so repeated calls reuse one connection.
  let cosmWasmClient: Promise<CosmWasmClient> | undefined;

  return {
    network,
    get rest() {
      return getRest();
    },
    get evm() {
      return getEvm();
    },
    get qor() {
      return getQor();
    },
    fees,
    crossvm,
    cosmwasm() {
      if (!cosmWasmClient) {
        cosmWasmClient = createCosmWasmClient(
          requireEndpoint(network.endpoints, "rpc"),
        );
      }
      return cosmWasmClient;
    },
    connectTx(signer: OfflineDirectSigner, txOpts: ConnectTxOptions = {}) {
      return TxClient.connect({
        rpcEndpoint: requireEndpoint(network.endpoints, "rpc"),
        signer,
        registryTypes: txOpts.registryTypes,
      });
    },
  };
}
