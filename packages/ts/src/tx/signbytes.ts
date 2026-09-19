/**
 * Sign-bytes for the payloads a QoreChain key signs outside SIGN_MODE_DIRECT:
 * the post-quantum half of a hybrid transaction, a PQC key migration, and a
 * bridge attestation. Each exists in two forms, and a network verifies exactly
 * ONE of them at any height — there is no overlap window.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Which form to sign
 * ──────────────────────────────────────────────────────────────────────────
 * Chain release v3.1.98 introduced the v2 forms, which bind a domain tag and
 * the chain id. Networks that existed before it (`qorechain-vladi`,
 * `qorechain-diana`) verify v1 until the `v3.1.98` upgrade plan is applied on
 * that network, and v2 from then on. Any other chain verifies v2 from its first
 * block. The testnet and mainnet switch at different heights, so a client must
 * ask the target network rather than hardcode either form:
 *
 *     GET {rest}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98 -> {"height":"<n>"}
 *     v2 iff n > 0, or the chain is not one of the legacy networks.
 *
 * The height is an int64 and crosses the REST gateway as a STRING; a network
 * that has not upgraded answers `{"height":"0"}` (or `{}` on older nodes), so
 * the decision is numeric, never a presence check.
 *
 * {@link resolveSignBytesVersion} does this with a short cache;
 * {@link signBytesVersionFor} is the pure rule for callers that already know
 * the applied height.
 */

import type { FetchLike } from "../query/http";

/** A concrete sign-bytes form. */
export type SignBytesVersion = "v1" | "v2";

/** A form, or `"auto"` to ask the target network. */
export type SignBytesVersionOption = SignBytesVersion | "auto";

/** The upgrade plan whose application switches a legacy network to v2. */
export const SIGN_BYTES_V2_UPGRADE = "v3.1.98";

/** Networks that ran before v2 existed and switch only at {@link SIGN_BYTES_V2_UPGRADE}. */
export const LEGACY_SIGN_BYTES_CHAINS: readonly string[] = [
  "qorechain-vladi",
  "qorechain-diana",
];

/** Domain tag of the v2 hybrid PQC sign-bytes. */
export const HYBRID_SIGN_BYTES_V2_DOMAIN = "qorechain-pqc-hybrid-v2";
/** Domain tag of the v2 PQC key-migration sign-bytes. */
export const MIGRATION_SIGN_BYTES_V2_DOMAIN = "qorechain-key-migration-v2";
/** Domain tag of the v2 bridge attestation sign-bytes. */
export const BRIDGE_ATTESTATION_V2_DOMAIN = "qorechain-bridge-attestation-v2";

const utf8 = new TextEncoder();

function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function be64(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), false);
  return b;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function assertVersion(version: string): asserts version is SignBytesVersion {
  if (version !== "v1" && version !== "v2") {
    throw new Error(`sign-bytes version must be "v1" or "v2", got ${JSON.stringify(version)}`);
  }
}

// ─── Hybrid PQC transaction ─────────────────────────────────────────────────

/** v1 hybrid form: `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A`. */
export function hybridSignBytesV1(b0: Uint8Array, authInfo: Uint8Array): Uint8Array {
  return concat([be32(b0.length), b0, be32(authInfo.length), authInfo]);
}

/**
 * v2 hybrid form:
 * `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A`.
 */
export function hybridSignBytesV2(
  chainId: string,
  b0: Uint8Array,
  authInfo: Uint8Array,
): Uint8Array {
  const cid = utf8.encode(chainId);
  return concat([
    utf8.encode(HYBRID_SIGN_BYTES_V2_DOMAIN),
    be64(cid.length),
    cid,
    be32(b0.length),
    b0,
    be32(authInfo.length),
    authInfo,
  ]);
}

/**
 * The message the ML-DSA key signs for a hybrid transaction, in the given form.
 * `B0` is the `TxBody` WITHOUT the PQC extension; `authInfo` is the AuthInfo
 * bytes verbatim.
 */
export function hybridSignBytes(
  version: SignBytesVersion,
  chainId: string,
  b0: Uint8Array,
  authInfo: Uint8Array,
): Uint8Array {
  assertVersion(version);
  return version === "v2"
    ? hybridSignBytesV2(chainId, b0, authInfo)
    : hybridSignBytesV1(b0, authInfo);
}

// ─── PQC key migration ──────────────────────────────────────────────────────

/** Inputs of the key-migration sign-bytes (both keys sign the same bytes). */
export interface MigrationSignBytesInput {
  chainId: string;
  /** The migrating account's `qor1…` address. */
  account: string;
  fromAlgorithmId: number;
  toAlgorithmId: number;
  /** The height the migration executes at. */
  height: number | bigint;
  /** The current public key (v2 only). */
  oldPublicKey: Uint8Array;
  /** The destination public key (v2 only). */
  newPublicKey: Uint8Array;
}

/**
 * v1 key-migration form (ASCII):
 * `qorechain-key-migration:chain=<chainId>:from=<from>:to=<to>:account=<account>:height=<height>`.
 */
export function migrationSignBytesV1(input: Omit<MigrationSignBytesInput, "oldPublicKey" | "newPublicKey">): Uint8Array {
  return utf8.encode(
    `qorechain-key-migration:chain=${input.chainId}:from=${input.fromAlgorithmId}` +
      `:to=${input.toAlgorithmId}:account=${input.account}:height=${BigInt(input.height)}`,
  );
}

/**
 * v2 key-migration form:
 * `"qorechain-key-migration-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE64(len account) ‖ account ‖
 *  BE32(from) ‖ BE32(to) ‖ BE64(height) ‖ BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub`.
 */
export function migrationSignBytesV2(input: MigrationSignBytesInput): Uint8Array {
  const cid = utf8.encode(input.chainId);
  const acct = utf8.encode(input.account);
  return concat([
    utf8.encode(MIGRATION_SIGN_BYTES_V2_DOMAIN),
    be64(cid.length),
    cid,
    be64(acct.length),
    acct,
    be32(input.fromAlgorithmId),
    be32(input.toAlgorithmId),
    be64(input.height),
    be32(input.oldPublicKey.length),
    input.oldPublicKey,
    be32(input.newPublicKey.length),
    input.newPublicKey,
  ]);
}

/** The key-migration sign-bytes in the given form. */
export function migrationSignBytes(
  version: SignBytesVersion,
  input: MigrationSignBytesInput,
): Uint8Array {
  assertVersion(version);
  return version === "v2" ? migrationSignBytesV2(input) : migrationSignBytesV1(input);
}

// ─── Bridge attestation ─────────────────────────────────────────────────────

/** Inputs of a bridge attestation payload (validator signers only). */
export interface BridgeAttestationSignBytesInput {
  chainId: string;
  chain: string;
  eventType: string;
  operationId: string;
  txHash: string;
  /** The amount as the chain prints it (`math.Int.String()`). */
  amount: string;
  asset: string;
}

/** v1 attestation form (ASCII, no chain id): `chain|eventType|operationId|txHash|amount|asset`. */
export function bridgeAttestationSignBytesV1(
  input: Omit<BridgeAttestationSignBytesInput, "chainId">,
): Uint8Array {
  return utf8.encode(
    [input.chain, input.eventType, input.operationId, input.txHash, input.amount, input.asset].join("|"),
  );
}

/**
 * v2 attestation form: `"qorechain-bridge-attestation-v2"` then, for each of
 * `[chainId, chain, eventType, operationId, txHash, amount, asset]`, `BE64(len f) ‖ f`.
 */
export function bridgeAttestationSignBytesV2(input: BridgeAttestationSignBytesInput): Uint8Array {
  const parts: Uint8Array[] = [utf8.encode(BRIDGE_ATTESTATION_V2_DOMAIN)];
  for (const f of [
    input.chainId,
    input.chain,
    input.eventType,
    input.operationId,
    input.txHash,
    input.amount,
    input.asset,
  ]) {
    const b = utf8.encode(f);
    parts.push(be64(b.length), b);
  }
  return concat(parts);
}

/** The bridge attestation sign-bytes in the given form. */
export function bridgeAttestationSignBytes(
  version: SignBytesVersion,
  input: BridgeAttestationSignBytesInput,
): Uint8Array {
  assertVersion(version);
  return version === "v2"
    ? bridgeAttestationSignBytesV2(input)
    : bridgeAttestationSignBytesV1(input);
}

// ─── Choosing the form ──────────────────────────────────────────────────────

/** True when `chainId` is a network that verifies v1 until its v3.1.98 upgrade. */
export function isLegacySignBytesChain(chainId: string): boolean {
  return LEGACY_SIGN_BYTES_CHAINS.includes(chainId);
}

/**
 * The form a network verifies, given the height at which the v3.1.98 plan was
 * applied on it (0 when it has not been). Client-side mirror of the chain's
 * own switch.
 */
export function signBytesVersionFor(
  chainId: string,
  v2AppliedHeight: number | bigint,
): SignBytesVersion {
  return BigInt(v2AppliedHeight) > 0n || !isLegacySignBytesChain(chainId) ? "v2" : "v1";
}

/** Parse the applied-plan height. The REST gateway sends int64 as a string. */
function parseAppliedHeight(body: unknown): bigint {
  const h = (body as { height?: unknown } | null)?.height;
  if (h === undefined || h === null || h === "") return 0n;
  if (typeof h !== "string" && typeof h !== "number" && typeof h !== "bigint") {
    throw new Error(`unexpected applied_plan height ${JSON.stringify(h)}`);
  }
  return BigInt(h);
}

/**
 * Ask a node at which height the v3.1.98 plan was applied (0 when not).
 * @throws on a transport or parse failure — the caller must not guess.
 */
export async function fetchSignBytesV2AppliedHeight(
  rest: string,
  fetchImpl: FetchLike = globalThis.fetch as FetchLike,
): Promise<bigint> {
  const url = `${rest.replace(/\/+$/, "")}/cosmos/upgrade/v1beta1/applied_plan/${SIGN_BYTES_V2_UPGRADE}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`applied_plan query failed: HTTP ${res.status} from ${url}`);
  }
  return parseAppliedHeight(await res.json());
}

/** Options for {@link resolveSignBytesVersion}. */
export interface ResolveSignBytesVersionOptions {
  chainId: string;
  /** The network's REST (LCD) base URL. Required for `"auto"` on a legacy network. */
  rest?: string;
  /** `"auto"` (default) asks the network; `"v1"`/`"v2"` are returned as-is. */
  signBytesVersion?: SignBytesVersionOption;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** How long an answer is reused, in ms. Defaults to 60000. */
  ttlMs?: number;
  /** Bypass the cache (e.g. after a `pqc` code 21 refusal). */
  forceRefresh?: boolean;
}

const cache = new Map<string, { version: SignBytesVersion; at: number }>();

/** Forget every cached answer. */
export function clearSignBytesCache(): void {
  cache.clear();
}

/**
 * The form to sign for a network right now.
 *
 * - `"v1"` / `"v2"`: returned unchanged, no network call.
 * - `"auto"` on a chain that is not a legacy network: `"v2"`, no network call.
 * - `"auto"` on `qorechain-vladi` / `qorechain-diana`: asks `rest` whether the
 *   v3.1.98 plan is applied; the answer is cached per (rest, chainId) for
 *   `ttlMs` because a network can upgrade while a wallet stays open.
 *
 * @throws when a legacy network has no `rest`, or the query fails. Pass an
 * explicit `"v1"`/`"v2"` in that case — a wrong guess is refused on-chain.
 */
export async function resolveSignBytesVersion(
  opts: ResolveSignBytesVersionOptions,
): Promise<SignBytesVersion> {
  const requested = opts.signBytesVersion ?? "auto";
  if (requested === "v1" || requested === "v2") return requested;
  if (requested !== "auto") {
    throw new Error(`signBytesVersion must be "auto", "v1" or "v2", got ${JSON.stringify(requested)}`);
  }
  if (!isLegacySignBytesChain(opts.chainId)) return "v2";
  if (!opts.rest) {
    throw new Error(
      `cannot choose the hybrid sign-bytes form for ${opts.chainId} without its REST endpoint: ` +
        `pass rest, or signBytesVersion "v1" (before the ${SIGN_BYTES_V2_UPGRADE} upgrade) or "v2" (after)`,
    );
  }
  const key = `${opts.rest} ${opts.chainId}`;
  const ttl = opts.ttlMs ?? 60_000;
  const hit = cache.get(key);
  if (!opts.forceRefresh && hit && Date.now() - hit.at < ttl) return hit.version;

  let height: bigint;
  try {
    height = await fetchSignBytesV2AppliedHeight(opts.rest, opts.fetch);
  } catch (e) {
    throw new Error(
      `cannot ask ${opts.rest} whether ${SIGN_BYTES_V2_UPGRADE} is applied (${(e as Error).message}); ` +
        `pass signBytesVersion "v1" or "v2"`,
    );
  }
  const version = signBytesVersionFor(opts.chainId, height);
  cache.set(key, { version, at: Date.now() });
  return version;
}

/** The chain's message for a hybrid signature that does not verify (`pqc` code 21). */
export const HYBRID_SIGN_BYTES_REJECTION_LOG = "hybrid PQC signature verification failed";

/**
 * True when a broadcast failure is the chain refusing the hybrid PQC signature
 * (`pqc` code 21) — the symptom of signing the wrong sign-bytes form. Accepts a
 * thrown cosmjs `BroadcastTxError` (`code`, `codespace`, `log`), a
 * `DeliverTxResponse`-like result (`code`, `rawLog`), or a plain `Error`.
 * Code 21 from any other codespace does NOT match.
 */
export function isHybridSignBytesRejection(x: unknown): boolean {
  if (x === null || x === undefined) return false;
  const o = x as {
    code?: unknown;
    codespace?: unknown;
    log?: unknown;
    rawLog?: unknown;
    message?: unknown;
  };
  if (o.codespace === "pqc" && Number(o.code) === 21) return true;
  for (const t of [o.log, o.rawLog, o.message]) {
    if (typeof t === "string" && t.includes(HYBRID_SIGN_BYTES_REJECTION_LOG)) return true;
  }
  return false;
}
