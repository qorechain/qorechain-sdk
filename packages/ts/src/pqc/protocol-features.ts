/**
 * The chain's protocol feature switches (chain v3.2.4,
 * `/qorechain/pqc/v1/protocol_features`).
 *
 * Each consensus change ships behind a named switch that a governance upgrade
 * turns on at its height. Reading the switch tells a client whether the
 * network enforces a rule today, without inferring it from upgrade plan
 * names. Networks below v3.2.4 do not serve the route: use
 * {@link isUpgradeApplied} there.
 */

import type { FetchLike } from "../query/http";

/** One switch. */
export interface ProtocolFeature {
  name: string;
  /** On at the current height. */
  enabled: boolean;
  /** False for a switch a newer release enabled and this node does not know. */
  known: boolean;
  /** Carried by the node's binary but not enabled by any release yet. */
  staged: boolean;
}

/** Every switch the node knows, at `height`. */
export interface ProtocolFeatures {
  features: ProtocolFeature[];
  height: bigint;
}

/** Read the network's protocol feature switches. */
export async function fetchProtocolFeatures(opts: { rest: string; fetch?: FetchLike }): Promise<ProtocolFeatures> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/protocol_features`;
  const res = await f(url);
  if (!res.ok) throw new Error(`protocol_features query failed: HTTP ${res.status} from ${url}`);
  const b = (await res.json()) as { features?: Record<string, unknown>[]; height?: unknown };
  return {
    features: (Array.isArray(b.features) ? b.features : []).map((x) => ({
      name: typeof x.name === "string" ? x.name : "",
      enabled: x.enabled === true,
      known: x.known === true,
      staged: x.staged === true,
    })),
    height: BigInt(typeof b.height === "string" || typeof b.height === "number" ? b.height : 0),
  };
}

/** Whether the switch `name` is on. A switch the node does not list is off. */
export async function isProtocolFeatureEnabled(opts: {
  rest: string;
  name: string;
  fetch?: FetchLike;
}): Promise<boolean> {
  const { features } = await fetchProtocolFeatures(opts);
  return features.some((x) => x.name === opts.name && x.enabled);
}
