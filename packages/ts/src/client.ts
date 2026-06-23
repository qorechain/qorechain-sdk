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
 *  - The default network is `testnet`. Its endpoints default to localhost; pass
 *    `endpoints` to point at real testnet hostnames.
 *  - `mainnet` is not yet live and ships no endpoints. If `endpoints` supplies
 *    the needed URLs, a usable client is built from `mainnet` metadata + those
 *    overrides (the throwing `getNetwork("mainnet")` is not used). If the
 *    required endpoints are absent, this throws the same "not yet live" error as
 *    {@link getNetwork}.
 *
 * Read sub-clients are lazy getters: each only needs its own endpoint, so
 * accessing one whose endpoint is missing throws a clear, actionable error
 * naming the missing endpoint rather than failing later with an opaque request.
 */

import type { OfflineDirectSigner, GeneratedType } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/amino";
import {
  getNetwork,
  NETWORKS,
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
   * Endpoint overrides, merged over the preset's defaults. On `testnet` this
   * lets you swap localhost for real hostnames; on `mainnet` (not yet live) it
   * is REQUIRED — supply at least the endpoints you intend to use.
   */
  endpoints?: Partial<NetworkEndpoints>;
  /**
   * Chain ID to use. Only meaningful for `mainnet`, which has no preset chain
   * ID; ignored for `testnet` (which always uses its live chain ID).
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
 * For `testnet`, starts from the live preset and overlays `opts.endpoints`. For
 * `mainnet`, builds the config from `mainnet` metadata + the supplied endpoints
 * (or throws the not-yet-live error if none are supplied).
 */
function resolveNetwork(opts: CreateClientOptions): NetworkConfig {
  const name: NetworkName = opts.network ?? "testnet";
  const overrides = opts.endpoints ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;

  if (name === "mainnet" && !NETWORKS.mainnet.live) {
    // Not live: only buildable from caller-supplied endpoints.
    if (!hasOverrides) {
      // Match getNetwork's wording exactly.
      getNetwork("mainnet"); // throws
    }
    const meta = NETWORKS.mainnet;
    return {
      ...meta,
      chainId: opts.chainId ?? meta.chainId,
      // Partial endpoints are intentional here: missing ones are caught lazily
      // by the sub-client getters with an actionable error.
      endpoints: { ...(meta.endpoints ?? {}), ...overrides } as NetworkEndpoints,
    };
  }

  // Live preset (testnet): start from it, overlay any endpoint overrides.
  const base = getNetwork(name);
  return {
    ...base,
    endpoints: { ...(base.endpoints as NetworkEndpoints), ...overrides },
  };
}

/** Read a required endpoint or throw an actionable error naming it. */
function requireEndpoint(
  endpoints: NetworkEndpoints | null,
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
 * @throws If `mainnet` is selected without the endpoints needed to build it.
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
