export const VERSION = "0.1.0";

export * from "./config/networks";
export * from "./utils/denom";
export * from "./utils/address";

// Accounts & keys. Re-export the documented derivation functions and types only.
// The derive functions return key material deliberately (callers need it for
// signing); nothing here leaks secrets implicitly.
export {
  generateMnemonic,
  validateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "./accounts/wallet";
export type {
  KeyType,
  Account,
  DerivationOptions,
  Secp256k1Account,
  Ed25519Account,
} from "./accounts/types";

// Post-quantum (PQC) signing: ML-DSA-87 (Dilithium-5) primitives, the pluggable
// Signer abstraction, and the on-chain hybrid-signature extension builder.
export {
  AlgorithmUnspecified,
  AlgorithmDilithium5,
  AlgorithmMLKEM1024,
  algorithmName,
  isSignatureAlgorithm,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  ML_DSA_87_SEED_LENGTH,
  HYBRID_SIG_TYPE_URL,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  buildHybridSignatureExtension,
  PqcSigner,
  HybridSigner,
} from "./accounts/pqc";
export type {
  AlgorithmID,
  PqcKeypair,
  PQCHybridSignature,
  Signer,
  SignOutput,
  SignatureMode,
  PqcSignaturePart,
} from "./accounts/pqc";
