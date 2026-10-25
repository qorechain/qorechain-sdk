/**
 * Which chain releases a network has applied.
 *
 * A release adds message fields and message types, and a node that has not
 * applied it does not know them. The transaction decoder refuses a message that
 * carries an unknown field, so setting one of the new OPTIONAL fields before
 * the upgrade does not get it ignored: the whole transaction is refused. A
 * client therefore sets a release's new fields only after the network has
 * applied that release, and this module is how it finds out.
 *
 * Each release switches its protocol features on at its upgrade plan height,
 * and the upgrade module reports the height at which a plan was applied. A plan
 * name is the same on every network. From chain v3.2.4 the switches can also be
 * read by name (`fetchProtocolFeatures`); a plan check works on every release.
 */

import type { FetchLike } from "../query/http";
import { fetchSignBytesV2AppliedHeight } from "./signbytes";

/**
 * EIP-7702 delegation consent, the measured EVM spending policy, the
 * `ecdsa_pubkey` check on PQC registration and the new bridge, multilayer and
 * RDK messages.
 */
export const CHAIN_UPGRADE_V3_2_2 = "v3.2.2";

/**
 * PQC registration integrity and `proof_of_possession`, hybrid-only key
 * maintenance for keyed accounts, the EVM window scope (`native_only`,
 * `allowed_targets`), the abstract-account v2 digest and `MsgUpdateAuthority`.
 */
export const CHAIN_UPGRADE_V3_2_3 = "v3.2.3";

/**
 * Chain v3.2.4: staking tiers, the authenticator nonce and protocol-feature
 * queries, `possession_proven`, and the bridge validator's proof of possession.
 */
export const CHAIN_UPGRADE_V3_2_4 = "v3.2.4";

/** How long a "not applied yet" answer is trusted before asking again. */
const NOT_APPLIED_TTL_MS = 60_000;

// An applied plan stays applied, so a positive answer is cached for the life of
// the process. A negative one is cached briefly: the upgrade can land at any
// block, and a client that cached "no" for long would keep leaving the new
// fields off after the network switched.
const cache = new Map<string, { height: bigint; at: number }>();

/** Options for {@link fetchUpgradeAppliedHeight} and {@link isUpgradeApplied}. */
export interface UpgradeQueryOptions {
  /** The network's REST (LCD) base URL. */
  rest: string;
  /** Plan name, e.g. {@link CHAIN_UPGRADE_V3_2_2}. */
  upgrade: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Ignore the cache and ask the node. */
  fresh?: boolean;
}

/**
 * The height at which `upgrade` was applied, or `0n` if it has not been.
 *
 * @throws when the node cannot be asked. Callers must not read a failure as
 *         "not applied": that guess sends the old wire format to an upgraded
 *         network, or the new one to an old network, and both are refused.
 */
export async function fetchUpgradeAppliedHeight(opts: UpgradeQueryOptions): Promise<bigint> {
  const key = `${opts.rest.replace(/\/+$/, "")}|${opts.upgrade}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && (hit.height > 0n || Date.now() - hit.at < NOT_APPLIED_TTL_MS)) {
    return hit.height;
  }
  const height = await fetchSignBytesV2AppliedHeight(
    opts.rest,
    opts.fetch ?? (globalThis.fetch as FetchLike),
    opts.upgrade,
  );
  cache.set(key, { height, at: Date.now() });
  return height;
}

/** Whether the network has applied `upgrade`. Throws when it cannot be asked. */
export async function isUpgradeApplied(opts: UpgradeQueryOptions): Promise<boolean> {
  return (await fetchUpgradeAppliedHeight(opts)) > 0n;
}

/**
 * Refuse to build a message that carries a release's new fields for a network
 * that has not applied the release. `what` names the fields for the error.
 */
export async function requireUpgradeApplied(
  opts: UpgradeQueryOptions & { what: string },
): Promise<void> {
  if (!(await isUpgradeApplied(opts))) {
    throw new Error(
      `${opts.what} needs chain ${opts.upgrade}, which this network has not applied yet. ` +
        `A node below ${opts.upgrade} refuses the whole transaction when the field is set; ` +
        `leave it unset until the upgrade.`,
    );
  }
}

/** Forget cached answers. For tests and for clients that switch networks. */
export function clearUpgradeCache(): void {
  cache.clear();
}
