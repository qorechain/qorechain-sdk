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
