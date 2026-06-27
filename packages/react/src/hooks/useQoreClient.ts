/**
 * {@link useQoreClient} — the composed read client held by the provider.
 */

import type { QoreChainClient } from "@qorechain/sdk";
import { useQoreContext } from "../context";

/**
 * Return the {@link QoreChainClient} created by the nearest
 * {@link QoreChainProvider}. Use it for ad-hoc reads (`client.rest`,
 * `client.qor`, `client.fees`, ...) not already covered by a dedicated hook.
 */
export function useQoreClient(): QoreChainClient {
  return useQoreContext().client;
}
