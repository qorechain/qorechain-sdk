/**
 * Authenticator-lane sign-bytes (v3.1.85).
 *
 * QoreChain "authenticator lanes" let a linked external key (a Phantom ed25519
 * key, or an EVM secp256k1 key) spend from the ONE canonical PQC-required
 * account under least-privilege, spend-limited, revocable terms — WITHOUT the
 * external key ever producing an ML-DSA co-signature. A relayer submits and
 * pays fees (its own hybrid-PQC signature satisfies the ante on the envelope);
 * the authenticator's signature over the domain-separated, replay-bound
 * sign-bytes below IS the authorization.
 *
 * There are three lanes:
 *   - EVM lane    — `MsgExecuteEVM`:    an EVM call/transfer from the account's
 *                   0x address, authorized by {@link evmAuthSignBytes}.
 *   - Native lane — `MsgExecuteCosmos`: a bank send from the account, authorized
 *                   by {@link cosmosAuthSignBytes}.
 *   - Key rotation — `MsgRotatePQCKey`: dual-signed over
 *                    {@link rotationSignBytes}.
 *
 * The digests here are rebuilt BYTE-FOR-BYTE from what the chain re-derives
 * (`x/abstractaccount/types/{evm,cosmos}_sign.go`, `x/pqc/types` rotation
 * bytes). A mismatch is rejected on-chain (codespace `abstractaccount`, code 11
 * replay / 10 permission / 5 spending-limit / 6 session-expired; codespace
 * `pqc`, code 21 hybrid-verify-failed).
 *
 * These are pure byte-builders — no wallet, no network. See
 * {@link ../wallet/authenticator} for the DX builders that sign them.
 */

import { sha256 } from "../utils/hash";

const enc = new TextEncoder();

/** Domain-separation tag for the EVM authenticator lane. */
const EVM_AUTH_DOMAIN = "qorechain-evm-auth-v1";
/** Domain-separation tag for the Native (Cosmos) authenticator lane. */
const COSMOS_AUTH_DOMAIN = "qorechain-cosmos-auth-v1";
/** Domain-separation tag for the PQC key-rotation payload. */
const ROTATE_DOMAIN = "qorechain-pqc-rotate-v1";

/** 8-byte big-endian encoding of a non-negative integer (`binary.BigEndian`). */
export function be64(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  let v = BigInt(n);
  if (v < 0n) throw new Error(`be64: value must be non-negative, got ${n}`);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

/** Concatenate byte arrays into one `Uint8Array`. */
function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Length-prefixed field: `BE64(len) ‖ bytes` (the chain's framing). */
export function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  return concat([be64(bytes.length), bytes]);
}

/** Coerce a string or bytes input to bytes (UTF-8 for strings). */
function toBytes(x: Uint8Array | string): Uint8Array {
  return typeof x === "string" ? enc.encode(x) : x;
}

/** Lowercase hex of raw bytes (no `0x` prefix). */
function toHexLower(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Input to {@link evmAuthSignBytes}. */
export interface EvmAuthSignBytesInput {
  /** The chain id (e.g. `qorechain-diana`). */
  chainId: string;
  /** The bech32 canonical account the authenticator acts for. */
  account: string;
  /** The authenticator's raw public key (32 bytes for ed25519; the 20-byte eth address for secp256k1). */
  pubkey: Uint8Array;
  /** 0x-hex recipient/contract address; empty string for contract creation. */
  to?: string;
  /** Native QOR amount in wei (aqor) as a decimal string. */
  value?: string;
  /** EVM calldata. */
  data?: Uint8Array;
  /**
   * The account's CURRENT EVM nonce. The relayer is a DIFFERENT account than the
   * owner, so the relayer envelope does NOT bump the account's nonce — use the
   * current value as-is (do NOT +1).
   */
  nonce: number | bigint;
}

/**
 * Rebuild the 32-byte digest the chain re-derives for a `MsgExecuteEVM`:
 *
 * ```
 * sha256( "qorechain-evm-auth-v1"
 *         ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
 *         ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce) )
 * ```
 *
 * where `LP(x) = BE64(len(x)) ‖ x`. Returns the raw 32 bytes the authenticator
 * signs.
 */
export function evmAuthSignBytes(input: EvmAuthSignBytesInput): Uint8Array {
  const {
    chainId,
    account,
    pubkey,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    nonce,
  } = input;
  const body = concat([
    enc.encode(EVM_AUTH_DOMAIN),
    lengthPrefixed(toBytes(chainId)),
    lengthPrefixed(toBytes(account)),
    lengthPrefixed(pubkey),
    lengthPrefixed(toBytes(to)),
    lengthPrefixed(toBytes(value)),
    lengthPrefixed(data),
    be64(nonce),
  ]);
  return sha256(body);
}

/** Input to {@link cosmosAuthSignBytes}. */
export interface CosmosAuthSignBytesInput {
  /** The chain id (e.g. `qorechain-diana`). */
  chainId: string;
  /** The bech32 canonical account the authenticator acts for. */
  account: string;
  /** The authenticator's raw public key (32 bytes for ed25519; the 20-byte eth address for secp256k1). */
  pubkey: Uint8Array;
  /** The bech32 recipient address. */
  to: string;
  /** The CANONICAL single-coin amount string (e.g. `100uqor`). */
  amount: string;
  /**
   * The per-authenticator sequence for `(account, pubkey)` — a store counter
   * distinct from the account's own sequence, incremented on each successful
   * Native-lane spend.
   */
  nonce: number | bigint;
}

/**
 * Rebuild the 32-byte digest the chain re-derives for a `MsgExecuteCosmos`:
 *
 * ```
 * sha256( "qorechain-cosmos-auth-v1"
 *         ‖ LP(chainId) ‖ LP(account) ‖ LP(pubkey)
 *         ‖ LP(to) ‖ LP(amount) ‖ BE64(nonce) )
 * ```
 *
 * `amount` is the canonical single-coin string (e.g. `100uqor`). Returns the
 * raw 32 bytes the authenticator signs.
 */
export function cosmosAuthSignBytes(input: CosmosAuthSignBytesInput): Uint8Array {
  const { chainId, account, pubkey, to, amount, nonce } = input;
  const body = concat([
    enc.encode(COSMOS_AUTH_DOMAIN),
    lengthPrefixed(toBytes(chainId)),
    lengthPrefixed(toBytes(account)),
    lengthPrefixed(pubkey),
    lengthPrefixed(toBytes(to)),
    lengthPrefixed(toBytes(amount)),
    be64(nonce),
  ]);
  return sha256(body);
}

/**
 * The domain-separated STRING both the old and the new key sign for a
 * `MsgRotatePQCKey`:
 *
 * ```
 * "qorechain-pqc-rotate-v1|<chainId>|<algorithmId>|<account>|<oldHex>|<newHex>"
 * ```
 *
 * `oldHex`/`newHex` are lowercase hex of the public keys. Sign `utf8(result)`
 * with BOTH the old and the new key.
 */
export function rotationSignBytes(
  chainId: string,
  algorithmId: number,
  account: string,
  oldPub: Uint8Array,
  newPub: Uint8Array,
): string {
  return `${ROTATE_DOMAIN}|${chainId}|${algorithmId}|${account}|${toHexLower(oldPub)}|${toHexLower(newPub)}`;
}
