/**
 * Post-quantum (PQC) signing for QoreChain, using ML-DSA-87 (Dilithium-5,
 * NIST FIPS 204) for digital signatures.
 *
 * QoreChain treats PQC as a first-class signature scheme via a hybrid
 * architecture (see the core `PQC_INTEGRATION.md`): a transaction carries the
 * usual classical (secp256k1 / ed25519) signature PLUS an ML-DSA-87 signature
 * attached as a `PQCHybridSignature` TX extension. The chain's ante handler
 * verifies both, so quantum-safe wallets stay compatible with classical
 * verification.
 *
 * Scope: this module provides the signing PRIMITIVES (keygen / sign / verify),
 * a pluggable {@link Signer} for the `pqc` and `hybrid` postures, and a builder
 * for the on-chain hybrid-signature extension OBJECT. It deliberately does NOT
 * assemble or broadcast transactions — the tx-builder attaches the extension
 * the {@link buildHybridSignatureExtension} result describes.
 *
 * Crypto is delegated entirely to `@qorechain/pqc` (`mldsa87`, wrapping the
 * audited, pure-TS `@noble/post-quantum`). No primitives are reimplemented
 * here.
 *
 * Signing is DETERMINISTIC (FIPS-204 §3.4, rnd = 32 zero bytes) by default:
 * the chain's on-chain PQC verifier accepts ONLY deterministic ML-DSA-87
 * signatures (hedged signatures are rejected with codespace `pqc`), so this
 * default is consensus-critical. Pass `{ hedged: true }` to {@link pqcSign}
 * only for off-chain uses that want side-channel hedging.
 */

import { mldsa87 } from "@qorechain/pqc";
import { randomBytes } from "@noble/hashes/utils";
import {
  AlgorithmDilithium5,
  isSignatureAlgorithm,
  algorithmName,
  type AlgorithmID,
} from "./pqc-algorithm";
import type { Signer, SignOutput, PqcSignaturePart } from "./signer";

export {
  AlgorithmUnspecified,
  AlgorithmDilithium5,
  AlgorithmMLKEM1024,
  algorithmName,
  isSignatureAlgorithm,
  type AlgorithmID,
} from "./pqc-algorithm";
export type {
  Signer,
  SignOutput,
  SignatureMode,
  PqcSignaturePart,
} from "./signer";

/**
 * ML-DSA-87 (Dilithium-5) byte lengths.
 *
 * These are fixed by NIST FIPS 204 and match the chain's `x/pqc` constants
 * exactly. We encode the standard's values directly; the test suite asserts
 * that the library actually produces keys/signatures of these lengths,
 * guarding against any future library drift.
 */
/** ML-DSA-87 public-key length, in bytes (FIPS 204 / core: 2592). */
export const ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
/** ML-DSA-87 secret-key length, in bytes (FIPS 204 / core: 4896). */
export const ML_DSA_87_SECRET_KEY_LENGTH = 4896;
/** ML-DSA-87 signature length, in bytes (FIPS 204 / core: 4627). */
export const ML_DSA_87_SIGNATURE_LENGTH = 4627;

/** Length, in bytes, of the deterministic-keygen seed (xi) per FIPS 204. */
export const ML_DSA_87_SEED_LENGTH = 32;

/**
 * The TX-extension type URL for the on-chain `PQCHybridSignature` message
 * (core: `HybridSigTypeURL`). The tx-builder uses this as the extension's
 * type URL when packing the object from {@link buildHybridSignatureExtension}.
 */
export const HYBRID_SIG_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature";

/** An ML-DSA-87 (Dilithium-5) keypair. Treat `secretKey` as a secret. */
export interface PqcKeypair {
  /** 2592-byte ML-DSA-87 public key. */
  publicKey: Uint8Array;
  /** 4896-byte ML-DSA-87 secret key. Handle as a secret; never logged. */
  secretKey: Uint8Array;
}

/**
 * Generate an ML-DSA-87 (Dilithium-5) keypair.
 *
 * @param seed Optional 32-byte seed for deterministic keygen (e.g. derived from
 *   a wallet). When omitted, a cryptographically random keypair is produced.
 *   Must be exactly {@link ML_DSA_87_SEED_LENGTH} bytes if provided.
 */
export function generatePqcKeypair(seed?: Uint8Array): PqcKeypair {
  if (seed !== undefined && seed.length !== ML_DSA_87_SEED_LENGTH) {
    throw new Error(
      `ML-DSA-87 seed must be ${ML_DSA_87_SEED_LENGTH} bytes, got ${seed.length}`,
    );
  }
  // When no seed is supplied, draw a fresh random 32-byte seed so keygen always
  // receives one explicitly (a random seed yields a random keypair).
  const xi = seed ?? randomBytes(ML_DSA_87_SEED_LENGTH);
  const kp = mldsa87.keygen(xi);
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Sign a message with an ML-DSA-87 (Dilithium-5) secret key.
 *
 * DETERMINISTIC (FIPS-204 §3.4, rnd = 32 zero bytes) by default — the same
 * `(secretKey, message)` always yields the same signature. The chain's PQC
 * verifier accepts ONLY deterministic signatures, so do not pass
 * `{ hedged: true }` for anything that goes on-chain.
 */
export function pqcSign(
  secretKey: Uint8Array,
  message: Uint8Array,
  opts?: { hedged?: boolean },
): Uint8Array {
  return mldsa87.sign(secretKey, message, opts);
}

/** Verify an ML-DSA-87 (Dilithium-5) signature over a message. */
export function pqcVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  return mldsa87.verify(publicKey, message, signature);
}

/**
 * The on-chain `PQCHybridSignature` TX extension, as a plain object whose keys
 * mirror the core struct's JSON field tags EXACTLY
 * (`x/pqc/types/hybrid.go`):
 *
 * ```go
 * type PQCHybridSignature struct {
 *   AlgorithmID  AlgorithmID `json:"algorithm_id"`
 *   PQCSignature []byte      `json:"pqc_signature"`
 *   PQCPublicKey []byte      `json:"pqc_public_key,omitempty"`
 * }
 * ```
 *
 * The tx-builder is responsible for encoding this and attaching it under
 * {@link HYBRID_SIG_TYPE_URL}.
 */
export interface PQCHybridSignature {
  /** PQC algorithm ID (core `AlgorithmID`). */
  algorithm_id: AlgorithmID;
  /** Raw PQC signature bytes. */
  pqc_signature: Uint8Array;
  /** Optional PQC public key for auto-registration on first use. */
  pqc_public_key?: Uint8Array;
}

/**
 * Build the on-chain `PQCHybridSignature` extension object from a signature.
 *
 * Validation mirrors the core `PQCHybridSignature.Validate()`: the algorithm
 * must be a signature scheme, the signature must be non-empty, and for
 * Dilithium-5 the signature/public-key lengths are enforced.
 *
 * `pqc_public_key` is omitted entirely when no public key is supplied, matching
 * the `omitempty` JSON tag on the core struct.
 */
export function buildHybridSignatureExtension(args: {
  algorithmId: AlgorithmID;
  signature: Uint8Array;
  publicKey?: Uint8Array;
}): PQCHybridSignature {
  const { algorithmId, signature, publicKey } = args;

  if (!isSignatureAlgorithm(algorithmId)) {
    throw new Error(
      `algorithm ${algorithmName(algorithmId)} is not a PQC signature algorithm`,
    );
  }
  if (signature.length === 0) {
    throw new Error("PQC signature cannot be empty");
  }
  if (algorithmId === AlgorithmDilithium5) {
    if (signature.length !== ML_DSA_87_SIGNATURE_LENGTH) {
      throw new Error(
        `dilithium5 signature must be ${ML_DSA_87_SIGNATURE_LENGTH} bytes, got ${signature.length}`,
      );
    }
    if (publicKey !== undefined && publicKey.length !== ML_DSA_87_PUBLIC_KEY_LENGTH) {
      throw new Error(
        `dilithium5 public key must be ${ML_DSA_87_PUBLIC_KEY_LENGTH} bytes, got ${publicKey.length}`,
      );
    }
  }

  const ext: PQCHybridSignature = {
    algorithm_id: algorithmId,
    pqc_signature: signature,
  };
  if (publicKey !== undefined) {
    ext.pqc_public_key = publicKey;
  }
  return ext;
}

/**
 * A pqc-only {@link Signer}: produces an ML-DSA-87 (Dilithium-5) signature and
 * no classical signature. Corresponds to the chain's `pqc_only` key type.
 */
export class PqcSigner implements Signer {
  readonly mode = "pqc" as const;
  private readonly keypair: PqcKeypair;
  private readonly algorithmId: AlgorithmID;

  constructor(keypair: PqcKeypair, algorithmId: AlgorithmID = AlgorithmDilithium5) {
    this.keypair = keypair;
    this.algorithmId = algorithmId;
  }

  /** The PQC public key (the signing identity in pqc-only mode). */
  publicKey(): Uint8Array {
    return this.keypair.publicKey;
  }

  async sign(message: Uint8Array): Promise<SignOutput> {
    const part: PqcSignaturePart = {
      algorithmId: this.algorithmId,
      signature: pqcSign(this.keypair.secretKey, message),
      publicKey: this.keypair.publicKey,
    };
    return { pqc: part };
  }
}

/**
 * A hybrid {@link Signer}: wraps a classical signer and an ML-DSA-87 keypair,
 * producing BOTH a classical signature and a PQC signature over the same
 * message. Corresponds to the chain's `hybrid` key type.
 *
 * The account identity is the wrapped classical signer's public key, so a
 * hybrid account is indistinguishable from a classical one to wallets that do
 * not understand the PQC extension.
 */
export class HybridSigner implements Signer {
  readonly mode = "hybrid" as const;
  private readonly classical: Signer;
  private readonly keypair: PqcKeypair;
  private readonly algorithmId: AlgorithmID;

  /**
   * @param classical The wrapped classical signer. Must be a `classical`-mode
   *   signer; its `classicalSignature` output is passed through unchanged.
   * @param keypair The ML-DSA-87 keypair used for the PQC half.
   * @throws if `classical` is not a `classical`-mode signer.
   */
  constructor(
    classical: Signer,
    keypair: PqcKeypair,
    algorithmId: AlgorithmID = AlgorithmDilithium5,
  ) {
    if (classical.mode !== "classical") {
      throw new Error("HybridSigner requires a classical-mode signer");
    }
    this.classical = classical;
    this.keypair = keypair;
    this.algorithmId = algorithmId;
  }

  /** The classical public key — the on-chain account identity. */
  publicKey(): Uint8Array {
    return this.classical.publicKey();
  }

  async sign(message: Uint8Array): Promise<SignOutput> {
    const classicalOut = await this.classical.sign(message);
    if (classicalOut.classicalSignature === undefined) {
      throw new Error(
        "wrapped classical signer did not produce a classical signature",
      );
    }
    const part: PqcSignaturePart = {
      algorithmId: this.algorithmId,
      signature: pqcSign(this.keypair.secretKey, message),
      publicKey: this.keypair.publicKey,
    };
    return { classicalSignature: classicalOut.classicalSignature, pqc: part };
  }
}
