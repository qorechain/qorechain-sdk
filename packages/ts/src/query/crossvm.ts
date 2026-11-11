/**
 * Cross-VM read helpers for QoreChain's `x/crossvm` module.
 *
 * These are thin, typed wrappers over {@link RestClient} for the module's REST
 * routes under `/qorechain/crossvm/v1/...`. They are standalone functions taking
 * a {@link RestClient} so they compose with the existing read surface without
 * widening the `RestClient` class itself.
 *
 * Responses are returned as generics defaulting to small interfaces / {@link
 * Record}<string, unknown>: the module returns rich, evolving JSON and the SDK
 * does not model every field.
 *
 * Note on direction: these helpers READ cross-VM message state. The actual
 * EVM→native routing - e.g. an EVM contract triggering a native AMM swap - is
 * performed on-chain via the cross-VM bridge precompile exposed in the
 * `@qorechain/evm` package (not duplicated here). Once a message is in flight,
 * track its status either through these REST reads or via the
 * `qor_getCrossVMMessage` JSON-RPC method already wrapped on `QorClient`.
 */

import type { RestClient } from "./rest";

/** A single cross-VM message record (unmodeled fields surface as-is). */
export interface CrossVmMessage {
  [key: string]: unknown;
}

/** Response of the single-message-by-id route. */
export interface CrossVmMessageResponse {
  message?: CrossVmMessage;
  [key: string]: unknown;
}

/** Response of the pending-messages route (one page, or every page merged). */
export interface PendingCrossVmMessagesResponse {
  /**
   * The pending messages. `payload_hex` in this list is cut to its first
   * 1,024 bytes; fetch one message with {@link getCrossVmMessage} for its
   * full payload.
   */
  messages?: CrossVmMessage[];
  /** Number of messages returned. */
  count?: number;
  /** Page metadata (`next_key` is empty on the last page). */
  pagination?: { next_key?: string | null; total?: string };
  [key: string]: unknown;
}

/** Most messages the chain returns per pending page. */
export const CROSSVM_PENDING_PAGE_LIMIT = 100;
/** Default safety cap on the pages {@link getPendingCrossVmMessages} reads. */
export const CROSSVM_PENDING_MAX_PAGES = 100;

/** Options for {@link getPendingCrossVmMessages}. */
export interface PendingCrossVmMessagesOptions {
  /** Messages per page (at most {@link CROSSVM_PENDING_PAGE_LIMIT}, the default). */
  pageLimit?: number;
  /** Stop after this many pages ({@link CROSSVM_PENDING_MAX_PAGES} by default). */
  maxPages?: number;
}

/** Response of the module params route. */
export interface CrossVmParamsResponse {
  params?: Record<string, unknown>;
  /**
   * The CosmWasm contracts the EVM bridge precompile may call, each
   * `"cosmwasm:<contract>"`; empty keeps the bridge shut (chain v3.2.5).
   */
  bridge_allowed_targets?: string[];
  [key: string]: unknown;
}

/**
 * Fetch a cross-VM message by id.
 *
 * GET `/qorechain/crossvm/v1/message/{id}`.
 */
export function getCrossVmMessage<T = CrossVmMessageResponse>(
  rest: RestClient,
  id: string,
): Promise<T> {
  return rest.get<T>(
    `/qorechain/crossvm/v1/message/${encodeURIComponent(id)}`,
  );
}

/**
 * Fetch one page of pending cross-VM messages.
 *
 * GET `/qorechain/crossvm/v1/pending?pagination.key=...&pagination.limit=...`.
 * A page holds at most 100 messages and `payload_hex` is truncated to 1,024
 * bytes.
 */
export function getPendingCrossVmMessagesPage<T = PendingCrossVmMessagesResponse>(
  rest: RestClient,
  pagination: { key?: string; limit?: number } = {},
): Promise<T> {
  const query: Record<string, string | number> = {};
  if (pagination.key) query["pagination.key"] = pagination.key;
  query["pagination.limit"] = Math.min(pagination.limit ?? CROSSVM_PENDING_PAGE_LIMIT, CROSSVM_PENDING_PAGE_LIMIT);
  return rest.get<T>("/qorechain/crossvm/v1/pending", query);
}

/**
 * Fetch ALL currently pending cross-VM messages, following
 * `pagination.next_key` until it is empty (the route is paginated from chain
 * v3.2.8, at most 100 per page). Stops after `maxPages` pages as a safety cap
 * and then throws, so a caller never silently gets a partial list.
 *
 * `payload_hex` in the list is cut to its first 1,024 bytes; fetch a single
 * message with {@link getCrossVmMessage} for the full payload.
 */
export async function getPendingCrossVmMessages(
  rest: RestClient,
  opts: PendingCrossVmMessagesOptions = {},
): Promise<PendingCrossVmMessagesResponse> {
  const maxPages = opts.maxPages ?? CROSSVM_PENDING_MAX_PAGES;
  const messages: CrossVmMessage[] = [];
  let key: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await getPendingCrossVmMessagesPage(rest, { key, limit: opts.pageLimit });
    messages.push(...(res.messages ?? []));
    const next = res.pagination?.next_key;
    if (!next) return { messages, count: messages.length };
    key = next;
  }
  throw new Error(
    `crossvm pending: more than ${maxPages} pages of pending messages; raise maxPages or read pages with getPendingCrossVmMessagesPage`,
  );
}

/**
 * Fetch the `x/crossvm` module parameters.
 *
 * GET `/qorechain/crossvm/v1/params`.
 */
export function getCrossVmParams<T = CrossVmParamsResponse>(
  rest: RestClient,
): Promise<T> {
  return rest.get<T>("/qorechain/crossvm/v1/params");
}
