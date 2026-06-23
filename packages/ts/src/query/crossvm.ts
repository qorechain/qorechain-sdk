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
 * EVM→native routing — e.g. an EVM contract triggering a native AMM swap — is
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

/** Response of the pending-messages route. */
export interface PendingCrossVmMessagesResponse {
  messages?: CrossVmMessage[];
  [key: string]: unknown;
}

/** Response of the module params route. */
export interface CrossVmParamsResponse {
  params?: Record<string, unknown>;
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
 * Fetch all currently pending cross-VM messages.
 *
 * GET `/qorechain/crossvm/v1/pending`.
 */
export function getPendingCrossVmMessages<
  T = PendingCrossVmMessagesResponse,
>(rest: RestClient): Promise<T> {
  return rest.get<T>("/qorechain/crossvm/v1/pending");
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
