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

/**
 * What the network says about one switch:
 * - `"enabled"` / `"disabled"`: the node lists it, with that state;
 * - `"not-served"`: the node gives no answer for it - it does not serve the
 *   route (HTTP 404 or 501, below chain v3.2.4), lists no features, or does not
 *   list this switch. Callers may then fall back to the upgrade plans.
 */
export type ProtocolFeatureState = "enabled" | "disabled" | "not-served";

/** Raised when the network could not be asked (a network error, an HTTP error other than 404/501, a bad answer). */
export class ProtocolFeaturesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolFeaturesUnavailableError";
  }
}

/**
 * Read one protocol feature switch, telling "the node has no answer" (a
 * definite 404/501, an empty list, an unlisted switch) apart from "the node
 * could not be asked". Only the first may fall back to the upgrade plans: on a
 * fork, a fresh devnet or an event chain the plans read height 0 while the new
 * rules are on, so a silent fallback after a network error signs the old form.
 *
 * @throws {@link ProtocolFeaturesUnavailableError} on a network error, an HTTP
 *   status other than 2xx/404/501, or an answer that is not the expected JSON.
 */
export async function lookupProtocolFeature(opts: {
  rest: string;
  name: string;
  fetch?: FetchLike;
}): Promise<ProtocolFeatureState> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/protocol_features`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await f(url);
  } catch (e) {
    throw new ProtocolFeaturesUnavailableError(`cannot reach ${url}: ${(e as Error).message}`);
  }
  if (res.status === 404 || res.status === 501) return "not-served";
  if (!res.ok) throw new ProtocolFeaturesUnavailableError(`protocol_features query failed: HTTP ${res.status} from ${url}`);
  let body: { features?: unknown };
  try {
    body = (await res.json()) as { features?: unknown };
  } catch (e) {
    throw new ProtocolFeaturesUnavailableError(`protocol_features answer from ${url} is not JSON: ${(e as Error).message}`);
  }
  if (body === null || typeof body !== "object" || (body.features !== undefined && !Array.isArray(body.features))) {
    throw new ProtocolFeaturesUnavailableError(`protocol_features answer from ${url} has no features list`);
  }
  const features = (body.features ?? []) as Record<string, unknown>[];
  const hit = features.find((x) => x && x.name === opts.name);
  if (!hit) return "not-served";
  return hit.enabled === true ? "enabled" : "disabled";
}

/** The switch that makes `MsgRegisterPQCKeyV2` carry a proof of possession. */
export const PQC_POSSESSION_FLAG_FEATURE = "pqc-possession-flag";

/**
 * Whether the network wants `MsgRegisterPQCKeyV2` to carry a proof of
 * possession: reads {@link PQC_POSSESSION_FLAG_FEATURE}; only when the node has
 * no answer for it (HTTP 404/501, no such switch) falls back to `fallback`
 * (the caller's upgrade-plan check). Never guesses after a network error: a
 * proof sent to a node that does not know the field, or missing where it is
 * required, gets the registration refused.
 *
 * @throws {@link ProtocolFeaturesUnavailableError} when the network could not be asked.
 */
export async function isProofOfPossessionExpected(opts: {
  rest: string;
  fetch?: FetchLike;
  fallback: () => Promise<boolean>;
}): Promise<boolean> {
  const state = await lookupProtocolFeature({ rest: opts.rest, name: PQC_POSSESSION_FLAG_FEATURE, fetch: opts.fetch });
  if (state === "not-served") return opts.fallback();
  return state === "enabled";
}
