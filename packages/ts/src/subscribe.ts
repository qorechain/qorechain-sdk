/**
 * Real-time event subscriptions over the chain's consensus RPC websocket.
 *
 * The consensus RPC client (from the CosmJS consensus-RPC package) exposes
 * streaming subscriptions for new blocks and for committed transactions matching a query.
 * Under the hood it opens a single websocket connection to `endpoints.rpc`; this
 * module wraps its `xstream`-style streams in a plain callback API and hands
 * back an unsubscribe function for each subscription, so dApp code never touches
 * the stream type directly.
 *
 * {@link createSubscriptionClient} connects the websocket-capable consensus RPC
 * client (an `http(s)://` URL is switched to `ws(s)://`). The connection works in Node (where it uses a websocket polyfill) and
 * in the browser; nothing here depends on `window`.
 */

import { Comet1Client, Comet38Client, connectComet, WebsocketClient } from "@cosmjs/tendermint-rpc";

/** A handler invoked for each emitted value. */
export type Handler<T> = (value: T) => void;

/** Called to tear down a subscription and stop receiving events. */
export type Unsubscribe = () => void;

/**
 * The `xstream`-style stream shape returned by the consensus RPC subscriptions.
 * Declared structurally so tests can supply a fake without importing `xstream`.
 */
export interface EventStream<T> {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (err: unknown) => void;
    complete?: () => void;
  }): { unsubscribe(): void };
}

/** A new-block event (the committed block). */
export interface NewBlockEventLike {
  readonly header?: { readonly height?: number };
}

/** A committed-transaction event. */
export interface TxEventLike {
  readonly hash: Uint8Array;
  readonly height: number;
  readonly result: unknown;
  readonly tx: Uint8Array;
}

/**
 * The subset of the consensus RPC client used for subscriptions. Declared
 * structurally so unit tests can inject a fake that never opens a socket.
 */
export interface SubscriptionClient {
  subscribeNewBlock(): EventStream<NewBlockEventLike>;
  subscribeTx(query?: string): EventStream<TxEventLike>;
  disconnect?(): void;
}

/**
 * Turn a consensus RPC URL into its websocket form: `http://` becomes `ws://`
 * and `https://` becomes `wss://`; a `ws(s)://` URL is returned unchanged.
 *
 * @param url - The consensus RPC endpoint.
 * @returns The websocket URL.
 */
export function toWebsocketUrl(url: string): string {
  return url.trim().replace(/^http(s?):\/\//i, (_m, tls: string) => (tls ? "wss://" : "ws://"));
}

/** The parts of the websocket RPC client's socket that disconnect touches. */
interface ReconnectingSocketLike {
  reconnectTimeout?: ReturnType<typeof setTimeout> | null;
}

/**
 * Close a websocket RPC client for good. The underlying socket reconnects on
 * its own whenever its connection drops, including the drop its own disconnect
 * causes, which reopened a socket after every disconnect and kept the process
 * running. Cancel that pending reconnect right after disconnecting.
 */
function disconnectForGood(ws: WebsocketClient): void {
  ws.disconnect();
  const socket = (ws as unknown as { socket?: ReconnectingSocketLike }).socket;
  if (socket?.reconnectTimeout) {
    clearTimeout(socket.reconnectTimeout);
    socket.reconnectTimeout = null;
  }
}

/**
 * Connect a websocket-capable consensus RPC client for subscriptions.
 *
 * One websocket serves both the version check and the subscriptions, and
 * `disconnect()` closes it for good (no reconnect afterwards), so a process
 * that disconnects can exit and a long-lived one does not collect sockets.
 *
 * @param rpcWsUrl - The consensus RPC endpoint (`endpoints.rpc`), as `ws(s)://`
 *   or `http(s)://` (switched to `ws(s)://`, see {@link toWebsocketUrl}).
 */
export async function createSubscriptionClient(
  rpcWsUrl: string,
): Promise<SubscriptionClient> {
  const ws = new WebsocketClient(toWebsocketUrl(rpcWsUrl));
  let version: string;
  try {
    // Read the node's consensus version over the same websocket.
    const res = await ws.execute({ jsonrpc: "2.0", id: 1, method: "status", params: {} });
    const result = res.result as { node_info?: { version?: unknown } } | undefined;
    version = String(result?.node_info?.version ?? "");
  } catch (err) {
    disconnectForGood(ws);
    throw err;
  }
  let client: Comet38Client | Comet1Client;
  if (version.startsWith("0.38.")) {
    client = Comet38Client.create(ws);
  } else if (version.startsWith("1.")) {
    client = Comet1Client.create(ws);
  } else {
    // Any other consensus version: hand over to the library's own detection.
    disconnectForGood(ws);
    return (await connectComet(toWebsocketUrl(rpcWsUrl))) as unknown as SubscriptionClient;
  }
  const subscriptions = client as unknown as SubscriptionClient;
  return {
    subscribeNewBlock: () => subscriptions.subscribeNewBlock(),
    subscribeTx: (query?: string) => subscriptions.subscribeTx(query),
    disconnect: () => disconnectForGood(ws),
  };
}

/**
 * Subscribe to newly committed blocks.
 *
 * @param client - A {@link SubscriptionClient} (see {@link createSubscriptionClient}).
 * @param handler - Called with each new block event.
 * @param onError - Optional error callback for stream errors.
 * @returns An {@link Unsubscribe} function.
 */
export function subscribeNewBlocks(
  client: SubscriptionClient,
  handler: Handler<NewBlockEventLike>,
  onError?: Handler<unknown>,
): Unsubscribe {
  const sub = client.subscribeNewBlock().subscribe({
    next: handler,
    error: onError,
  });
  return () => sub.unsubscribe();
}

/** Attribute filters for {@link buildTxQuery}, e.g. `{ "message.sender": addr }`. */
export type TxQueryFilters = Record<string, string | number>;

/**
 * Build a consensus-RPC subscription query string for transaction events.
 *
 * Always includes `tm.event='Tx'` and ANDs in each attribute filter. String
 * values are single-quoted; numeric values are emitted bare.
 *
 * @example buildTxQuery({ "message.sender": "qor1..." })
 *   // => "tm.event='Tx' AND message.sender='qor1...'"
 */
export function buildTxQuery(filters: TxQueryFilters = {}): string {
  const parts = ["tm.event='Tx'"];
  for (const [key, value] of Object.entries(filters)) {
    const rendered = typeof value === "number" ? `${value}` : `'${value}'`;
    parts.push(`${key}=${rendered}`);
  }
  return parts.join(" AND ");
}

/**
 * Subscribe to committed transactions matching a query.
 *
 * @param client - A {@link SubscriptionClient}.
 * @param query - A query string (see {@link buildTxQuery}) or an attribute-filter
 *   object that is passed through {@link buildTxQuery}.
 * @param handler - Called with each matching tx event.
 * @param onError - Optional error callback.
 * @returns An {@link Unsubscribe} function.
 */
export function subscribeTx(
  client: SubscriptionClient,
  query: string | TxQueryFilters,
  handler: Handler<TxEventLike>,
  onError?: Handler<unknown>,
): Unsubscribe {
  const q = typeof query === "string" ? query : buildTxQuery(query);
  const sub = client.subscribeTx(q).subscribe({
    next: handler,
    error: onError,
  });
  return () => sub.unsubscribe();
}
