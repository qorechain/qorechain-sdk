/**
 * Post-quantum consent for EIP-7702 delegations (chain v3.2.2).
 *
 * An EIP-7702 authorization tuple installs code on the account that signed it,
 * and the tuple is signed with the classical secp256k1 key alone. Once the
 * delegation is installed, that code acts for the account. So from v3.2.2 the
 * EVM lane admits a type-4 transaction only if every account whose tuple would
 * take effect holds a registered post-quantum key AND has consented, with a
 * Cosmos-lane message signed by that key, to exactly the delegate the tuple
 * names. Clearing a delegation (the zero address) needs consent too.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  How a delegation goes through
 * ──────────────────────────────────────────────────────────────────────────
 *  1. Broadcast {@link authorizeEvmDelegationMsg} (Cosmos lane, hybrid
 *     signature). This ADVANCES the account's nonce: the Cosmos sequence and
 *     the EVM nonce are one counter.
 *  2. Read {@link fetchEvmDelegationConsent}. Its `nonce` is the account's EVM
 *     nonce NOW, after the consent.
 *  3. Sign the authorization tuple with that nonce if someone else sponsors the
 *     type-4 transaction, or with `nonce + 1` if the account sends the type-4
 *     transaction itself (the transaction's own nonce is consumed first).
 *  4. Send the type-4 transaction. The sender still needs an open EVM window;
 *     a sponsor pays from its own.
 *
 * The consent is used up by the transaction that installs the delegation, it
 * expires after `blocks`, a new one replaces the old, and
 * `MsgCloseEVMWindow` revokes it. {@link clearEvmDelegationMsg} removes an
 * installed delegation directly, without any EVM transaction.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { pqc as pqcMsg } from "../messages/qorechain";
import type { FetchLike } from "../query/http";
import { MAX_EVM_WINDOW_BLOCKS } from "./evm-window";

/** The longest a consent may wait to be used, in blocks (the window's bound). */
export const MAX_EVM_DELEGATION_CONSENT_BLOCKS = MAX_EVM_WINDOW_BLOCKS;

/** The delegate to consent to when the intent is to CLEAR the delegation. */
export const EVM_DELEGATION_CLEAR = "0x0000000000000000000000000000000000000000";

/** The most authorization tuples the EVM lane accepts in one type-4 transaction. */
export const MAX_EVM_AUTHORIZATIONS_PER_TX = 8;

/** Inputs for {@link authorizeEvmDelegationMsg}. */
export interface AuthorizeEvmDelegationParams {
  /** The account consenting (`qor1…`), which is also the signer. */
  sender: string;
  /**
   * The 0x-prefixed 20-byte address the authorization tuple will name, or
   * {@link EVM_DELEGATION_CLEAR} to consent to clearing the delegation.
   */
  delegate: string;
  /** How long the consent stays usable: 1…{@link MAX_EVM_DELEGATION_CONSENT_BLOCKS}. */
  blocks: number | bigint;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Build `MsgAuthorizeEVMDelegation`, checking the chain's bounds first.
 *
 * The delegate is sent lower-cased. The chain compares case-insensitively, so
 * this changes nothing on chain; it keeps the message identical across clients.
 */
export function authorizeEvmDelegationMsg(params: AuthorizeEvmDelegationParams): EncodeObject {
  if (!params.sender) throw new Error("sender is required");
  if (typeof params.delegate !== "string" || !ADDRESS.test(params.delegate)) {
    throw new Error(
      `delegate must be a 0x-prefixed 20-byte address (use EVM_DELEGATION_CLEAR to consent to clearing), got ${JSON.stringify(params.delegate)}`,
    );
  }
  let blocks: bigint;
  try {
    blocks = BigInt(params.blocks);
  } catch {
    throw new Error(`blocks must be an integer, got ${JSON.stringify(params.blocks)}`);
  }
  if (blocks <= 0n) throw new Error("blocks must be greater than 0");
  if (blocks > MAX_EVM_DELEGATION_CONSENT_BLOCKS) {
    throw new Error(`blocks must be at most ${MAX_EVM_DELEGATION_CONSENT_BLOCKS}, got ${blocks}`);
  }
  return pqcMsg.authorizeEvmDelegation({
    sender: params.sender,
    delegate: params.delegate.toLowerCase(),
    blocks: blocks.toString(),
  });
}

/** Build `MsgClearEVMDelegation`: remove the sender's installed delegation. */
export function clearEvmDelegationMsg(sender: string): EncodeObject {
  if (!sender) throw new Error("sender is required");
  return pqcMsg.clearEvmDelegation({ sender });
}

/** An account's delegation consent, and what a client needs to sign the tuple. */
export interface EvmDelegationConsent {
  /** Whether a consent is stored. A stored consent may be expired. */
  found: boolean;
  /** Whether it can still be used at the current height. */
  live: boolean;
  /** The 0x address the consent names, lower case; the zero address means clearing. */
  delegate: string;
  grantedHeight: bigint;
  expiryHeight: bigint;
  /** The delegation installed on the account now; empty when there is none. */
  currentDelegate: string;
  /**
   * The account's EVM nonce now. A tuple for a SPONSORED transaction carries
   * this; one in the account's OWN type-4 transaction carries `nonce + 1n`.
   */
  nonce: bigint;
}

function big(v: unknown): bigint {
  if (v === undefined || v === null || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v.trim());
  throw new Error(`expected an integer, got ${JSON.stringify(v)}`);
}

/**
 * Read an account's delegation consent over REST. Answers `{ found: false }`
 * rather than failing when there is none.
 *
 * The endpoint exists from chain v3.2.2; an older node answers 404 or 501,
 * which this reports as an error rather than as "no consent".
 *
 * @throws on a transport failure or an unparsable body.
 */
export async function fetchEvmDelegationConsent(opts: {
  /** The network's REST (LCD) base URL. */
  rest: string;
  /** `qor1…` or 0x address. */
  address: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}): Promise<EvmDelegationConsent> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/evm_delegation_consent/${opts.address}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`evm_delegation_consent query failed: HTTP ${res.status} from ${url}`);
  }
  const b = (await res.json()) as Record<string, unknown>;
  return {
    found: b.found === true,
    live: b.live === true,
    delegate: typeof b.delegate === "string" ? b.delegate : "",
    grantedHeight: big(b.granted_height ?? b.grantedHeight),
    expiryHeight: big(b.expiry_height ?? b.expiryHeight),
    currentDelegate:
      typeof (b.current_delegate ?? b.currentDelegate) === "string"
        ? ((b.current_delegate ?? b.currentDelegate) as string)
        : "",
    nonce: big(b.nonce),
  };
}

/**
 * The nonce an authorization tuple must carry, from a consent read AFTER the
 * consent message was included.
 *
 * @param sponsored `true` when another account sends the type-4 transaction.
 */
export function evmDelegationTupleNonce(consent: EvmDelegationConsent, sponsored: boolean): bigint {
  return sponsored ? consent.nonce : consent.nonce + 1n;
}

/** Why the chain refused a delegation, when it did. */
export type EvmDelegationRejection =
  /** No live consent for that delegate. Remedy: consent first (or again, if it expired or was used). */
  | "no-consent"
  /** The consent or clear request was malformed, or the account has no PQC key. */
  | "invalid";

// x/pqc errors 60 and 61 (chain v3.2.2). Text first, as for the window: over
// EVM JSON-RPC only the text arrives.
const TEXTS: ReadonlyArray<[RegExp, EvmDelegationRejection]> = [
  [/no post-quantum consent for this EIP-7702 delegation/i, "no-consent"],
  [/invalid EIP-7702 delegation request/i, "invalid"],
];

/** Classify a delegation refusal, or `undefined` when it is something else. */
export function classifyEvmDelegationRejection(x: unknown): EvmDelegationRejection | undefined {
  if (x === null || x === undefined) return undefined;
  const o = x as Record<string, unknown>;
  const texts = [o.log, o.rawLog, o.message, o.details, o.shortMessage].filter(
    (t): t is string => typeof t === "string",
  );
  for (const t of texts) for (const [re, kind] of TEXTS) if (re.test(t)) return kind;
  if (o.codespace === "pqc") {
    if (Number(o.code) === 60) return "no-consent";
    if (Number(o.code) === 61) return "invalid";
  }
  return undefined;
}
