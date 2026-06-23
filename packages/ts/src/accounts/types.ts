/**
 * Account and key types for the three address schemes QoreChain supports.
 *
 * All three derive from a single BIP-39 mnemonic via separate BIP-44 / SLIP-0010
 * paths, so one seed phrase yields a native QoreChain account, an EVM account,
 * and an SVM account independently.
 */

/** The address/key scheme an {@link Account} belongs to. */
export type KeyType = "native" | "evm" | "svm";

/**
 * A derived account, without secret material.
 *
 * `publicKey` is the compressed 33-byte secp256k1 public key for `native`/`evm`
 * accounts, or the bare 32-byte ed25519 public key for `svm` accounts.
 */
export interface Account {
  /** Which address scheme this account uses. */
  type: KeyType;
  /**
   * The encoded address:
   * - `native`: bech32 with the `qor` prefix (e.g. `qor1...`)
   * - `evm`: `0x`-prefixed, EIP-55 mixed-case checksummed hex
   * - `svm`: base58-encoded 32-byte ed25519 public key
   */
  address: string;
  /** Compressed secp256k1 (native/evm) or 32-byte ed25519 (svm) public key. */
  publicKey: Uint8Array;
}

/** Options controlling which account in the wallet to derive. */
export interface DerivationOptions {
  /**
   * Zero-based address index, varying the last path segment. Defaults to `0`.
   * - native/evm: `m/44'/{118|60}'/0'/0/{index}`
   * - svm: `m/44'/501'/{index}'/0'`
   */
  accountIndex?: number;
}

/**
 * A native QoreChain or EVM account including its 32-byte secp256k1 private key.
 * Callers need the private key for signing; it is returned explicitly and never
 * logged by the SDK.
 */
export interface Secp256k1Account extends Account {
  /** Raw 32-byte secp256k1 private key. Handle as a secret. */
  privateKey: Uint8Array;
}

/**
 * An SVM account including its ed25519 secret key.
 *
 * `secretKey` follows the Solana convention of 64 bytes (`seed32 || pubkey32`),
 * which is what `@solana/web3.js` `Keypair.fromSecretKey` expects. Handle as a
 * secret; it is never logged by the SDK.
 */
export interface Ed25519Account extends Account {
  /** 64-byte Solana-style secret key (`privateSeed32 || publicKey32`). */
  secretKey: Uint8Array;
}
