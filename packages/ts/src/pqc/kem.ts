/**
 * The KEM key registry (chain v3.2.5, `x/pqc`).
 *
 * An account publishes one key-encapsulation public key so that anyone can
 * encrypt to it: a sender reads the key from the chain, encapsulates a shared
 * secret to it, and only the holder of the matching secret key recovers it. The
 * key is not an authentication key; the account keeps signing with its
 * ML-DSA-87 key.
 *
 * - Algorithm: ML-KEM-1024 (FIPS 203), algorithm id {@link KEM_ALGORITHM_ML_KEM_1024}.
 *   Other algorithms come only by governance.
 * - One key per account. Registering again replaces it (the response says
 *   `replaced`); `msg.pqc.removeKemKey` withdraws it.
 * - No proof of possession: the registration is authenticated by the
 *   account's hybrid signature, which these messages always need (the account
 *   must hold a usable post-quantum signature key, `pqc` 254 otherwise). Both
 *   messages are refused through authz.
 * - The chain stores and serves the raw key only. Encryption is not part of
 *   this SDK.
 *
 * Messages: `msg.pqc.registerKemKey`, `msg.pqc.removeKemKey`. Read:
 * {@link fetchKemKey} (`GET /qorechain/pqc/v1/kem/{address}`, bech32 or `0x`).
 */

import type { FetchLike } from "../query/http";
import { AlgorithmMLKEM1024 } from "../accounts/pqc-algorithm";

/** Algorithm id of ML-KEM-1024 in the chain's algorithm registry. */
export const KEM_ALGORITHM_ML_KEM_1024 = AlgorithmMLKEM1024;

/** Size of an ML-KEM-1024 encapsulation (public) key, in bytes. */
export const ML_KEM_1024_PUBLIC_KEY_SIZE = 1568;

/** Type URL of `MsgRegisterKEMKey`. */
export const REGISTER_KEM_KEY_TYPE_URL = "/qorechain.pqc.v1.MsgRegisterKEMKey";
/** Type URL of `MsgRemoveKEMKey`. */
export const REMOVE_KEM_KEY_TYPE_URL = "/qorechain.pqc.v1.MsgRemoveKEMKey";

// FIPS 203: q = 3329; the key is ByteEncode12(t_hat) || rho, t_hat being four
// polynomials of 384 bytes.
const MLKEM_Q = 3329;
const T_HAT_BYTES = 4 * 384;

/**
 * The chain's stateless check on a KEM public key, run by
 * `msg.pqc.registerKemKey` before encoding. For ML-KEM-1024: exactly
 * {@link ML_KEM_1024_PUBLIC_KEY_SIZE} bytes, every 12-bit coefficient of
 * `t_hat` below 3329 (the FIPS 203 modulus check), and `t_hat` not all zero.
 * Keys of another algorithm id pass through; the chain checks them against its
 * registry. Throws an `Error` naming the problem.
 */
export function validateKemPublicKey(
  publicKey: Uint8Array | undefined,
  algorithmId: number = KEM_ALGORITHM_ML_KEM_1024,
): void {
  if (!Number.isInteger(algorithmId) || algorithmId <= 0) {
    throw new Error(`registerKemKey: algorithmId must be a positive integer, got ${algorithmId}`);
  }
  if (!(publicKey instanceof Uint8Array) || publicKey.length === 0) {
    throw new Error("registerKemKey: publicKey is required");
  }
  if (algorithmId !== KEM_ALGORITHM_ML_KEM_1024) return;
  if (publicKey.length !== ML_KEM_1024_PUBLIC_KEY_SIZE) {
    throw new Error(
      `registerKemKey: an ML-KEM-1024 public key is ${ML_KEM_1024_PUBLIC_KEY_SIZE} bytes, got ${publicKey.length}`,
    );
  }
  let zero = true;
  for (let i = 0; i < T_HAT_BYTES; i += 3) {
    const b0 = publicKey[i];
    const b1 = publicKey[i + 1];
    const b2 = publicKey[i + 2];
    const c0 = b0 | ((b1 & 0x0f) << 8);
    const c1 = (b1 >> 4) | (b2 << 4);
    if (c0 >= MLKEM_Q || c1 >= MLKEM_Q) {
      throw new Error(
        `registerKemKey: not an ML-KEM-1024 public key (coefficient at byte ${i} is not below ${MLKEM_Q})`,
      );
    }
    if (b0 | b1 | b2) zero = false;
  }
  if (zero) {
    throw new Error("registerKemKey: the public key's t_hat is all zero, so anything encrypted to it is readable by anyone");
  }
}

/** A published KEM key. */
export interface KemKey {
  /** Bech32 address of the account that published it. */
  address: string;
  /** Algorithm id (2 = ML-KEM-1024). */
  algorithmId: number;
  /** Algorithm name as the chain reports it (e.g. `mlkem1024`). */
  algorithmName: string;
  /** The encapsulation key, raw bytes. */
  publicKey: Uint8Array;
  /** Height of the registration that published this key (a replacement resets it). */
  registeredHeight: bigint;
}

/** Result of {@link fetchKemKey}. */
export interface KemKeyResult {
  found: boolean;
  key?: KemKey;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Parse the JSON of `GET /qorechain/pqc/v1/kem/{address}`. */
export function parseKemKey(body: unknown): KemKeyResult {
  const b = (body ?? {}) as { found?: boolean; key?: Record<string, unknown> | null };
  const k = b.key;
  if (!b.found || !k) return { found: false };
  return {
    found: true,
    key: {
      address: typeof k.address === "string" ? k.address : "",
      algorithmId: Number(k.algorithm_id ?? 0),
      algorithmName: typeof k.algorithm_name === "string" ? k.algorithm_name : "",
      publicKey: typeof k.public_key === "string" ? fromBase64(k.public_key) : new Uint8Array(),
      registeredHeight: BigInt(String(k.registered_height ?? "0") || "0"),
    },
  };
}

/**
 * Read the KEM key an address published (`GET /qorechain/pqc/v1/kem/{address}`).
 *
 * @param opts.rest - The network's REST URL.
 * @param opts.address - Bech32 (`qor1...`) or `0x` address.
 */
export async function fetchKemKey(opts: { rest: string; address: string; fetch?: FetchLike }): Promise<KemKeyResult> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}/qorechain/pqc/v1/kem/${encodeURIComponent(opts.address)}`;
  const res = await f(url);
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* no JSON body */
    }
    throw new Error(`KEM key query failed: HTTP ${res.status} from ${url}${detail ? `: ${detail}` : ""}`);
  }
  return parseKemKey(await res.json());
}
