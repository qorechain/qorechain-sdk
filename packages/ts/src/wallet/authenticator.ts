/**
 * Wallet DX for the v3.1.85 authenticator lanes.
 *
 * These builders mirror the reference wallet-adapter: they take a linked
 * external wallet (a Phantom ed25519 key, or a MetaMask / EIP-1193 secp256k1
 * key), rebuild the domain-separated authenticator sign-bytes (see
 * {@link ../tx/authenticator}), have the wallet sign the 32-byte digest, and
 * return a relayer-ready `{ typeUrl, value }` message for the EVM or Native
 * lane. A relayer then submits and pays fees; the authenticator's signature IS
 * the authorization - the external key never produces an ML-DSA co-signature.
 *
 * Signature schemes:
 *   - `ed25519` (Phantom): the chain verifies `ed25519.Verify(pubkey, digest,
 *     sig)`, so a Phantom `signMessage(digest)` matches directly.
 *   - `secp256k1` (MetaMask): the key is linked by its 20-byte ETH ADDRESS; the
 *     wallet produces a 65-byte `personal_sign` (EIP-191) signature over the
 *     same digest.
 *
 * Linking a key (chain v3.2.8): `MsgRegisterAuthenticator` carries a
 * possession proof, the linked key's signature over
 * `authenticatorLinkMessage(chainId, account, scheme, pubkey)`
 * (`signAuthenticatorLink*`), and a key with a value permission needs a
 * bounding spending rule on the account; {@link linkAuthenticatorMsgs} builds
 * `[MsgUpdateSpendingRules, MsgRegisterAuthenticator]` for one owner-signed
 * transaction. A failed, authorised execution returns `success = false` in a
 * code-0 transaction and consumes the nonce: read it with
 * {@link decodeAuthenticatorExecutions} / {@link assertAuthenticatorExecutionsSucceeded}.
 *
 * Also included: the low-level message composers, and mnemonic-based PQC key
 * rotation (legacy→canonical migration) with both keys dual-signing the
 * rotation bytes.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { mldsa, shake256 } from "@qorechain/pqc";
import { generatePqcKeypair, type PqcKeypair } from "../accounts/pqc";
import { qoreAddresses } from "../accounts/unified";
import {
  evmAuthSignBytes,
  evmAuthSignBytesV2,
  cosmosAuthSignBytes,
  rotationSignBytes,
  authenticatorLinkMessageBytes,
  validateAuthenticatorKey,
  type AuthenticatorScheme,
  type EvmAuthDigestVersion,
} from "../tx/authenticator";
import { abstractaccount as aaMsg, requirePossessionProof } from "../messages/qorechain";
import { checkValuePermissionRules } from "../messages/spending-rules";
import * as aaTx from "../codegen/qorechain/abstractaccount/v1/tx";
import { checkEvmGasLimit } from "../tx/fees";
import type { BroadcastResult } from "../tx/broadcast";

const enc = new TextEncoder();

// ---- byte helpers -------------------------------------------------------

/** Coerce a string or bytes input to bytes (UTF-8 for strings). */
function toBytes(x: Uint8Array | string): Uint8Array {
  return typeof x === "string" ? enc.encode(x) : x;
}

/** Parse a hex string (with or without `0x`) into bytes. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode bytes as a `0x`-prefixed lowercase hex string. */
function bytesToHex0x(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Lowercase hex of raw bytes (no `0x` prefix). */
function toHexLower(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Parse a single-coin amount string like `100uqor` into `[{denom,amount}]`. */
function parseCoins(amount: string): { denom: string; amount: string }[] {
  const m = /^([0-9]+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/.exec(String(amount).trim());
  if (!m) {
    throw new Error(`invalid amount "${amount}" (expected e.g. "100uqor")`);
  }
  return [{ denom: m[2], amount: m[1] }];
}

// ---- message composers --------------------------------------------------

/** Fields for {@link executeEvmMsg}. */
export interface ExecuteEvmMsgInput {
  relayer: string;
  account: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
  signature: Uint8Array;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit: number | bigint;
  nonce: number | bigint;
}

/**
 * Build a `MsgExecuteEVM` (`{ typeUrl, value }`) - the relayer broadcasts this
 * and is the fee payer. `to` is a 0x-hex address, `value` a decimal wei string.
 * A `gasLimit` above the chain's EVM cap (30,000,000 on v3.2.8, see
 * `fetchEvmLimits`) is refused.
 */
export function executeEvmMsg(input: ExecuteEvmMsgInput): EncodeObject {
  const {
    relayer,
    account,
    scheme,
    pubkey,
    signature,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit,
    nonce,
  } = input;
  checkEvmGasLimit(gasLimit);
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVM",
    value: {
      relayer,
      account,
      scheme,
      pubkey: toBytes(pubkey),
      signature: toBytes(signature),
      to,
      value,
      data: toBytes(data),
      gasLimit: BigInt(gasLimit),
      nonce: BigInt(nonce),
    },
  };
}

/** Fields for {@link executeCosmosMsg}. */
export interface ExecuteCosmosMsgInput {
  relayer: string;
  account: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
  signature: Uint8Array;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  nonce: number | bigint;
}

/**
 * Build a `MsgExecuteCosmos` (`{ typeUrl, value }`) - the relayer broadcasts
 * this. `amount` is a single-coin string like `100uqor`.
 */
export function executeCosmosMsg(input: ExecuteCosmosMsgInput): EncodeObject {
  const { relayer, account, scheme, pubkey, signature, to, amount, nonce } =
    input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteCosmos",
    value: {
      relayer,
      account,
      scheme,
      pubkey: toBytes(pubkey),
      signature: toBytes(signature),
      to,
      amount: parseCoins(amount),
      nonce: BigInt(nonce),
    },
  };
}

/** Fields for {@link revokeAuthenticatorMsg}. */
export interface RevokeAuthenticatorMsgInput {
  owner: string;
  account?: string;
  scheme: "ed25519" | "secp256k1";
  pubkey: Uint8Array;
}

/**
 * Build a `MsgRevokeAuthenticator` (`{ typeUrl, value }`) - owner-signed;
 * instantly disables a linked key. `account` defaults to `owner`.
 */
export function revokeAuthenticatorMsg(
  input: RevokeAuthenticatorMsgInput,
): EncodeObject {
  const { owner, account = owner, scheme, pubkey } = input;
  return {
    typeUrl: "/qorechain.abstractaccount.v1.MsgRevokeAuthenticator",
    value: {
      owner,
      accountAddress: account,
      scheme,
      pubkey: toBytes(pubkey),
    },
  };
}

/** Fields for {@link registerAuthenticatorMsg}. */
export interface RegisterAuthenticatorMsgInput {
  owner: string;
  /** The account the key acts for; defaults to `owner`. */
  account?: string;
  scheme: AuthenticatorScheme;
  /**
   * The key: 32-byte ed25519 key, 33-byte compressed secp256k1 key, or the
   * 20-byte Ethereum address (MetaMask-style links). 65-byte keys are refused.
   */
  pubkey: Uint8Array;
  permissions: string[];
  expiryUnix: number | bigint;
  label?: string;
  /**
   * Required from chain v3.2.8: the linked key's signature over
   * {@link authenticatorLinkMessage}`(chainId, account, scheme, pubkey)`
   * (see the `signAuthenticatorLink*` helpers).
   */
  possessionProof: Uint8Array;
}

/**
 * Build a `MsgRegisterAuthenticator` (`{ typeUrl, value }`). Owner-signed.
 * Refuses an empty `possessionProof` (required from chain v3.2.8). A key with
 * a value permission also needs a bounding spending rule on the account: use
 * {@link linkAuthenticatorMsgs} to build both messages.
 */
export function registerAuthenticatorMsg(input: RegisterAuthenticatorMsgInput): EncodeObject {
  const { owner, account = owner, scheme, pubkey, permissions, expiryUnix, label = "", possessionProof } = input;
  validateAuthenticatorKey(scheme, pubkey);
  requirePossessionProof(possessionProof);
  return aaMsg.registerAuthenticator({
    owner,
    accountAddress: account,
    scheme,
    pubkey,
    permissions,
    expiryUnix: String(BigInt(expiryUnix)),
    label,
    possessionProof,
  });
}

/** Fields for {@link registerEthAuthenticatorMsg}. */
export interface RegisterEthAuthenticatorMsgInput {
  owner: string;
  account?: string;
  /** 0x-hex 20-byte ETH address that becomes the authenticator pubkey. */
  ethAddress: string;
  permissions?: string[];
  expiryUnix: number | bigint;
  label?: string;
  /**
   * Required from chain v3.2.8: the EIP-191 `personal_sign` of
   * {@link authenticatorLinkMessage} by `ethAddress`
   * ({@link signAuthenticatorLinkMetaMask} / {@link signAuthenticatorLinkEip191}).
   */
  possessionProof: Uint8Array;
}

/**
 * Build a `MsgRegisterAuthenticator` (`{ typeUrl, value }`) that links a
 * MetaMask / EVM key (by its 0x address, scheme `secp256k1`) to the owner's
 * account. Owner-signed. `account` defaults to `owner`. Refuses an empty
 * `possessionProof` (required from chain v3.2.8).
 */
export function registerEthAuthenticatorMsg(
  input: RegisterEthAuthenticatorMsgInput,
): EncodeObject {
  const {
    owner,
    account = owner,
    ethAddress,
    permissions = ["evm"],
    expiryUnix,
    label = "metamask",
    possessionProof,
  } = input;
  return registerAuthenticatorMsg({
    owner,
    account,
    scheme: "secp256k1",
    pubkey: hexToBytes(ethAddress),
    permissions,
    expiryUnix,
    label,
    possessionProof,
  });
}

// ---- possession proof (chain v3.2.8) ------------------------------------

/** A linked key and its possession proof, ready for {@link registerAuthenticatorMsg}. */
export interface AuthenticatorLinkProof {
  scheme: AuthenticatorScheme;
  /** The bytes that go in the message's `pubkey`. */
  pubkey: Uint8Array;
  /** The signature that goes in `possessionProof`. */
  possessionProof: Uint8Array;
}

/** Where the link proof is bound: the chain id and the account the key will act for. */
export interface AuthenticatorLinkTarget {
  chainId: string;
  /** The bech32 `account_address` of the `MsgRegisterAuthenticator`. */
  account: string;
}

function privKeyBytes(k: Uint8Array | string): Uint8Array {
  return typeof k === "string" ? hexToBytes(k) : k;
}

/** The Ethereum address (20 bytes) of a secp256k1 private key. */
function ethAddressOf(priv: Uint8Array): Uint8Array {
  return keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(12);
}

/** keccak256 of the EIP-191 `personal_sign` envelope of `message`. */
function eip191Hash(message: Uint8Array): Uint8Array {
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${message.length}`);
  const buf = new Uint8Array(prefix.length + message.length);
  buf.set(prefix);
  buf.set(message, prefix.length);
  return keccak_256(buf);
}

/**
 * Prove possession of an ed25519 key (32-byte seed / private key): an ed25519
 * signature over the raw bytes of {@link authenticatorLinkMessage}.
 */
export function signAuthenticatorLinkEd25519(
  opts: AuthenticatorLinkTarget & { privateKey: Uint8Array | string },
): AuthenticatorLinkProof {
  const priv = privKeyBytes(opts.privateKey);
  if (priv.length !== 32) throw new Error(`an ed25519 private key (seed) is 32 bytes, got ${priv.length}`);
  const pubkey = ed25519.getPublicKey(priv);
  const msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, "ed25519", pubkey);
  return { scheme: "ed25519", pubkey, possessionProof: ed25519.sign(msg, priv) };
}

/**
 * Prove possession of a secp256k1 key linked by its 33-byte compressed public
 * key: a 64-byte `r || s` (low-S) signature over `sha256(text)`.
 */
export function signAuthenticatorLinkSecp256k1(
  opts: AuthenticatorLinkTarget & { privateKey: Uint8Array | string },
): AuthenticatorLinkProof {
  const priv = privKeyBytes(opts.privateKey);
  const pubkey = secp256k1.getPublicKey(priv, true);
  const msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, "secp256k1", pubkey);
  const sig = secp256k1.sign(sha256(msg), priv, { lowS: true });
  return { scheme: "secp256k1", pubkey, possessionProof: sig.toCompactRawBytes() };
}

/**
 * Prove possession of a secp256k1 key linked by its 20-byte Ethereum address
 * (MetaMask-style): an EIP-191 `personal_sign` of the text, 65 bytes
 * `r || s || v` with `v` = 27/28.
 */
export function signAuthenticatorLinkEip191(
  opts: AuthenticatorLinkTarget & { privateKey: Uint8Array | string },
): AuthenticatorLinkProof {
  const priv = privKeyBytes(opts.privateKey);
  const pubkey = ethAddressOf(priv);
  const msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, "secp256k1", pubkey);
  const sig = secp256k1.sign(eip191Hash(msg), priv, { lowS: true });
  const out = new Uint8Array(65);
  out.set(sig.toCompactRawBytes());
  out[64] = 27 + (sig.recovery ?? 0);
  return { scheme: "secp256k1", pubkey, possessionProof: out };
}

/**
 * Prove possession with a Phantom-style ed25519 wallet: `signMessage` of the
 * UTF-8 bytes of {@link authenticatorLinkMessage}.
 */
export async function signAuthenticatorLinkPhantom(
  opts: AuthenticatorLinkTarget & { wallet: AuthenticatorWallet },
): Promise<AuthenticatorLinkProof> {
  const pubkey = walletPubkey(opts.wallet);
  const msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, "ed25519", pubkey);
  return { scheme: "ed25519", pubkey, possessionProof: normalizeSignature(await opts.wallet.signMessage(msg)) };
}

/**
 * Prove possession with MetaMask / any EIP-1193 provider: `personal_sign` of
 * {@link authenticatorLinkMessage} by `address` (the 20-byte address is the
 * linked pubkey).
 */
export async function signAuthenticatorLinkMetaMask(
  opts: AuthenticatorLinkTarget & { provider: Eip1193Provider; address: string },
): Promise<AuthenticatorLinkProof> {
  const pubkey = hexToBytes(opts.address);
  const msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, "secp256k1", pubkey);
  const sigHex = await opts.provider.request({ method: "personal_sign", params: [bytesToHex0x(msg), opts.address] });
  return { scheme: "secp256k1", pubkey, possessionProof: hexToBytes(sigHex) };
}

/**
 * Verify a possession proof the way the chain does (chain v3.2.8): ed25519
 * over the raw text; a 33-byte secp256k1 key over `sha256(text)` with a 64-byte
 * low-S `r || s`; a 20-byte address by recovering the signer of the EIP-191
 * hash from a 65-byte `r || s || v` (v = 27/28 or 0/1). Returns `false` for any
 * other shape.
 */
export function verifyAuthenticatorLinkProof(
  opts: AuthenticatorLinkTarget & { scheme: AuthenticatorScheme; pubkey: Uint8Array; possessionProof: Uint8Array },
): boolean {
  const { scheme, pubkey, possessionProof: sig } = opts;
  let msg: Uint8Array;
  try {
    msg = authenticatorLinkMessageBytes(opts.chainId, opts.account, scheme, pubkey);
  } catch {
    return false;
  }
  try {
    if (scheme === "ed25519") return sig.length === 64 && ed25519.verify(sig, msg, pubkey);
    if (pubkey.length === 33) return sig.length === 64 && secp256k1.verify(sig, sha256(msg), pubkey, { lowS: true });
    if (pubkey.length === 20) {
      if (sig.length !== 65) return false;
      const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
      if (v !== 0 && v !== 1) return false;
      const point = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(eip191Hash(msg));
      const addr = keccak_256(point.toRawBytes(false).slice(1)).slice(12);
      return toHexLower(addr) === toHexLower(pubkey);
    }
  } catch {
    return false;
  }
  return false;
}

/** A spending rule as {@link linkAuthenticatorMsgs} takes it. */
export type SpendingRuleInput = Partial<Omit<aaTx.SpendingRule, "dailyLimit" | "perTxLimit">> & {
  dailyLimit?: string | number | bigint;
  perTxLimit?: string | number | bigint;
};

/** Fields for {@link linkAuthenticatorMsgs}. */
export interface LinkAuthenticatorMsgsInput {
  /** The account owner; signs both messages as top-level messages. */
  owner: string;
  /** The account the key acts for; defaults to `owner` (the recommended form). */
  account?: string;
  /** When given, the possession proof is checked against it before anything is built. */
  chainId?: string;
  scheme: AuthenticatorScheme;
  pubkey: Uint8Array;
  permissions: string[];
  expiryUnix: number | bigint;
  label?: string;
  possessionProof: Uint8Array;
  /**
   * The account's spending rules, as ONE rule or the full list.
   * `MsgUpdateSpendingRules` REPLACES the account's rules wholesale, so pass
   * every rule the account should keep. Required when `permissions` has a
   * value permission (`send`, `evm`, `deploy`, `svm`, `all`): the first
   * enabled rule must bound every denom.
   */
  spendingRule?: SpendingRuleInput;
  spendingRules?: SpendingRuleInput[];
}

/**
 * Build the messages that link a key from chain v3.2.8, in the order to send
 * them in ONE transaction signed by the owner (top-level, not through authz):
 * `[MsgUpdateSpendingRules, MsgRegisterAuthenticator]`.
 *
 * - The possession proof is required (and, with `chainId`, verified here).
 * - A key with a value permission (`send`, `evm`, `deploy`, `svm`, `all`)
 *   needs an enabled spending rule on the ACCOUNT that bounds every denom
 *   (`perTxLimit > 0` or `dailyLimit > 0`, or an `allowedDenoms` list with a
 *   `denomLimits` amount for each); the chain applies the first enabled rule,
 *   so that is the one checked. The message has no per-key rule.
 * - `MsgUpdateSpendingRules` replaces the account's rules wholesale.
 * - It may be sent for an account that does not exist yet when `account ==
 *   owner` (it creates the account).
 *
 * Without rules and without a value permission only the register message is
 * returned.
 */
export function linkAuthenticatorMsgs(input: LinkAuthenticatorMsgsInput): EncodeObject[] {
  const { owner, account = owner, scheme, pubkey, permissions, possessionProof } = input;
  validateAuthenticatorKey(scheme, pubkey);
  requirePossessionProof(possessionProof);
  if (input.chainId !== undefined) {
    if (!verifyAuthenticatorLinkProof({ chainId: input.chainId, account, scheme, pubkey, possessionProof })) {
      throw new Error(
        "linkAuthenticatorMsgs: possessionProof does not verify for this key over " +
          "authenticatorLinkMessage(chainId, account, scheme, pubkey); sign that exact text with the key being linked",
      );
    }
  }
  if (input.spendingRule && input.spendingRules) {
    throw new Error("linkAuthenticatorMsgs: pass spendingRule or spendingRules, not both");
  }
  const rules = input.spendingRules ?? (input.spendingRule ? [input.spendingRule] : undefined);
  checkValuePermissionRules(permissions, rules);
  const register = registerAuthenticatorMsg({
    owner,
    account,
    scheme,
    pubkey,
    permissions,
    expiryUnix: input.expiryUnix,
    label: input.label,
    possessionProof,
  });
  if (!rules) return [register];
  const update = aaMsg.updateSpendingRules({
    owner,
    accountAddress: account,
    rules: rules.map((r) => ({
      ...r,
      dailyLimit: r.dailyLimit === undefined ? undefined : String(r.dailyLimit),
      perTxLimit: r.perTxLimit === undefined ? undefined : String(r.perTxLimit),
    })),
  });
  return [update, register];
}

// ---- execution results (chain v3.2.8) -----------------------------------

/** The event a failed, authorised execution emits (chain v3.2.8). */
export const EXECUTION_FAILED_EVENT = "abstractaccount_execution_failed";

const EXECUTE_EVM_RESPONSE = "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse";
const EXECUTE_COSMOS_RESPONSE = "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse";

/** The outcome of one `MsgExecuteEVM` / `MsgExecuteCosmos` in a delivered tx. */
export interface AuthenticatorExecutionResult {
  /** Position of the message in the transaction. */
  index: number;
  lane: "evm" | "cosmos";
  success: boolean;
  /** EVM return data (empty for the Cosmos lane). */
  ret: Uint8Array;
  /** EVM gas used (0 for the Cosmos lane). */
  gasUsed: bigint;
  /** The EVM error, when the call failed. */
  vmError: string;
  /** The `reason` of the matching `abstractaccount_execution_failed` event, when failed. */
  reason: string;
  /** The `account` / `nonce` of the matching failure event, when failed. */
  account?: string;
  nonce?: string;
}

/**
 * Decode the outcome of every `MsgExecuteEVM` / `MsgExecuteCosmos` in a
 * delivered transaction (a `commit` broadcast result with `msgResponses` and
 * `events`).
 *
 * From chain v3.2.8 a failed execution that was authorised returns
 * `success = false` inside a transaction with code 0, emits
 * `abstractaccount_execution_failed` (`account`, `lane`, `nonce`, `reason`)
 * and CONSUMES the nonce: the same signature cannot be relayed again, so treat
 * a failure as final. Failure events are matched to failed responses by
 * account and nonce when `messages` (the tx's messages) is given, otherwise in
 * order.
 */
export function decodeAuthenticatorExecutions(
  result: Pick<BroadcastResult, "msgResponses" | "events">,
  messages?: readonly EncodeObject[],
): AuthenticatorExecutionResult[] {
  const failures = (result.events ?? [])
    .filter((e) => e.type === EXECUTION_FAILED_EVENT)
    .map((e) => {
      const attr = (k: string) => e.attributes.find((a) => a.key === k)?.value ?? "";
      return { account: attr("account"), lane: attr("lane"), nonce: attr("nonce"), reason: attr("reason"), used: false };
    });
  const out: AuthenticatorExecutionResult[] = [];
  (result.msgResponses ?? []).forEach((r, index) => {
    let res: AuthenticatorExecutionResult;
    if (r.typeUrl === EXECUTE_EVM_RESPONSE) {
      const d = aaTx.MsgExecuteEVMResponse.decode(r.value);
      res = { index, lane: "evm", success: d.success, ret: d.ret, gasUsed: BigInt(d.gasUsed || 0), vmError: d.vmError, reason: "" };
    } else if (r.typeUrl === EXECUTE_COSMOS_RESPONSE) {
      const d = aaTx.MsgExecuteCosmosResponse.decode(r.value);
      res = { index, lane: "cosmos", success: d.success, ret: new Uint8Array(0), gasUsed: 0n, vmError: "", reason: "" };
    } else {
      return;
    }
    if (!res.success) {
      const m = messages?.[index]?.value as { account?: string; nonce?: unknown } | undefined;
      let f = m
        ? failures.find((x) => !x.used && x.account === m.account && x.nonce === String(m.nonce))
        : undefined;
      f ??= failures.find((x) => !x.used);
      if (f) {
        f.used = true;
        res.reason = f.reason;
        res.account = f.account;
        res.nonce = f.nonce;
      }
      if (!res.reason) res.reason = res.vmError;
    }
    out.push(res);
  });
  return out;
}

/** Thrown by {@link assertAuthenticatorExecutionsSucceeded} when an execution failed in a code-0 tx. */
export class AuthenticatorExecutionError extends Error {
  readonly failed: AuthenticatorExecutionResult[];
  readonly txHash?: string;
  constructor(failed: AuthenticatorExecutionResult[], txHash?: string) {
    const what = failed.map((f) => `message ${f.index} (${f.lane}): ${f.reason || "failed"}`).join("; ");
    super(
      `authenticator execution failed although the transaction succeeded${txHash ? ` (tx ${txHash})` : ""}: ${what}. ` +
        "The nonce was consumed; sign a new request with the next nonce",
    );
    this.name = "AuthenticatorExecutionError";
    this.failed = failed;
    this.txHash = txHash;
    Object.setPrototypeOf(this, AuthenticatorExecutionError.prototype);
  }
}

/**
 * {@link decodeAuthenticatorExecutions}, throwing an
 * {@link AuthenticatorExecutionError} when any execution reported
 * `success = false` even though the transaction code is 0. Returns the
 * results otherwise. Use it after a relayer broadcast so a failed execution
 * is never read as a success.
 */
export function assertAuthenticatorExecutionsSucceeded(
  result: Pick<BroadcastResult, "msgResponses" | "events" | "transactionHash">,
  messages?: readonly EncodeObject[],
): AuthenticatorExecutionResult[] {
  const all = decodeAuthenticatorExecutions(result, messages);
  const failed = all.filter((r) => !r.success);
  if (failed.length > 0) throw new AuthenticatorExecutionError(failed, result.transactionHash);
  return all;
}

/** Fields for {@link rotatePqcKeyMsg}. */
export interface RotatePqcKeyMsgInput {
  sender: string;
  oldPublicKey: Uint8Array;
  newPublicKey: Uint8Array;
  oldSignature: Uint8Array;
  newSignature: Uint8Array;
}

/**
 * Build a `MsgRotatePQCKey` (`{ typeUrl, value }`) - sender-signed (hybrid, with
 * the OLD key); dual-signed payload.
 */
export function rotatePqcKeyMsg(input: RotatePqcKeyMsgInput): EncodeObject {
  const { sender, oldPublicKey, newPublicKey, oldSignature, newSignature } =
    input;
  return {
    typeUrl: "/qorechain.pqc.v1.MsgRotatePQCKey",
    value: {
      sender,
      oldPublicKey: toBytes(oldPublicKey),
      newPublicKey: toBytes(newPublicKey),
      oldSignature: toBytes(oldSignature),
      newSignature: toBytes(newSignature),
    },
  };
}

// ---- Phantom (ed25519) envelope builders --------------------------------

/**
 * The minimal Phantom-style ed25519 wallet shape the builders need: a public
 * key (as `.toBytes()` or raw bytes) and `signMessage` returning `{ signature }`
 * or raw bytes.
 */
export interface AuthenticatorWallet {
  publicKey: { toBytes(): Uint8Array } | Uint8Array;
  signMessage(
    message: Uint8Array,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

/** Normalize a wallet public key (object with `toBytes` or raw bytes) to bytes. */
function walletPubkey(wallet: AuthenticatorWallet): Uint8Array {
  const pk = wallet.publicKey;
  return pk instanceof Uint8Array ? pk : pk.toBytes();
}

/** Normalize a `signMessage` result (`.signature` or raw bytes) to bytes. */
function normalizeSignature(
  res: { signature: Uint8Array } | Uint8Array,
): Uint8Array {
  return res instanceof Uint8Array ? res : res.signature;
}

/** Fields for {@link buildPhantomExecuteEvm}. */
export interface BuildPhantomExecuteEvmOptions {
  wallet: AuthenticatorWallet;
  relayer: string;
  chainId: string;
  account: string;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit?: number | bigint;
  /**
   * The linked key's authenticator sequence (a per-key counter starting at 0),
   * NOT the account's EVM nonce.
   */
  nonce: number | bigint;
  /**
   * Which digest to sign: `"v1"` (default) below chain v3.2.3, `"v2"` (binds
   * `gasLimit`) from it. Resolve with `resolveEvmAuthDigestVersion`; the chain
   * verifies exactly one form per block.
   */
  digestVersion?: EvmAuthDigestVersion;
}

/**
 * Sign the EVM auth digest with a Phantom-style ed25519 wallet and return a
 * `MsgExecuteEVM` ready for the relayer to broadcast.
 */
export async function buildPhantomExecuteEvm(
  opts: BuildPhantomExecuteEvmOptions,
): Promise<EncodeObject> {
  const {
    wallet,
    relayer,
    chainId,
    account,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit = 100000,
    nonce,
  } = opts;
  checkEvmGasLimit(gasLimit);
  const pubkey = walletPubkey(wallet);
  const digest =
    opts.digestVersion === "v2"
      ? evmAuthSignBytesV2({ chainId, account, pubkey, to, value, data, nonce, gasLimit })
      : evmAuthSignBytes({ chainId, account, pubkey, to, value, data, nonce });
  const signature = normalizeSignature(await wallet.signMessage(digest));
  return executeEvmMsg({
    relayer,
    account,
    scheme: "ed25519",
    pubkey,
    signature,
    to,
    value,
    data,
    gasLimit,
    nonce,
  });
}

/** Fields for {@link buildPhantomExecuteCosmos}. */
export interface BuildPhantomExecuteCosmosOptions {
  wallet: AuthenticatorWallet;
  relayer: string;
  chainId: string;
  account: string;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  /** The per-authenticator sequence for `(account, pubkey)`. */
  nonce: number | bigint;
}

/**
 * Sign the Native (Cosmos) auth digest with a Phantom-style ed25519 wallet and
 * return a `MsgExecuteCosmos` ready for the relayer to broadcast.
 */
export async function buildPhantomExecuteCosmos(
  opts: BuildPhantomExecuteCosmosOptions,
): Promise<EncodeObject> {
  const { wallet, relayer, chainId, account, to, amount, nonce } = opts;
  const pubkey = walletPubkey(wallet);
  const digest = cosmosAuthSignBytes({ chainId, account, pubkey, to, amount, nonce });
  const signature = normalizeSignature(await wallet.signMessage(digest));
  return executeCosmosMsg({
    relayer,
    account,
    scheme: "ed25519",
    pubkey,
    signature,
    to,
    amount,
    nonce,
  });
}

// ---- MetaMask (EIP-191 / secp256k1) envelope builders -------------------

/** The minimal EIP-1193 provider shape the MetaMask builders need. */
export interface Eip1193Provider {
  request(args: { method: string; params: unknown[] }): Promise<string>;
}

/** `personal_sign` (EIP-191) over the 32-byte digest via an EIP-1193 provider. */
async function ethPersonalSign(
  provider: Eip1193Provider,
  address: string,
  digest: Uint8Array,
): Promise<Uint8Array> {
  const sigHex = await provider.request({
    method: "personal_sign",
    params: [bytesToHex0x(digest), address],
  });
  return hexToBytes(sigHex); // 65 bytes r‖s‖v (v = 27/28)
}

/** Fields for {@link buildMetaMaskExecuteEvm}. */
export interface BuildMetaMaskExecuteEvmOptions {
  provider: Eip1193Provider;
  /** 0x-hex 20-byte ETH address (the authenticator pubkey). */
  address: string;
  relayer: string;
  chainId: string;
  account: string;
  to?: string;
  value?: string;
  data?: Uint8Array;
  gasLimit?: number | bigint;
  /**
   * The linked key's authenticator sequence (a per-key counter starting at 0),
   * NOT the account's EVM nonce.
   */
  nonce: number | bigint;
  /**
   * Which digest to sign: `"v1"` (default) below chain v3.2.3, `"v2"` (binds
   * `gasLimit`) from it. Resolve with `resolveEvmAuthDigestVersion`; the chain
   * verifies exactly one form per block.
   */
  digestVersion?: EvmAuthDigestVersion;
}

/**
 * Sign the EVM auth digest via MetaMask (EIP-191 `personal_sign`) and return a
 * `MsgExecuteEVM` ready for the relayer. The key is linked by its 20-byte ETH
 * address (scheme `secp256k1`).
 */
export async function buildMetaMaskExecuteEvm(
  opts: BuildMetaMaskExecuteEvmOptions,
): Promise<EncodeObject> {
  const {
    provider,
    address,
    relayer,
    chainId,
    account,
    to = "",
    value = "0",
    data = new Uint8Array(0),
    gasLimit = 100000,
    nonce,
  } = opts;
  checkEvmGasLimit(gasLimit);
  const pubkey = hexToBytes(address);
  const digest =
    opts.digestVersion === "v2"
      ? evmAuthSignBytesV2({ chainId, account, pubkey, to, value, data, nonce, gasLimit })
      : evmAuthSignBytes({ chainId, account, pubkey, to, value, data, nonce });
  const signature = await ethPersonalSign(provider, address, digest);
  return executeEvmMsg({
    relayer,
    account,
    scheme: "secp256k1",
    pubkey,
    signature,
    to,
    value,
    data,
    gasLimit,
    nonce,
  });
}

/** Fields for {@link buildMetaMaskExecuteCosmos}. */
export interface BuildMetaMaskExecuteCosmosOptions {
  provider: Eip1193Provider;
  /** 0x-hex 20-byte ETH address (the authenticator pubkey). */
  address: string;
  relayer: string;
  chainId: string;
  account: string;
  to: string;
  /** Single-coin amount string, e.g. `100uqor`. */
  amount: string;
  /** The per-authenticator sequence for `(account, address)`. */
  nonce: number | bigint;
}

/**
 * Sign the Native (Cosmos) auth digest via MetaMask (EIP-191 `personal_sign`)
 * and return a `MsgExecuteCosmos` ready for the relayer.
 */
export async function buildMetaMaskExecuteCosmos(
  opts: BuildMetaMaskExecuteCosmosOptions,
): Promise<EncodeObject> {
  const { provider, address, relayer, chainId, account, to, amount, nonce } =
    opts;
  const pubkey = hexToBytes(address);
  const digest = cosmosAuthSignBytes({ chainId, account, pubkey, to, amount, nonce });
  const signature = await ethPersonalSign(provider, address, digest);
  return executeCosmosMsg({
    relayer,
    account,
    scheme: "secp256k1",
    pubkey,
    signature,
    to,
    amount,
    nonce,
  });
}

// ---- PQC key rotation (legacy → canonical migration) --------------------

/**
 * The CANONICAL address-bound PQC derivation (SDK / wallet-adapter):
 * `shake256("qorechain:pqc:v1|" + account + "|" + mnemonic, 32)` → ML-DSA-87
 * keygen. This matches {@link ../accounts/unified.deriveUnifiedAccount}.
 */
export const CANONICAL_DERIVATION = "adapter";
/**
 * The LEGACY chain-bridge / faucet-api PQC derivation:
 * `shake256(utf8(mnemonic), 32)` → ML-DSA-87 keygen. Not address-bound.
 */
export const LEGACY_DERIVATION = "bridge";

/**
 * Derive the LEGACY (chain-bridge) ML-DSA-87 keypair for a mnemonic.
 *
 * @deprecated for new keys: not bound to the account, so one mnemonic yields one
 * key for every account. Keep using it only to recover, or rotate away from, a
 * key that was registered this way ({@link rotatePqcKeyMsgFromMnemonic}).
 */
export function derivePqcLegacy(mnemonic: string): PqcKeypair {
  return generatePqcKeypair(shake256(enc.encode(mnemonic), 32));
}

/**
 * Resolve `account` to the canonical form the address-bound PQC derivation and
 * the rotation message use: lower-case `qor1…` bech32.
 *
 * Accepts a bech32 address in either case (all-lower or all-upper, as bech32
 * allows) or a `0x`/`0X` EVM address, which is re-encoded to its bech32 form.
 * Byte-identical to the Go SDK's resolution: the 20-byte payload is re-encoded
 * with the `qor` prefix.
 *
 * @throws if `account` is not a valid 20-byte account address.
 */
export function canonicalAccount(account: string): string {
  if (account.startsWith("0x") || account.startsWith("0X")) {
    return qoreAddresses({ hex: account }).cosmos;
  }
  try {
    return qoreAddresses({ cosmos: account }).cosmos;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cannot resolve account "${account}" to a bech32 cosmos address: ${reason}`,
    );
  }
}

/**
 * Derive the CANONICAL (address-bound) ML-DSA-87 keypair for a mnemonic:
 * `shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32)`, where `cosmos`
 * is `account` resolved by {@link canonicalAccount} - so an upper-case bech32 or
 * a `0x` form of the same account yields the same key.
 *
 * @throws if `account` is not a valid 20-byte account address.
 */
export function derivePqcCanonical(account: string, mnemonic: string): PqcKeypair {
  const cosmos = canonicalAccount(account);
  return generatePqcKeypair(
    shake256(enc.encode(`qorechain:pqc:v1|${cosmos}|${mnemonic}`), 32),
  );
}

/** Resolve a derivation name to its ML-DSA-87 keypair. */
function derivePqcByScheme(
  scheme: string,
  account: string,
  mnemonic: string,
): PqcKeypair {
  if (scheme === LEGACY_DERIVATION || scheme === "mnemonic-only") {
    return derivePqcLegacy(mnemonic);
  }
  if (scheme === CANONICAL_DERIVATION || scheme === "") {
    return derivePqcCanonical(account, mnemonic);
  }
  throw new Error(`unknown derivation "${scheme}" (use adapter|bridge)`);
}

/** Options for {@link rotatePqcKeyMsgFromMnemonic}. */
export interface RotatePqcKeyMsgFromMnemonicOptions {
  account: string;
  mnemonic: string;
  chainId: string;
  /** PQC algorithm id (ML-DSA-87 = 1). */
  algorithmId?: number;
  /** Source derivation (defaults to the legacy chain-bridge derivation). */
  oldDerivation?: string;
  /** Target derivation (defaults to the canonical address-bound derivation). */
  newDerivation?: string;
}

/** Result of {@link rotatePqcKeyMsgFromMnemonic}. */
export interface RotatePqcKeyMsgFromMnemonicResult {
  /** The `{ typeUrl, value }` `MsgRotatePQCKey` to broadcast. */
  msg: EncodeObject;
  /** The OLD keypair (still the registered key until the rotation lands). */
  oldKeypair: PqcKeypair;
  /** The NEW keypair (becomes the registered key after rotation). */
  newKeypair: PqcKeypair;
}

/**
 * Build a `MsgRotatePQCKey` that rotates an account's ML-DSA-87 key (SAME
 * algorithm) from one derivation to another - canonically migrating a LEGACY
 * chain-bridge key (`shake256(mnemonic)`) to the canonical address-bound key
 * (`shake256("qorechain:pqc:v1|addr|mnemonic")`). Both keys dual-sign the
 * domain-separated rotation bytes.
 *
 * The returned message must be broadcast BY the account, cosigned (hybrid) with
 * the OLD key (it is still the registered key until the rotation lands).
 */
export function rotatePqcKeyMsgFromMnemonic(
  opts: RotatePqcKeyMsgFromMnemonicOptions,
): RotatePqcKeyMsgFromMnemonicResult {
  const {
    mnemonic,
    chainId,
    algorithmId = 1,
    oldDerivation = LEGACY_DERIVATION,
    newDerivation = CANONICAL_DERIVATION,
  } = opts;
  if (newDerivation === LEGACY_DERIVATION || newDerivation === "mnemonic-only") {
    throw new Error(
      "the legacy (bridge) derivation is deprecated for new keys: rotate to the address-bound derivation " +
        `("${CANONICAL_DERIVATION}"). A legacy key can still be the OLD key of a rotation.`,
    );
  }
  // The sender and the account in the rotation sign-bytes use the canonical
  // lower-case bech32 form, so an upper-case or 0x input builds the same message
  // the canonical input does (matching the Go SDK).
  const account = canonicalAccount(opts.account);
  const oldKp = derivePqcByScheme(oldDerivation, account, mnemonic);
  const newKp = derivePqcByScheme(newDerivation, account, mnemonic);
  if (toHexLower(oldKp.publicKey) === toHexLower(newKp.publicKey)) {
    throw new Error(
      "old and new derivations produce the same key - rotation would be a no-op",
    );
  }
  const sb = enc.encode(
    rotationSignBytes(chainId, algorithmId, account, oldKp.publicKey, newKp.publicKey),
  );
  const msg = rotatePqcKeyMsg({
    sender: account,
    oldPublicKey: oldKp.publicKey,
    newPublicKey: newKp.publicKey,
    oldSignature: mldsa.sign(oldKp.secretKey, sb),
    newSignature: mldsa.sign(newKp.secretKey, sb),
  });
  return { msg, oldKeypair: oldKp, newKeypair: newKp };
}
