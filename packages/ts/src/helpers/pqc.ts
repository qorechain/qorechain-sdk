/**
 * High-level quantum-safe developer-experience helpers.
 *
 * QoreChain treats post-quantum cryptography (PQC) as a first-class signature
 * scheme: an account registers an ML-DSA-87 (Dilithium-5) key on-chain
 * (`MsgRegisterPQCKey`), after which its transactions can carry a hybrid
 * (classical secp256k1 + ML-DSA-87) signature that the ante handler verifies in
 * full. The low-level primitives already exist — {@link generatePqcKeypair},
 * {@link buildHybridTx}, {@link signAndBroadcastHybrid}, the
 * `msg.pqc.registerPqcKey` composer, and the `qor_getPQCKeyStatus` read. This
 * module wraps them into a tiny, idempotent surface so a dApp becomes
 * **quantum-safe by default**: one call to be PQC-protected.
 *
 * The headline calls:
 *  - {@link isPqcRegistered} / {@link getPqcStatus} — read whether an address has
 *    a registered PQC key (via `qor_getPQCKeyStatus`).
 *  - {@link ensurePqcRegistered} — register the signer's Dilithium key if (and
 *    only if) it is not already registered. Idempotent: safe to call on every
 *    app start.
 *  - {@link migrateToHybrid} — ensure registration, then hand back a hybrid send
 *    path wired to {@link buildHybridTx} / {@link signAndBroadcastHybrid}.
 *  - {@link migratePqcKey} — rotate an account's PQC key (`MsgMigratePQCKey`).
 *
 * Reads accept either a {@link QorClient} or anything exposing a `qor`
 * sub-client (e.g. the composed `QoreChainClient` from `createClient`). Writes
 * take a connected {@link TxClient}.
 *
 * Precompile alternative: the same status is readable on the EVM side via the
 * `pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes
 * pubkey)` precompile at `0x0000000000000000000000000000000000000A02` (exposed
 * as `pqcKeyStatus` in `@qorechain/evm`). The helpers below prefer the
 * `qor_getPQCKeyStatus` JSON-RPC method, which needs no viem peer; the
 * precompile is the documented alternative for callers already on the EVM side.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import { pqc as pqcMsg } from "../messages/qorechain";
import {
  generatePqcKeypair,
  AlgorithmDilithium5,
  type PqcKeypair,
} from "../accounts/pqc";
import type { TxClient, FeeInput, AutoFeeOptions } from "../tx/builder";
import type { BroadcastResult } from "../tx/broadcast";
import type { QorClient } from "../query/qor";
import {
  buildHybridTx,
  signAndBroadcastHybrid,
  type BuildHybridTxOptions,
  type SignAndBroadcastHybridOptions,
  type BuiltHybridTx,
} from "../tx/hybrid-tx";

/** EVM precompile address for the `pqcKeyStatus` read (documented alternative). */
export const PQC_KEY_STATUS_PRECOMPILE_ADDRESS =
  "0x0000000000000000000000000000000000000A02";

/**
 * A source for PQC status reads: either a {@link QorClient} directly, or any
 * object exposing one as `.qor` (e.g. the composed `QoreChainClient`).
 */
export type PqcStatusSource = QorClient | { qor: QorClient };

/** Resolve the underlying {@link QorClient} from a {@link PqcStatusSource}. */
function resolveQor(source: PqcStatusSource): QorClient {
  if ("qor" in source && source.qor) return source.qor;
  return source as QorClient;
}

/** Normalized PQC registration status for an address. */
export interface PqcStatus {
  /** Whether the address has a registered PQC key. */
  registered: boolean;
  /** The registered algorithm id, when known (Dilithium-5 = {@link AlgorithmDilithium5}). */
  algorithmId?: number;
  /** The registered PQC public key, when the chain returns it (hex or bytes). */
  pubkey?: string | Uint8Array;
}

/** Truthy-coerce a JSON value the chain may return as bool/number/string. */
function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
}

/** Parse a numeric field the chain may return as number or string. */
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/**
 * Read the PQC registration status of an address via `qor_getPQCKeyStatus`.
 *
 * The chain returns a rich JSON object; this helper normalizes the common
 * fields (`registered`, `algorithmId`/`algorithm_id`, `pubkey`/`public_key`)
 * into a {@link PqcStatus}. Unknown shapes degrade to `{ registered: false }`.
 *
 * Alternative: on the EVM side, call the `pqcKeyStatus(address)` precompile at
 * {@link PQC_KEY_STATUS_PRECOMPILE_ADDRESS} (via `@qorechain/evm`).
 */
export async function getPqcStatus(
  source: PqcStatusSource,
  address: string,
): Promise<PqcStatus> {
  const qor = resolveQor(source);
  const raw = await qor.getPqcKeyStatus<Record<string, unknown>>(address);
  if (raw == null || typeof raw !== "object") {
    return { registered: false };
  }

  const registered = asBool(
    raw.registered ?? raw.isRegistered ?? raw.is_registered,
  );
  const algorithmId = asNumber(raw.algorithmId ?? raw.algorithm_id);
  const pubkeyRaw = raw.pubkey ?? raw.publicKey ?? raw.public_key;
  const pubkey =
    typeof pubkeyRaw === "string" || pubkeyRaw instanceof Uint8Array
      ? pubkeyRaw
      : undefined;

  const status: PqcStatus = { registered };
  if (algorithmId !== undefined) status.algorithmId = algorithmId;
  if (pubkey !== undefined) status.pubkey = pubkey;
  return status;
}

/**
 * Whether `address` has a registered PQC key.
 *
 * Thin boolean wrapper over {@link getPqcStatus} using `qor_getPQCKeyStatus`
 * (preferred). The EVM `pqcKeyStatus` precompile is the documented alternative.
 */
export async function isPqcRegistered(
  source: PqcStatusSource,
  address: string,
): Promise<boolean> {
  const status = await getPqcStatus(source, address);
  return status.registered;
}

/** Options for {@link ensurePqcRegistered}. */
export interface EnsurePqcRegisteredOptions {
  /**
   * The signer's ML-DSA-87 (Dilithium-5) keypair. Its `publicKey` is registered
   * on-chain as the account's Dilithium key.
   */
  pqcKeypair: PqcKeypair;
  /**
   * The account's classical ECDSA (secp256k1) public key, registered alongside
   * the Dilithium key. When omitted, an empty key is sent — the chain binds the
   * registration to the transaction signer, so this is optional for accounts
   * whose classical key is already known on-chain.
   */
  ecdsaPubkey?: Uint8Array;
  /** Key-type tag forwarded to `MsgRegisterPQCKey` (default `"hybrid"`). */
  keyType?: string;
  /** Fee: explicit `StdFee` or `"auto"` (simulate + price). Default `"auto"`. */
  fee?: FeeInput;
  /** Optional memo string. */
  memo?: string;
  /** Auto-fee tuning when `fee` is `"auto"`. */
  autoFee?: AutoFeeOptions;
  /**
   * A pre-read status to avoid a redundant `qor_getPQCKeyStatus` round-trip. When
   * provided and `registered`, the registration is skipped.
   */
  status?: PqcStatus;
  /**
   * A status source for the pre-flight registration check. When omitted, the
   * registration message is broadcast unconditionally (relying on the chain's
   * own idempotency) — pass `{ qor }` to make the helper truly idempotent.
   */
  statusSource?: PqcStatusSource;
}

/** Result of {@link ensurePqcRegistered}. */
export interface EnsurePqcRegisteredResult {
  /** `true` when the key was already registered (no transaction was sent). */
  alreadyRegistered: boolean;
  /** The registration transaction hash, when a registration was broadcast. */
  txHash?: string;
  /** The raw broadcast result, when a registration was broadcast. */
  result?: BroadcastResult;
}

/**
 * Build the `MsgRegisterPQCKey` for a signer without broadcasting.
 *
 * Useful for packing registration into a larger transaction body, or for the
 * offline build path.
 */
export function buildRegisterPqcKeyMsg(
  sender: string,
  opts: Pick<EnsurePqcRegisteredOptions, "pqcKeypair" | "ecdsaPubkey" | "keyType">,
): EncodeObject {
  return pqcMsg.registerPqcKey({
    sender,
    dilithiumPubkey: opts.pqcKeypair.publicKey,
    ecdsaPubkey: opts.ecdsaPubkey ?? new Uint8Array(0),
    keyType: opts.keyType ?? "hybrid",
  });
}

/**
 * Register the signer's PQC key if it is not already registered — idempotent.
 *
 * If a {@link EnsurePqcRegisteredOptions.statusSource} (or pre-read `status`) is
 * supplied and the key is already registered, this returns
 * `{ alreadyRegistered: true }` WITHOUT broadcasting. Otherwise it builds and
 * broadcasts `MsgRegisterPQCKey` with the signer's Dilithium public key (from
 * `pqcKeypair`) plus the supplied ECDSA public key.
 *
 * This is the single call that makes a dApp quantum-safe: run it once at startup
 * (or before the first hybrid tx) and the account is PQC-protected thereafter.
 *
 * @param tx - A connected signing client (the sender address is its identity).
 * @param opts - The signer's PQC keypair, optional ECDSA pubkey, and write opts.
 */
export async function ensurePqcRegistered(
  tx: TxClient,
  opts: EnsurePqcRegisteredOptions,
): Promise<EnsurePqcRegisteredResult> {
  const sender = tx.senderAddress;

  // Pre-flight: skip the registration entirely when already registered.
  const status =
    opts.status ??
    (opts.statusSource
      ? await getPqcStatus(opts.statusSource, sender)
      : undefined);
  if (status?.registered) {
    return { alreadyRegistered: true };
  }

  const message = buildRegisterPqcKeyMsg(sender, opts);
  const result = await tx.signAndBroadcast(
    [message],
    opts.fee ?? "auto",
    opts.memo ?? "",
    { autoFee: opts.autoFee },
  );
  return {
    alreadyRegistered: false,
    txHash: result.transactionHash,
    result,
  };
}

/** Options for {@link migratePqcKey} (PQC key rotation). */
export interface MigratePqcKeyOptions {
  /** The current (old) PQC public key being rotated out. */
  oldPublicKey: Uint8Array;
  /** The new PQC public key to register. */
  newPublicKey: Uint8Array;
  /** The new key's algorithm id (default {@link AlgorithmDilithium5}). */
  newAlgorithmId?: number;
  /** Signature by the OLD key proving ownership of the rotation request. */
  oldSignature: Uint8Array;
  /** Signature by the NEW key proving ownership of the new key. */
  newSignature: Uint8Array;
  /** Fee: explicit `StdFee` or `"auto"`. Default `"auto"`. */
  fee?: FeeInput;
  /** Optional memo string. */
  memo?: string;
  /** Auto-fee tuning when `fee` is `"auto"`. */
  autoFee?: AutoFeeOptions;
}

/**
 * Rotate an account's PQC key via `MsgMigratePQCKey`.
 *
 * The chain proves ownership of BOTH the old and new keys (the caller supplies
 * `oldSignature` / `newSignature` per the chain's migration contract), so key
 * rotation never strands an account. Use this when upgrading algorithms or
 * rolling a compromised key.
 */
export async function migratePqcKey(
  tx: TxClient,
  opts: MigratePqcKeyOptions,
): Promise<BroadcastResult> {
  const message = pqcMsg.migratePqcKey({
    sender: tx.senderAddress,
    oldPublicKey: opts.oldPublicKey,
    newPublicKey: opts.newPublicKey,
    newAlgorithmId: opts.newAlgorithmId ?? AlgorithmDilithium5,
    oldSignature: opts.oldSignature,
    newSignature: opts.newSignature,
  });
  return tx.signAndBroadcast([message], opts.fee ?? "auto", opts.memo ?? "", {
    autoFee: opts.autoFee,
  });
}

/** Options for {@link migrateToHybrid}. */
export interface MigrateToHybridOptions extends EnsurePqcRegisteredOptions {
  /**
   * A status source used both for the registration pre-flight and (when omitted
   * elsewhere) the idempotency check. Forwarded to {@link ensurePqcRegistered}.
   */
  statusSource?: PqcStatusSource;
}

/**
 * A hybrid send path returned by {@link migrateToHybrid}: the PQC key is
 * guaranteed registered, and these methods build / broadcast hybrid (classical +
 * ML-DSA-87) transactions via {@link buildHybridTx} / {@link signAndBroadcastHybrid}.
 *
 * The `pqcKeypair` is bound, so callers pass everything else hybrid signing
 * needs (registry, classical signer, chainId, account number, sequence, ...).
 */
export interface HybridSendPath {
  /** Whether the PQC key was already registered before this call. */
  alreadyRegistered: boolean;
  /** The registration tx hash, when a registration was broadcast. */
  registrationTxHash?: string;
  /** The bound ML-DSA-87 keypair used for the hybrid half. */
  pqcKeypair: PqcKeypair;
  /** Build a fully signed hybrid tx (PQC keypair pre-bound). */
  buildHybridTx(
    opts: Omit<BuildHybridTxOptions, "pqcKeypair">,
  ): Promise<BuiltHybridTx>;
  /** Build, sign, and broadcast a hybrid tx (PQC keypair pre-bound). */
  signAndBroadcastHybrid(
    opts: Omit<SignAndBroadcastHybridOptions, "pqcKeypair">,
  ): Promise<BroadcastResult>;
}

/**
 * Make an account quantum-safe and hand back a hybrid send path.
 *
 * Ensures the signer's PQC key is registered (idempotent — see
 * {@link ensurePqcRegistered}), then returns a {@link HybridSendPath} with the
 * keypair pre-bound to the existing {@link buildHybridTx} /
 * {@link signAndBroadcastHybrid} builders. After this call, the dApp's
 * transactions can carry a verified hybrid signature.
 *
 * @param tx - A connected signing client (used for the registration tx).
 * @param opts - The PQC keypair and registration/idempotency options.
 */
export async function migrateToHybrid(
  tx: TxClient,
  opts: MigrateToHybridOptions,
): Promise<HybridSendPath> {
  const ensured = await ensurePqcRegistered(tx, opts);
  const pqcKeypair = opts.pqcKeypair;

  return {
    alreadyRegistered: ensured.alreadyRegistered,
    registrationTxHash: ensured.txHash,
    pqcKeypair,
    buildHybridTx: (o) => buildHybridTx({ ...o, pqcKeypair }),
    signAndBroadcastHybrid: (o) =>
      signAndBroadcastHybrid({ ...o, pqcKeypair }),
  };
}

export { generatePqcKeypair };
export type { PqcKeypair };
