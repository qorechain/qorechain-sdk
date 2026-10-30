/**
 * Client-side checks for the governance `MsgUpdateParams` of `x/crossvm` and
 * `x/rdk`, routed from chain v3.2.5. Each replaces the module parameters
 * wholesale and only executes from a passed proposal (`authority` is the
 * governance module account), so a proposal copies the current values from
 * the params query and changes only what it means to change. The checks mirror
 * the chain's, so a proposal that would fail on execution is refused before it
 * is submitted.
 */

import { isValidBech32 } from "./utils/address";

/** crossvm ceilings a governance update must respect. */
export const CROSSVM_MAX_MESSAGE_SIZE = 1 << 20;
export const CROSSVM_MAX_QUEUE_SIZE = 10_000;
export const CROSSVM_MAX_QUEUE_TIMEOUT_BLOCKS = 100_000;
export const CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS = 64;
export const CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE = 256;

/** rdk bounds of `defaultChallengeWindow` (seconds) and `maxDaBlobSize` (bytes). */
export const RDK_MIN_CHALLENGE_WINDOW_SEC = 60;
export const RDK_MAX_CHALLENGE_WINDOW_SEC = 30 * 24 * 3600;
export const RDK_MAX_DA_BLOB_SIZE = 8 << 20;

type IntLike = number | bigint | string | undefined;

function positive(v: IntLike, name: string, what: string, max?: number): bigint {
  let n: bigint;
  try {
    n = BigInt(v ?? 0);
  } catch {
    throw new Error(`${what}: ${name} must be a positive integer, got ${String(v)}`);
  }
  if (n <= 0n) throw new Error(`${what}: ${name} must be a positive integer, got ${String(v)}`);
  if (max !== undefined && n > BigInt(max)) throw new Error(`${what}: ${name} ${n} exceeds ${max}`);
  return n;
}

/**
 * The chain's checks on crossvm `MsgUpdateParams`. Each `bridgeAllowedTargets`
 * entry is `"cosmwasm:<contract>"` (the EVM bridge precompile only calls
 * CosmWasm contracts), at most 64 entries of at most 256 bytes, no duplicates.
 * An empty list keeps the bridge shut.
 */
export function validateCrossVmUpdateParams(value: {
  authority?: string;
  maxMessageSize?: IntLike;
  maxQueueSize?: number;
  queueTimeoutBlocks?: IntLike;
  bridgeAllowedTargets?: readonly (string | undefined)[];
}): void {
  const what = "crossvm updateParams";
  if (!value.authority) throw new Error(`${what}: authority (the governance module account) is required`);
  positive(value.maxMessageSize, "maxMessageSize", what, CROSSVM_MAX_MESSAGE_SIZE);
  positive(value.maxQueueSize, "maxQueueSize", what, CROSSVM_MAX_QUEUE_SIZE);
  positive(value.queueTimeoutBlocks, "queueTimeoutBlocks", what, CROSSVM_MAX_QUEUE_TIMEOUT_BLOCKS);
  const targets = value.bridgeAllowedTargets ?? [];
  if (targets.length > CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS) {
    throw new Error(`${what}: bridge allowlist has ${targets.length} entries, max ${CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS}`);
  }
  const seen = new Set<string>();
  for (const raw of targets) {
    const entry = raw ?? "";
    if (new TextEncoder().encode(entry).length > CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE) {
      throw new Error(`${what}: bridge allowed target ${JSON.stringify(entry)} is longer than ${CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE} bytes`);
    }
    if (seen.has(entry)) throw new Error(`${what}: bridge allowed target ${JSON.stringify(entry)} is listed twice`);
    seen.add(entry);
    const i = entry.indexOf(":");
    const vm = i < 0 ? entry : entry.slice(0, i);
    const contract = i < 0 ? "" : entry.slice(i + 1);
    if (vm !== "cosmwasm") {
      throw new Error(`${what}: bridge allowed target ${JSON.stringify(entry)}: the bridge only calls cosmwasm contracts`);
    }
    if (!isValidBech32(contract, "qor")) throw new Error(`${what}: bridge allowed target ${JSON.stringify(entry)}: invalid contract address`);
  }
}

/**
 * The chain's checks on rdk `MsgUpdateParams`. `rollupCreationBurnRate` is a
 * decimal string in [0, 1); `defaultChallengeWindow` is 60 seconds to 30 days;
 * `maxDaBlobSize` is 1 byte to 8 MiB; every other value is positive.
 */
export function validateRdkUpdateParams(value: {
  authority?: string;
  maxRollups?: number;
  minStakeForRollup?: IntLike;
  rollupCreationBurnRate?: string;
  defaultChallengeWindow?: IntLike;
  maxDaBlobSize?: IntLike;
  blobRetentionBlocks?: IntLike;
  maxBatchesPerBlock?: number;
}): void {
  const what = "rdk updateParams";
  if (!value.authority) throw new Error(`${what}: authority (the governance module account) is required`);
  positive(value.maxRollups, "maxRollups", what);
  positive(value.minStakeForRollup, "minStakeForRollup", what);
  const rate = value.rollupCreationBurnRate ?? "";
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(rate.trim());
  if (!m || BigInt(m[1]) >= 1n) {
    throw new Error(`${what}: rollupCreationBurnRate must be a decimal in [0, 1), got ${JSON.stringify(rate)}`);
  }
  const window = positive(value.defaultChallengeWindow, "defaultChallengeWindow", what);
  if (window < BigInt(RDK_MIN_CHALLENGE_WINDOW_SEC) || window > BigInt(RDK_MAX_CHALLENGE_WINDOW_SEC)) {
    throw new Error(
      `${what}: defaultChallengeWindow must be ${RDK_MIN_CHALLENGE_WINDOW_SEC}..${RDK_MAX_CHALLENGE_WINDOW_SEC} seconds, got ${window}`,
    );
  }
  positive(value.maxDaBlobSize, "maxDaBlobSize", what, RDK_MAX_DA_BLOB_SIZE);
  positive(value.blobRetentionBlocks, "blobRetentionBlocks", what);
  positive(value.maxBatchesPerBlock, "maxBatchesPerBlock", what);
}
