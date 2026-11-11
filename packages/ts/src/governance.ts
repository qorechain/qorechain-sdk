/**
 * Client-side checks for the governance `MsgUpdateParams` of `x/crossvm`,
 * `x/rdk` and `x/svm`. Each replaces the module parameters wholesale and only
 * executes from a passed proposal (`authority` is the governance module
 * account): a field left out is set to zero, which for crossvm wipes the
 * bridge code pins and for svm removes the custody ceilings. So from chain
 * v3.2.8 the composers require EVERY field to be given explicitly (zero given
 * on purpose is fine), and the way to build a proposal is to copy the current
 * values and change only what you mean to change:
 * {@link crossvmUpdateParamsFromCurrent}, {@link rdkUpdateParamsFromCurrent}
 * and {@link svmUpdateParamsFromCurrent}.
 *
 * The checks mirror the chain's, so a proposal that would fail on execution is
 * refused before it is submitted.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { isValidBech32 } from "./utils/address";
import type { FetchLike } from "./query/http";
import * as crossvmTx from "./codegen/qorechain/crossvm/v1/tx";
import * as rdkTx from "./codegen/qorechain/rdk/v1/tx";
import * as svmTx from "./codegen/qorechain/svm/v1/tx";

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


/** A non-negative integer; when `range` is given, a non-zero value must lie in it (zero means the chain default). */
function zeroOrRange(v: IntLike, name: string, what: string, range?: [number, number]): bigint {
  let n: bigint;
  try {
    n = BigInt(v ?? 0);
  } catch {
    throw new Error(`${what}: ${name} must be a non-negative integer, got ${String(v)}`);
  }
  if (n < 0n) throw new Error(`${what}: ${name} must be a non-negative integer, got ${String(v)}`);
  if (range && n !== 0n && (n < BigInt(range[0]) || n > BigInt(range[1]))) {
    throw new Error(`${what}: ${name} must be 0 (the default) or ${range[0]}..${range[1]}, got ${n}`);
  }
  return n;
}

/** Throw naming every field of `fields` that `value` leaves out (undefined or null). */
function requireAll(value: object, fields: readonly string[], what: string): void {
  const v = value as Record<string, unknown>;
  const missing = fields.filter((f) => v[f] === undefined || v[f] === null);
  if (missing.length > 0) {
    throw new Error(
      `${what}: the message replaces the parameters wholesale, so every field must be given explicitly; missing: ` +
        `${missing.join(", ")}. Build it from the current values (e.g. ${what.split(" ")[0]}UpdateParamsFromCurrent) ` +
        "and change only what you mean to change",
    );
  }
}

/** Every field of crossvm `MsgUpdateParams` (fields 1..18). */
export const CROSSVM_UPDATE_PARAMS_FIELDS = [
  "authority",
  "maxMessageSize",
  "maxQueueSize",
  "queueTimeoutBlocks",
  "enabled",
  "bridgeAllowedTargets",
  "bridgeTargetPins",
  "maxPendingPerSender",
  "maxCosmosTxGas",
  "recordRetentionBlocks",
  "maxBlockWasmGas",
  "maxTxWasmShareBps",
  "maxBlockLevelWasmGas",
  "queueWasmReserveBps",
  "wasmCongestionMaxFactor",
  "wasmCongestionTargetBps",
  "maxBlockUploadBps",
  "maxQueueTimeoutsPerBlock",
] as const;

/** Every field of rdk `MsgUpdateParams` (fields 1..14). */
export const RDK_UPDATE_PARAMS_FIELDS = [
  "authority",
  "maxRollups",
  "minStakeForRollup",
  "rollupCreationBurnRate",
  "defaultChallengeWindow",
  "maxDaBlobSize",
  "blobRetentionBlocks",
  "maxBatchesPerBlock",
  "finalizedBatchRetentionBlocks",
  "maxPostedDataBytes",
  "maxPostedDataBytesPerBlock",
  "postedDataFeePerByte",
  "postedDataRetentionBlocks",
  "minSubmitterBond",
] as const;

/** Every field of svm `SVMParams` (fields 1..12). */
export const SVM_PARAMS_FIELDS = [
  "maxProgramSize",
  "maxAccountDataSize",
  "computeBudgetMax",
  "lamportsPerByte",
  "rentExemptionMulti",
  "enabled",
  "svmSlotOffset",
  "defaultSigScheme",
  "maxCpi",
  "maxCustodyUqor",
  "maxCustodyHardUqor",
  "maxAccountExcessUqor",
] as const;

/** A crossvm bridge pin as a composer accepts it. */
type PinInput = { target?: string; codeId?: IntLike; historyLen?: IntLike } | undefined;

/**
 * The chain's checks on crossvm `MsgUpdateParams`. Every field (1..18) must be
 * given explicitly. Each `bridgeAllowedTargets` entry is
 * `"cosmwasm:<contract>"` (the EVM bridge precompile only calls CosmWasm
 * contracts), at most 64 entries of at most 256 bytes, no duplicates; an empty
 * list keeps the bridge shut. Each `bridgeTargetPins` entry names a listed
 * target once, with a positive code id. The v3.2.8 limits take 0 for the
 * chain default, otherwise a value in their documented range.
 */
export function validateCrossVmUpdateParams(value: {
  authority?: string;
  maxMessageSize?: IntLike;
  maxQueueSize?: number;
  queueTimeoutBlocks?: IntLike;
  enabled?: boolean;
  bridgeAllowedTargets?: readonly (string | undefined)[];
  bridgeTargetPins?: readonly PinInput[];
  maxPendingPerSender?: number;
  maxCosmosTxGas?: IntLike;
  recordRetentionBlocks?: IntLike;
  maxBlockWasmGas?: IntLike;
  maxTxWasmShareBps?: number;
  maxBlockLevelWasmGas?: IntLike;
  queueWasmReserveBps?: number;
  wasmCongestionMaxFactor?: number;
  wasmCongestionTargetBps?: number;
  maxBlockUploadBps?: number;
  maxQueueTimeoutsPerBlock?: number;
}): void {
  const what = "crossvm updateParams";
  if (!value.authority) throw new Error(`${what}: authority (the governance module account) is required`);
  requireAll(value, CROSSVM_UPDATE_PARAMS_FIELDS, what);
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
  const pinned = new Set<string>();
  for (const pin of value.bridgeTargetPins ?? []) {
    const target = pin?.target ?? "";
    if (!seen.has(target)) {
      throw new Error(`${what}: bridge target pin ${JSON.stringify(target)} is not in bridgeAllowedTargets`);
    }
    if (pinned.has(target)) throw new Error(`${what}: bridge target ${JSON.stringify(target)} is pinned twice`);
    pinned.add(target);
    positive(pin?.codeId, `bridgeTargetPins[${JSON.stringify(target)}].codeId`, what);
    positive(pin?.historyLen, `bridgeTargetPins[${JSON.stringify(target)}].historyLen`, what);
  }
  zeroOrRange(value.maxPendingPerSender, "maxPendingPerSender", what);
  zeroOrRange(value.maxCosmosTxGas, "maxCosmosTxGas", what, [10_000_000, 1_000_000_000]);
  zeroOrRange(value.recordRetentionBlocks, "recordRetentionBlocks", what);
  zeroOrRange(value.maxBlockWasmGas, "maxBlockWasmGas", what, [1_000_000, 50_000_000]);
  zeroOrRange(value.maxTxWasmShareBps, "maxTxWasmShareBps", what, [1, 10_000]);
  zeroOrRange(value.maxBlockLevelWasmGas, "maxBlockLevelWasmGas", what, [1_000_000, 100_000_000]);
  zeroOrRange(value.queueWasmReserveBps, "queueWasmReserveBps", what, [1, 9_000]);
  zeroOrRange(value.wasmCongestionMaxFactor, "wasmCongestionMaxFactor", what, [1, 10_000]);
  zeroOrRange(value.wasmCongestionTargetBps, "wasmCongestionTargetBps", what, [1, 10_000]);
  zeroOrRange(value.maxBlockUploadBps, "maxBlockUploadBps", what, [1, 10_000]);
  zeroOrRange(value.maxQueueTimeoutsPerBlock, "maxQueueTimeoutsPerBlock", what, [1, 1_000]);
}

/**
 * The chain's checks on rdk `MsgUpdateParams`. Every field (1..14) must be
 * given explicitly. `rollupCreationBurnRate` is a decimal string in [0, 1);
 * `defaultChallengeWindow` is 60 seconds to 30 days; `maxDaBlobSize` is 1 byte
 * to 8 MiB; the v3.2.7 values are positive; the v3.2.8 values
 * (`finalizedBatchRetentionBlocks`, the posted-data values,
 * `minSubmitterBond`) take 0 for the chain default.
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
  finalizedBatchRetentionBlocks?: IntLike;
  maxPostedDataBytes?: IntLike;
  maxPostedDataBytesPerBlock?: IntLike;
  postedDataFeePerByte?: IntLike;
  postedDataRetentionBlocks?: IntLike;
  minSubmitterBond?: IntLike;
}): void {
  const what = "rdk updateParams";
  if (!value.authority) throw new Error(`${what}: authority (the governance module account) is required`);
  requireAll(value, RDK_UPDATE_PARAMS_FIELDS, what);
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
  zeroOrRange(value.finalizedBatchRetentionBlocks, "finalizedBatchRetentionBlocks", what);
  zeroOrRange(value.maxPostedDataBytes, "maxPostedDataBytes", what);
  zeroOrRange(value.maxPostedDataBytesPerBlock, "maxPostedDataBytesPerBlock", what);
  zeroOrRange(value.postedDataFeePerByte, "postedDataFeePerByte", what);
  zeroOrRange(value.postedDataRetentionBlocks, "postedDataRetentionBlocks", what);
  zeroOrRange(value.minSubmitterBond, "minSubmitterBond", what);
}

/**
 * The checks on svm `MsgUpdateParams`: `authority` and `params` are required
 * and every `SVMParams` field (1..12) must be given explicitly, because the
 * message replaces the params wholesale and a left-out custody ceiling would
 * become 0 (no ceiling). `enabled = true` with `maxCustodyHardUqor = 0` is
 * refused: governance must set a hard custody ceiling before opening the lane.
 */
export function validateSvmUpdateParams(value: {
  authority?: string;
  params?: { [K in (typeof SVM_PARAMS_FIELDS)[number]]?: unknown } | undefined;
}): void {
  const what = "svm updateParams";
  if (!value.authority) throw new Error(`${what}: authority (the governance module account) is required`);
  if (!value.params) {
    throw new Error(`${what}: params is required; the message replaces every SVM parameter (build it with svmUpdateParamsFromCurrent)`);
  }
  requireAll(value.params, SVM_PARAMS_FIELDS, what);
  const p = value.params;
  for (const f of ["maxCustodyUqor", "maxCustodyHardUqor", "maxAccountExcessUqor"] as const) {
    zeroOrRange(p[f] as IntLike, f, what);
  }
  if (p.enabled === true && BigInt((p.maxCustodyHardUqor as IntLike) ?? 0) === 0n) {
    throw new Error(`${what}: governance must set a hard custody ceiling before opening the lane (enabled = true needs maxCustodyHardUqor > 0)`);
  }
}

// ---- copy-from-query builders ------------------------------------------

type Raw = Record<string, unknown>;

/** Read `snake` (REST) or its camelCase form from a JSON object. */
function pick(o: Raw, snake: string): unknown {
  if (o[snake] !== undefined) return o[snake];
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return o[camel];
}
const asStr = (v: unknown): string => (v === undefined || v === null || v === "" ? "0" : String(v));
const asNum = (v: unknown): number => (v === undefined || v === null || v === "" ? 0 : Number(v));

async function getParamsJson(opts: { rest: string; fetch?: FetchLike }, path: string): Promise<Raw> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}${path}`;
  const res = await f(url);
  if (!res.ok) throw new Error(`params query failed: HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== "object") throw new Error(`params query returned no JSON object from ${url}`);
  return body as Raw;
}

/** The crossvm `MsgUpdateParams` fields without `authority`. */
export type CrossVmParamsInput = Omit<crossvmTx.MsgUpdateParams, "authority">;

/**
 * Read the crossvm parameters in force (`GET /qorechain/crossvm/v1/params`)
 * in the shape `MsgUpdateParams` takes. The query lists the values IN FORCE,
 * with the chain defaults substituted for a stored zero, so copying them into
 * a proposal keeps the current behaviour.
 */
export async function fetchCrossVmUpdateParams(opts: { rest: string; fetch?: FetchLike }): Promise<CrossVmParamsInput> {
  const body = await getParamsJson(opts, "/qorechain/crossvm/v1/params");
  const o = (body.params && typeof body.params === "object" && pick(body, "max_message_size") === undefined
    ? (body.params as Raw)
    : body);
  const pins = Array.isArray(pick(o, "bridge_target_pins")) ? (pick(o, "bridge_target_pins") as Raw[]) : [];
  return {
    maxMessageSize: asStr(pick(o, "max_message_size")),
    maxQueueSize: asNum(pick(o, "max_queue_size")),
    queueTimeoutBlocks: asStr(pick(o, "queue_timeout_blocks")),
    enabled: pick(o, "enabled") === true,
    bridgeAllowedTargets: ((pick(o, "bridge_allowed_targets") as unknown[]) ?? []).map(String),
    bridgeTargetPins: pins.map((p) => ({
      target: String(pick(p, "target") ?? ""),
      codeId: asStr(pick(p, "code_id")),
      historyLen: asStr(pick(p, "history_len")),
    })),
    maxPendingPerSender: asNum(pick(o, "max_pending_per_sender")),
    maxCosmosTxGas: asStr(pick(o, "max_cosmos_tx_gas")),
    recordRetentionBlocks: asStr(pick(o, "record_retention_blocks")),
    maxBlockWasmGas: asStr(pick(o, "max_block_wasm_gas")),
    maxTxWasmShareBps: asNum(pick(o, "max_tx_wasm_share_bps")),
    maxBlockLevelWasmGas: asStr(pick(o, "max_block_level_wasm_gas")),
    queueWasmReserveBps: asNum(pick(o, "queue_wasm_reserve_bps")),
    wasmCongestionMaxFactor: asNum(pick(o, "wasm_congestion_max_factor")),
    wasmCongestionTargetBps: asNum(pick(o, "wasm_congestion_target_bps")),
    maxBlockUploadBps: asNum(pick(o, "max_block_upload_bps")),
    maxQueueTimeoutsPerBlock: asNum(pick(o, "max_queue_timeouts_per_block")),
  };
}

/**
 * Build a crossvm `MsgUpdateParams` for a governance proposal from the
 * parameters in force plus `changes`: every field is copied from
 * `/qorechain/crossvm/v1/params` and only the fields in `changes` differ. This
 * is the way to build a crossvm params proposal; the result is checked
 * ({@link validateCrossVmUpdateParams}).
 */
export async function crossvmUpdateParamsFromCurrent(opts: {
  rest: string;
  fetch?: FetchLike;
  /** The governance module account. */
  authority: string;
  changes?: Partial<CrossVmParamsInput>;
}): Promise<EncodeObject> {
  const current = await fetchCrossVmUpdateParams(opts);
  const value = { ...current, ...(opts.changes ?? {}), authority: opts.authority };
  validateCrossVmUpdateParams(value);
  return { typeUrl: "/qorechain.crossvm.v1.MsgUpdateParams", value: crossvmTx.MsgUpdateParams.fromPartial(value) };
}

/** The rdk `MsgUpdateParams` fields without `authority`. */
export type RdkParamsInput = Omit<rdkTx.MsgUpdateParams, "authority">;

/**
 * Read the rdk parameters (`GET /qorechain/rdk/v1/params`, `{ params }`) in
 * the shape `MsgUpdateParams` takes. The v3.2.8 values are the effective ones
 * (defaults filled in for a stored zero).
 */
export async function fetchRdkUpdateParams(opts: { rest: string; fetch?: FetchLike }): Promise<RdkParamsInput> {
  const body = await getParamsJson(opts, "/qorechain/rdk/v1/params");
  const o = (body.params && typeof body.params === "object" ? body.params : body) as Raw;
  return {
    maxRollups: asNum(pick(o, "max_rollups")),
    minStakeForRollup: asStr(pick(o, "min_stake_for_rollup")),
    rollupCreationBurnRate: String(pick(o, "rollup_creation_burn_rate") ?? ""),
    defaultChallengeWindow: asStr(pick(o, "default_challenge_window")),
    maxDaBlobSize: asStr(pick(o, "max_da_blob_size")),
    blobRetentionBlocks: asStr(pick(o, "blob_retention_blocks")),
    maxBatchesPerBlock: asNum(pick(o, "max_batches_per_block")),
    finalizedBatchRetentionBlocks: asStr(pick(o, "finalized_batch_retention_blocks")),
    maxPostedDataBytes: asStr(pick(o, "max_posted_data_bytes")),
    maxPostedDataBytesPerBlock: asStr(pick(o, "max_posted_data_bytes_per_block")),
    postedDataFeePerByte: asStr(pick(o, "posted_data_fee_per_byte")),
    postedDataRetentionBlocks: asStr(pick(o, "posted_data_retention_blocks")),
    minSubmitterBond: asStr(pick(o, "min_submitter_bond")),
  };
}

/**
 * Build an rdk `MsgUpdateParams` for a governance proposal from the current
 * parameters (`/qorechain/rdk/v1/params`) plus `changes`. The way to build an
 * rdk params proposal; the result is checked ({@link validateRdkUpdateParams}).
 */
export async function rdkUpdateParamsFromCurrent(opts: {
  rest: string;
  fetch?: FetchLike;
  authority: string;
  changes?: Partial<RdkParamsInput>;
}): Promise<EncodeObject> {
  const current = await fetchRdkUpdateParams(opts);
  const value = { ...current, ...(opts.changes ?? {}), authority: opts.authority };
  validateRdkUpdateParams(value);
  return { typeUrl: "/qorechain.rdk.v1.MsgUpdateParams", value: rdkTx.MsgUpdateParams.fromPartial(value) };
}

/**
 * Build an svm `MsgUpdateParams` from the current `SVMParams` plus `changes`.
 *
 * The svm module serves no params REST route in the v3.2.8 query service, so
 * `current` is supplied by the caller (for example the params of the last
 * passed svm proposal, or the node's exported genesis/app state). Every field
 * of `current` must be present; the result is checked
 * ({@link validateSvmUpdateParams}).
 */
export function svmUpdateParamsFromCurrent(opts: {
  authority: string;
  current: svmTx.SVMParams;
  changes?: Partial<svmTx.SVMParams>;
}): EncodeObject {
  const value = { authority: opts.authority, params: { ...opts.current, ...(opts.changes ?? {}) } };
  validateSvmUpdateParams(value);
  return { typeUrl: "/qorechain.svm.v1.MsgUpdateParams", value: svmTx.MsgUpdateParams.fromPartial(value) };
}
