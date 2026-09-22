/**
 * The EVM-lane post-quantum authorisation window (chain v3.2.0).
 *
 * From v3.2.0 an EVM transaction is admitted only from an account that holds a
 * registered ML-DSA key AND has opened a bounded authorisation window with a
 * Cosmos-lane message. The window is what stops the classical secp256k1 key
 * from moving value on its own: opening one requires the post-quantum key, so
 * a stolen classical key cannot authorise itself.
 *
 * The testnet (`qorechain-diana`) enforces this from its v3.2.0 upgrade;
 * mainnet from its own. Before those heights the messages, the query and this
 * module all work — only the refusal waits for the switch.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Three things that surprise people
 * ──────────────────────────────────────────────────────────────────────────
 *  1. **Opening a window advances the EVM nonce.** QoreChain unifies the
 *     identity, so the account's Cosmos sequence *is* its EVM nonce, and
 *     `MsgOpenEVMWindow` is an ordinary Cosmos transaction. Sign the EVM
 *     transaction *after* opening, or it is refused with "nonce too low". The
 *     order is: open → read the nonce → sign.
 *  2. **`maxValue` bounds value PLUS the maximum fee** each admitted
 *     transaction could pay (gas limit × gas fee cap), because the holder of
 *     the classical key chooses the gas price and a value-only bound would
 *     leave the account drainable through fees. A 1,000 uqor transfer with a
 *     21,000 gas limit at 112.5 gwei consumes 3,363 uqor of the window.
 *     Conversion from wei to uqor rounds **up**.
 *  3. **`blocks` is a block count, not a duration.** The chain's own constant
 *     is commented "about 24 hours at 5s blocks", but no QoreChain network runs
 *     at 5s: the maximum of 17,280 blocks is roughly 5 hours on the testnet
 *     (~1.03 s) and roughly 15 hours on mainnet (~3.1 s). Show "up to 17,280
 *     blocks", or compute a duration from the chain's recent block time —
 *     never print "24 hours".
 *
 * This module deliberately offers no "open a window automatically before
 * sending" helper. The window exists so that spending is authorised
 * deliberately; a wallet that opens one on every send turns that into a click
 * nobody reads. Surface {@link classifyEvmWindowRejection} to the user, then
 * let them authorise explicitly.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { pqc as pqcMsg } from "../messages/qorechain";
import type { FetchLike } from "../query/http";

/** The largest `blocks` the chain accepts (`MaxEVMWindowBlocks`). */
export const MAX_EVM_WINDOW_BLOCKS = 17280n;
/** The largest `maxTxs` the chain accepts (`MaxEVMWindowTxs`). */
export const MAX_EVM_WINDOW_TXS = 1000n;

/** Inputs for {@link openEvmWindowMsg}. Every field is required. */
export interface OpenEvmWindowParams {
  /** The account opening the window (`qor1…`), which is also the signer. */
  sender: string;
  /** How many blocks the window stays open: 1…{@link MAX_EVM_WINDOW_BLOCKS}. */
  blocks: number | bigint;
  /** How many EVM transactions it admits: 1…{@link MAX_EVM_WINDOW_TXS}. */
  maxTxs: number | bigint;
  /**
   * The total it may spend, in uqor — value PLUS the maximum fee of every
   * admitted transaction. Must be above 0.
   */
  maxValue: number | bigint | string;
}

function requireRange(name: string, value: bigint, max: bigint): void {
  if (value <= 0n) {
    throw new Error(
      `${name} must be greater than 0 (the chain refuses a window that admits nothing)`,
    );
  }
  if (value > max) {
    throw new Error(`${name} must be at most ${max}, got ${value}`);
  }
}

function toBigInt(name: string, v: number | bigint | string): bigint {
  try {
    const n = typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.trunc(v) : v.trim());
    return n;
  } catch {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(v)}`);
  }
}

/**
 * Build `MsgOpenEVMWindow`, checking the chain's bounds first so a mistake
 * fails here instead of costing a refused transaction.
 *
 * Remember that broadcasting this advances the account's EVM nonce.
 */
export function openEvmWindowMsg(params: OpenEvmWindowParams): EncodeObject {
  const blocks = toBigInt("blocks", params.blocks);
  const maxTxs = toBigInt("maxTxs", params.maxTxs);
  const maxValue = toBigInt("maxValue", params.maxValue);
  requireRange("blocks", blocks, MAX_EVM_WINDOW_BLOCKS);
  requireRange("maxTxs", maxTxs, MAX_EVM_WINDOW_TXS);
  if (maxValue <= 0n) {
    throw new Error("maxValue must be greater than 0 uqor (it bounds value plus the maximum fee)");
  }
  if (!params.sender) throw new Error("sender is required");
  return pqcMsg.openEvmWindow({
    sender: params.sender,
    blocks: blocks.toString(),
    maxTxs: maxTxs.toString(),
    maxValue: maxValue.toString(),
  });
}

/** Build `MsgCloseEVMWindow`. The revocation takes effect in the same block. */
export function closeEvmWindowMsg(sender: string): EncodeObject {
  if (!sender) throw new Error("sender is required");
  return pqcMsg.closeEvmWindow({ sender });
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
}

/** The chain sends every number as a JSON string; empty means zero. */
function big(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v.trim());
  throw new Error(`expected an integer, got ${JSON.stringify(v)}`);
}

/**
 * Read an account's window over REST. Answers `{ found: false }` rather than
 * failing when there is none, so it is safe to poll.
 *
 * @throws on a transport failure or an unparsable body.
 */
export async function fetchEvmWindow(opts: {
  /** The network's REST (LCD) base URL. */
  rest: string;
  /** The `qor1…` address to look up. */
  address: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}): Promise<EvmWindow> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/evm_window/${opts.address}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`evm_window query failed: HTTP ${res.status} from ${url}`);
  }
  const b = (await res.json()) as Record<string, unknown>;
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
  };
}

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

// Verified against the chain: the registered texts (x/pqc/types/errors.go) plus
// the wrapped ones the handlers add, because a transport may carry only one of
// the two. The missing-key check comes first: the chain raises it under BOTH
// code 26 (EVM lane) and code 28 (the MsgOpenEVMWindow handler), with different
// wording on each, so only the text identifies it.
const TEXTS: ReadonlyArray<[RegExp, EvmWindowRejection]> = [
  [/has no registered post-quantum key/i, "no-pqc-key"],
  [/does not admit this transaction/i, "exhausted"],
  [/EVM authorisation window exhausted/i, "exhausted"],
  [/no open EVM authorisation window/i, "no-window"],
  [/invalid EVM authorisation window/i, "invalid"],
  [/EVM sender is not established/i, "invalid"],
];

/**
 * Classify an EVM-lane refusal, or `undefined` when it is something else.
 *
 * Accepts a thrown broadcast error, a delivery result, or a plain `Error`: the
 * chain's codespace/code when they survive the transport, and otherwise the
 * chain's own message text, which is what arrives over EVM JSON-RPC.
 *
 * `no-pqc-key` is a different state from `no-window` and needs a different
 * remedy — register a key first — but the chain raises BOTH under `ErrNoEVMWindow`,
 * code 26 (verified in the ante handler, not the spec, which says 28). The code
 * alone therefore cannot tell them apart: the text is matched first, and the code
 * is only a fallback for when the transport drops the message.
 */
export function classifyEvmWindowRejection(x: unknown): EvmWindowRejection | undefined {
  if (x === null || x === undefined) return undefined;
  const o = x as {
    code?: unknown;
    codespace?: unknown;
    log?: unknown;
    rawLog?: unknown;
    message?: unknown;
    details?: unknown;
    shortMessage?: unknown;
  };
  const texts = [o.log, o.rawLog, o.message, o.details, o.shortMessage].filter(
    (t): t is string => typeof t === "string",
  );
  for (const t of texts) {
    for (const [re, kind] of TEXTS) if (re.test(t)) return kind;
  }
  if (o.codespace === "pqc") {
    switch (Number(o.code)) {
      case 26:
        return "no-window";
      case 27:
        return "exhausted";
      case 28:
        return "invalid";
      // 26 with no matching text: a window is missing, but it could also be a
      // missing key whose text did not survive. "no-window" is the safe report
      // — acting on it queries the window, which then shows the real state.
    }
  }
  return undefined;
}

/** True when the failure is the EVM lane refusing for want of a window. */
export function isEvmWindowRejection(x: unknown): boolean {
  return classifyEvmWindowRejection(x) !== undefined;
}
