/**
 * Pluggable signer abstraction.
 *
 * QoreChain supports three signature postures, mirroring the chain's `x/pqc`
 * key types (see the core `PQC_INTEGRATION.md`):
 *
 * - `classical` — a single classical signature (secp256k1 / ed25519). Backward
 *   compatible; no post-quantum material.
 * - `pqc` — an ML-DSA-87 (Dilithium-5) signature only. Maximum quantum safety.
 * - `hybrid` — a classical signature PLUS an ML-DSA-87 signature carried as a TX
 *   extension, so quantum-safe wallets interoperate with classical verification.
 *
 * This module defines only the SIGNING primitives and the shape of their output.
 * Wiring a {@link SignOutput} into a real transaction (attaching the PQC
 * extension to the signed body, fees, broadcast) is the tx-builder's job, not
 * the signer's.
 */

import type { AlgorithmID } from "./pqc-algorithm";

/** Which signature posture a {@link Signer} implements. */
export type SignatureMode = "classical" | "pqc" | "hybrid";

/**
 * The post-quantum portion of a signature, present for `pqc` and `hybrid` modes.
 *
 * Field shapes are chosen so this can be handed straight to
 * `buildHybridSignatureExtension` to produce the on-chain
 * `PQCHybridSignature` TX extension.
 */
export interface PqcSignaturePart {
  /** The PQC signature algorithm. For Dilithium-5 this is {@link AlgorithmID}. */
  algorithmId: AlgorithmID;
  /** Raw PQC signature bytes (ML-DSA-87 / Dilithium-5: 4627 bytes). */
  signature: Uint8Array;
  /**
   * The PQC public key, included so the chain can auto-register it on first use.
   * ML-DSA-87 / Dilithium-5: 2592 bytes.
   */
  publicKey?: Uint8Array;
}

/**
 * The result of signing a message.
 *
 * - `classical` mode: only {@link classicalSignature} is set.
 * - `pqc` mode: only {@link pqc} is set.
 * - `hybrid` mode: BOTH are set.
 */
export interface SignOutput {
  /** Classical signature bytes (present for `classical` and `hybrid`). */
  classicalSignature?: Uint8Array;
  /** Post-quantum signature part (present for `pqc` and `hybrid`). */
  pqc?: PqcSignaturePart;
}

/**
 * A pluggable signer over arbitrary message bytes.
 *
 * `sign` may be synchronous or asynchronous: hardware/remote classical signers
 * are typically async, while the in-process PQC path is synchronous. Callers
 * should always `await` the result.
 */
export interface Signer {
  /** The signature posture this signer implements. */
  readonly mode: SignatureMode;
  /**
   * The public key that identifies the signing account:
   * - `classical` / `hybrid`: the classical public key.
   * - `pqc`: the PQC public key.
   */
  publicKey(): Uint8Array;
  /** Sign the given message bytes. */
  sign(message: Uint8Array): Promise<SignOutput> | SignOutput;
}
