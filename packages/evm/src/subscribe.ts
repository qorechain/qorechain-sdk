/**
 * Real-time EVM watchers for QoreChain, over a viem websocket transport.
 *
 * {@link createEvmSubscriptionClient} builds a viem public client on a
 * `webSocket` transport pointed at the network's `evmWs` endpoint, and the
 * `watch*` helpers are thin passthroughs to viem's polling/subscription
 * watchers scoped to that client. Each returns viem's `unwatch` function.
 *
 * These are deliberately minimal: viem owns the subscription lifecycle and
 * reconnection; this module just wires the QoreChain endpoint and re-exports a
 * focused surface so callers don't construct the transport themselves.
 */

import {
  createPublicClient,
  webSocket,
  type Chain,
  type PublicClient,
  type Transport,
  type WatchBlocksParameters,
  type WatchEventParameters,
  type WatchContractEventParameters,
  type WatchPendingTransactionsParameters,
} from "viem";

/** Subset of a qorechain-sdk network's endpoints relevant to EVM subscriptions. */
export interface EvmWsEndpoints {
  /** EVM JSON-RPC WebSocket endpoint. */
  evmWs: string;
}

/** Options for {@link createEvmSubscriptionClient}. */
export interface CreateEvmSubscriptionClientOptions {
  /** EVM websocket URL. Mutually exclusive with `endpoints`. */
  wsUrl?: string;
  /** A qorechain-sdk network endpoints object (uses `evmWs`). */
  endpoints?: EvmWsEndpoints;
  /** Optional viem `Chain` to bind. */
  chain?: Chain;
  /** Custom viem transport (primarily for testing). Overrides `wsUrl`/`endpoints`. */
  transport?: Transport;
}

/** A function that stops a watcher. */
export type Unwatch = () => void;

function resolveTransport(opts: CreateEvmSubscriptionClientOptions): Transport {
  if (opts.transport) return opts.transport;
  const url = opts.wsUrl ?? opts.endpoints?.evmWs;
  if (!url) {
    throw new Error(
      "createEvmSubscriptionClient: provide `wsUrl`, `endpoints.evmWs`, or a `transport`",
    );
  }
  return webSocket(url);
}

/**
 * Create a viem public client on a websocket transport for subscriptions.
 *
 * The returned client is a standard viem `PublicClient`; the `watch*` helpers in
 * this module accept it (or any viem public client).
 */
export function createEvmSubscriptionClient(
  opts: CreateEvmSubscriptionClientOptions,
): PublicClient {
  const transport = resolveTransport(opts);
  return createPublicClient({ transport, chain: opts.chain });
}

/** Watch for new blocks. Returns viem's `unwatch`. */
export function watchBlocks(
  client: PublicClient,
  args: WatchBlocksParameters,
): Unwatch {
  return client.watchBlocks(args as never);
}

/** Watch for logs matching an event filter. Returns viem's `unwatch`. */
export function watchEvent(
  client: PublicClient,
  args: WatchEventParameters,
): Unwatch {
  return client.watchEvent(args as never);
}

/** Watch a specific contract's events (decoded). Returns viem's `unwatch`. */
export function watchContractEvent(
  client: PublicClient,
  args: WatchContractEventParameters,
): Unwatch {
  return client.watchContractEvent(args as never);
}

/** Watch the mempool for pending transaction hashes. Returns viem's `unwatch`. */
export function watchPendingTransactions(
  client: PublicClient,
  args: WatchPendingTransactionsParameters,
): Unwatch {
  return client.watchPendingTransactions(args as never);
}
