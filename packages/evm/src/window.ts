/**
 * The EVM authorisation window, seen from the EVM lane.
 *
 * On QoreChain an EVM transaction is admitted only from an account that has a
 * registered ML-DSA-87 key AND a live authorisation window (protocol feature
 * `evm-pqc-authorisation-window`, on both public networks). The window is
 * opened by a native-lane message, `MsgOpenEVMWindow`, which must be signed
 * hybrid (secp256k1 + ML-DSA-87): the classical key alone can never authorise
 * EVM spending. Foundry, Hardhat, viem or ethers then send as usual until the
 * window runs out of blocks, transactions or value.
 *
 * This module has no native-lane dependencies. It reads the window over REST
 * ({@link evmWindowStatus}), checks and composes the opening message
 * ({@link openEvmWindowMessage}) as a plain `{ typeUrl, value }` object, and
 * classifies a refusal ({@link classifyEvmWindowRejection}). Signing and
 * broadcasting the message is done on the native lane, for example with
 * `@qorechain/sdk` (`EthNativeSigner` or a hybrid `TxClient`), which re-exports
 * all of this.
 *
 * Three things that surprise people:
 *  1. Opening a window advances the EVM nonce. The identity is unified, so the
 *     account's native sequence is its EVM nonce. Open, then read the nonce,
 *     then sign the EVM transaction.
 *  2. `maxValue` bounds value PLUS the maximum fee of every admitted
 *     transaction (gas limit x gas fee cap), in uqor. Wei converts to uqor
 *     rounding up (1 uqor = 10^12 wei).
 *  3. `blocks` is a block count, not a duration. Compute a duration from the
 *     network's recent block time if you need one.
 *
 * There is deliberately no "open a window automatically before sending"
 * helper: the window exists so that spending is authorised on purpose.
 */

/** The type URL of the native-lane message that opens a window. */
export const OPEN_EVM_WINDOW_TYPE_URL = "/qorechain.pqc.v1.MsgOpenEVMWindow";
/** The type URL of the native-lane message that closes a window. */
export const CLOSE_EVM_WINDOW_TYPE_URL = "/qorechain.pqc.v1.MsgCloseEVMWindow";

/** The largest `blocks` the chain accepts (`MaxEVMWindowBlocks`). */
export const MAX_EVM_WINDOW_BLOCKS = 17280n;
/** The largest `maxTxs` the chain accepts (`MaxEVMWindowTxs`). */
export const MAX_EVM_WINDOW_TXS = 1000n;
/** The most `allowedTargets` one window may list (`MaxEVMWindowTargets`, chain v3.2.3). */
export const MAX_EVM_WINDOW_TARGETS = 16;

/** Inputs for {@link openEvmWindowMessage}. */
export interface OpenEvmWindowParams {
  /** The account opening the window (`qor1...`), which is also the signer. */
  sender: string;
  /** How many blocks the window stays open: 1 to {@link MAX_EVM_WINDOW_BLOCKS}. */
  blocks: number | bigint;
  /** How many EVM transactions it admits: 1 to {@link MAX_EVM_WINDOW_TXS}. */
  maxTxs: number | bigint;
  /**
   * The total it may spend, in uqor: value PLUS the maximum fee of every
   * admitted transaction. Must be above 0.
   */
  maxValue: number | bigint | string;
  /**
   * Narrow the window to plain transfers of native QOR: no calldata, no
   * contract creation, no recipient that carries code, no EIP-7702
   * authorizations (chain v3.2.3). A node below v3.2.3 refuses the whole
   * transaction when it is set.
   */
  nativeOnly?: boolean;
  /**
   * Narrow the window to transactions whose recipient is one of these 0x
   * addresses (at most {@link MAX_EVM_WINDOW_TARGETS}, no duplicates);
   * contract creation is refused (chain v3.2.3). Same caveat as `nativeOnly`.
   */
  allowedTargets?: readonly string[];
}

/**
 * The checked fields of `MsgOpenEVMWindow`, in the camelCase JSON shape the
 * protobuf codecs of `@qorechain/sdk` (and cosmjs registries generally) take.
 * Integers are decimal strings.
 */
export interface OpenEvmWindowValue {
  sender: string;
  blocks: string;
  maxTxs: string;
  maxValue: string;
  nativeOnly: boolean;
  allowedTargets: string[];
}

/** A composed native-lane message, ready for a registry to encode. */
export interface OpenEvmWindowMessage {
  typeUrl: typeof OPEN_EVM_WINDOW_TYPE_URL;
  value: OpenEvmWindowValue;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function checkTargets(targets: readonly string[]): string[] {
  if (targets.length > MAX_EVM_WINDOW_TARGETS) {
    throw new Error(`allowedTargets lists ${targets.length} addresses, the maximum is ${MAX_EVM_WINDOW_TARGETS}`);
  }
  const seen = new Set<string>();
  return targets.map((t) => {
    if (typeof t !== "string" || !ADDRESS.test(t)) {
      throw new Error(`allowedTargets: ${JSON.stringify(t)} is not a 0x-prefixed 20-byte address`);
    }
    const lower = t.toLowerCase();
    if (seen.has(lower)) throw new Error(`allowedTargets lists ${t} more than once`);
    seen.add(lower);
    return t;
  });
}

function requireRange(name: string, value: bigint, max: bigint): void {
  if (value <= 0n) {
    throw new Error(`${name} must be greater than 0 (the chain refuses a window that admits nothing)`);
  }
  if (value > max) {
    throw new Error(`${name} must be at most ${max}, got ${value}`);
  }
}

function toBigInt(name: string, v: number | bigint | string): bigint {
  try {
    return typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.trunc(v) : v.trim());
  } catch {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(v)}`);
  }
}

/**
 * Check the window parameters against the chain's bounds and return the
 * message fields, so a mistake fails here instead of costing a refused
 * transaction.
 *
 * @throws when a bound is violated or a field is malformed.
 */
export function checkOpenEvmWindowParams(params: OpenEvmWindowParams): OpenEvmWindowValue {
  const blocks = toBigInt("blocks", params.blocks);
  const maxTxs = toBigInt("maxTxs", params.maxTxs);
  const maxValue = toBigInt("maxValue", params.maxValue);
  requireRange("blocks", blocks, MAX_EVM_WINDOW_BLOCKS);
  requireRange("maxTxs", maxTxs, MAX_EVM_WINDOW_TXS);
  if (maxValue <= 0n) {
    throw new Error("maxValue must be greater than 0 uqor (it bounds value plus the maximum fee)");
  }
  if (!params.sender) throw new Error("sender is required");
  return {
    sender: params.sender,
    blocks: blocks.toString(),
    maxTxs: maxTxs.toString(),
    maxValue: maxValue.toString(),
    nativeOnly: params.nativeOnly === true,
    allowedTargets: checkTargets(params.allowedTargets ?? []),
  };
}

/**
 * Compose the native-lane `MsgOpenEVMWindow` that opens the sender's EVM
 * authorisation window, after checking the chain's bounds.
 *
 * The result is a plain `{ typeUrl, value }`. Sign it hybrid on the native lane
 * (for example `EthNativeSigner.signAndBroadcast` in `@qorechain/sdk`, whose
 * registry encodes it), then read the EVM nonce: broadcasting advances it.
 */
export function openEvmWindowMessage(params: OpenEvmWindowParams): OpenEvmWindowMessage {
  return { typeUrl: OPEN_EVM_WINDOW_TYPE_URL, value: checkOpenEvmWindowParams(params) };
}

/** Wei to uqor, rounding up, the way the chain charges a window. */
export function weiToUqorCeil(wei: bigint): bigint {
  if (wei < 0n) throw new Error("wei must not be negative");
  return (wei + 999_999_999_999n) / 1_000_000_000_000n;
}

/**
 * How much of a window one EVM transaction can consume, in uqor:
 * `value + gasLimit * maxFeePerGas`, converted from wei rounding up. Use it to
 * size `maxValue`.
 */
export function evmWindowCost(tx: { value?: bigint; gas: bigint; maxFeePerGas: bigint }): bigint {
  return weiToUqorCeil((tx.value ?? 0n) + tx.gas * tx.maxFeePerGas);
}

/** An account's EVM authorisation window as the chain reports it. */
export interface EvmWindow {
  /** Whether a window is stored. A stored window may be expired or exhausted. */
  found: boolean;
  /** Whether it admits at least one more zero-value transaction right now. */
  live: boolean;
  openedHeight: bigint;
  expiryHeight: bigint;
  maxTxs: bigint;
  usedTxs: bigint;
  /** uqor. */
  maxValue: bigint;
  /** uqor. */
  usedValue: bigint;
  remainingBlocks: bigint;
  remainingTxs: bigint;
  /** uqor. */
  remainingValue: bigint;
  /** The window admits only plain native transfers (chain v3.2.3; false before). */
  nativeOnly: boolean;
  /** The recipients the window is narrowed to; empty means any (chain v3.2.3). */
  allowedTargets: string[];
}

/** A minimal `fetch` shape, so a caller can inject one. */
export type WindowFetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The chain sends every number as a JSON string; empty means zero. */
function big(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v.trim());
  throw new Error(`expected an integer, got ${JSON.stringify(v)}`);
}

/** Parse the REST answer of `/qorechain/pqc/v1/evm_window/{address}`. */
export function parseEvmWindow(body: unknown): EvmWindow {
  const b = (body ?? {}) as Record<string, unknown>;
  const targets = b.allowed_targets ?? b.allowedTargets;
  return {
    found: b.found === true,
    live: b.live === true,
    openedHeight: big(b.opened_height ?? b.openedHeight),
    expiryHeight: big(b.expiry_height ?? b.expiryHeight),
    maxTxs: big(b.max_txs ?? b.maxTxs),
    usedTxs: big(b.used_txs ?? b.usedTxs),
    maxValue: big(b.max_value ?? b.maxValue),
    usedValue: big(b.used_value ?? b.usedValue),
    remainingBlocks: big(b.remaining_blocks ?? b.remainingBlocks),
    remainingTxs: big(b.remaining_txs ?? b.remainingTxs),
    remainingValue: big(b.remaining_value ?? b.remainingValue),
    nativeOnly: (b.native_only ?? b.nativeOnly) === true,
    allowedTargets: Array.isArray(targets)
      ? (targets as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  };
}

/** Options for {@link evmWindowStatus}. */
export interface EvmWindowStatusOptions {
  /**
   * The network's REST (LCD) base URL, for example `https://api-testnet.qore.host`
   * (see `QORECHAIN_REST_ENDPOINTS`).
   */
  rest: string;
  /**
   * The account: its `qor1...` address. A `0x` address is accepted too when
   * the account is eth-native (the same 20 bytes); it is converted with
   * `toQorAddress`.
   */
  address: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: WindowFetchLike;
}

/**
 * Read an account's EVM authorisation window over REST
 * (`/qorechain/pqc/v1/evm_window/{address}`). Answers `{ found: false }`
 * rather than failing when there is none, so it is safe to poll.
 *
 * @throws on a transport failure or an unparsable body.
 */
export async function evmWindowStatus(opts: EvmWindowStatusOptions): Promise<EvmWindow> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as WindowFetchLike);
  const address = opts.address.startsWith("0x") ? toQorAddress(opts.address) : opts.address;
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/evm_window/${address}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`evm_window query failed: HTTP ${res.status} from ${url}`);
  }
  return parseEvmWindow(await res.json());
}

// ---------------------------------------------------------------------------
// 0x <-> qor1 for eth-native accounts: the same 20 bytes, two encodings.
// A tiny BIP-173 bech32 encoder, so this package keeps no extra dependency.
// ---------------------------------------------------------------------------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  if (!pad && (bits >= from || ((acc << (to - bits)) & maxv) !== 0)) {
    throw new Error("invalid bech32 padding");
  }
  return out;
}

/**
 * The `qor1...` form of a `0x` address: the same 20 bytes. For an eth-native
 * account (one key on every lane) both name the same account and balance.
 */
export function toQorAddress(evmAddress: string, prefix = "qor"): string {
  if (!ADDRESS.test(evmAddress)) throw new Error(`${evmAddress} is not a 0x-prefixed 20-byte address`);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(evmAddress.slice(2 + i * 2, 4 + i * 2), 16);
  const words = convertBits(bytes, 8, 5, true);
  const mod = polymod([...hrpExpand(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

/** The lowercase `0x` form of a 20-byte `qor1...` address. */
export function toEvmAddress(qorAddress: string): `0x${string}` {
  const lower = qorAddress.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1) throw new Error(`${qorAddress} is not a bech32 address`);
  const hrp = lower.slice(0, sep);
  const data = Array.from(lower.slice(sep + 1), (c) => {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`${qorAddress} has an invalid bech32 character`);
    return v;
  });
  if (data.length < 6 || polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Error(`${qorAddress} has an invalid bech32 checksum`);
  }
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (bytes.length !== 20) throw new Error(`${qorAddress} does not hold 20 bytes`);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** Why the EVM lane refused a transaction, when it did. */
export type EvmWindowRejection =
  /** No window is open. Remedy: open one. */
  | "no-window"
  /** The window ran out of transactions, value, or blocks. Remedy: open a new one. */
  | "exhausted"
  /** The window parameters were refused. Remedy: fix the bounds. */
  | "invalid"
  /** The account has no registered PQC key at all. Remedy: register one FIRST. */
  | "no-pqc-key";

// The chain's registered texts plus the wrapped ones its handlers add, because
// a transport may carry only one of the two. The missing-key check comes first:
// the chain raises it under both code 26 (EVM lane) and code 28 (the
// MsgOpenEVMWindow handler), with different wording, so only the text tells.
const TEXTS: ReadonlyArray<[RegExp, EvmWindowRejection]> = [
  [/has no registered post-quantum key/i, "no-pqc-key"],
  [/does not admit this transaction/i, "exhausted"],
  [/EVM authorisation window exhausted/i, "exhausted"],
  [/no open EVM authorisation window/i, "no-window"],
  [/invalid EVM authorisation window/i, "invalid"],
  [/EVM sender is not established/i, "invalid"],
];

/** Collect the message texts of an error and its `cause` chain (viem nests them). */
function texts(x: unknown, depth = 0): string[] {
  if (x === null || x === undefined || depth > 5) return [];
  if (typeof x === "string") return [x];
  if (typeof x !== "object") return [];
  const o = x as Record<string, unknown>;
  const own = [o.log, o.rawLog, o.message, o.details, o.shortMessage].filter(
    (t): t is string => typeof t === "string",
  );
  return [...own, ...texts(o.cause, depth + 1)];
}

/**
 * Classify an EVM-lane refusal, or `undefined` when it is something else.
 *
 * Accepts a thrown viem / ethers error (the chain's text arrives over
 * JSON-RPC), a native-lane delivery result (`code` / `codespace` / `rawLog`),
 * or a plain string.
 */
export function classifyEvmWindowRejection(x: unknown): EvmWindowRejection | undefined {
  if (x === null || x === undefined) return undefined;
  for (const t of texts(x)) {
    for (const [re, kind] of TEXTS) if (re.test(t)) return kind;
  }
  const o = x as { code?: unknown; codespace?: unknown };
  if (typeof x === "object" && o.codespace === "pqc") {
    switch (Number(o.code)) {
      case 26:
        // A window is missing, or a missing key whose text did not survive.
        // "no-window" is the safe report: acting on it reads the window.
        return "no-window";
      case 27:
        return "exhausted";
      case 28:
        return "invalid";
    }
  }
  return undefined;
}

/** True when the failure is the EVM lane refusing for want of a key or window. */
export function isEvmWindowRejection(x: unknown): boolean {
  return classifyEvmWindowRejection(x) !== undefined;
}
