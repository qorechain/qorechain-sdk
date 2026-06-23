/**
 * PQC algorithm identifiers, mirroring the chain's `x/pqc` cryptographic-agility
 * framework (core `x/pqc/types/algorithm.go`).
 *
 * These numeric IDs are the on-the-wire values the chain expects in
 * `MsgRegisterPQCKeyV2.algorithm_id` and in the `PQCHybridSignature` TX
 * extension's `algorithm_id` field, so they MUST stay in sync with the core enum.
 */

/**
 * Identifies a PQC algorithm. Numeric to match the chain's `uint32 AlgorithmID`.
 * IDs 1–2 are the initial algorithms; 3–255 are reserved for future
 * governance-approved algorithms.
 */
export type AlgorithmID = number;

/** Unset / invalid algorithm (core: `AlgorithmUnspecified`). */
export const AlgorithmUnspecified: AlgorithmID = 0;
/** Dilithium-5 = ML-DSA-87, NIST FIPS 204 signatures (core: `AlgorithmDilithium5`). */
export const AlgorithmDilithium5: AlgorithmID = 1;
/** ML-KEM-1024, NIST FIPS 203 key encapsulation (core: `AlgorithmMLKEM1024`). */
export const AlgorithmMLKEM1024: AlgorithmID = 2;

/** Human-readable name for an algorithm ID (matches core `AlgorithmID.String()`). */
export function algorithmName(id: AlgorithmID): string {
  switch (id) {
    case AlgorithmUnspecified:
      return "unspecified";
    case AlgorithmDilithium5:
      return "dilithium5";
    case AlgorithmMLKEM1024:
      return "mlkem1024";
    default:
      return `algorithm_${id}`;
  }
}

/** True if the algorithm is a digital-signature scheme (core `IsSignature`). */
export function isSignatureAlgorithm(id: AlgorithmID): boolean {
  return id === AlgorithmDilithium5;
}
