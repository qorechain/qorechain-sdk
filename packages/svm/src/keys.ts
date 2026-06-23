/**
 * Key helpers for QoreChain's Solana-compatible runtime.
 *
 * These are thin wrappers over `@solana/web3.js` so callers don't need a second
 * import path. `@qorechain/sdk`'s `deriveSvmAccount(mnemonic)` provides the
 * 64-byte `secretKey` you can pass straight into {@link svmKeypairFromSecretKey}.
 */

import { Keypair, PublicKey } from "@solana/web3.js";

/**
 * Reconstruct a `@solana/web3.js` `Keypair` from a 64-byte ed25519 secret key
 * (the standard Solana secret-key encoding: 32-byte seed + 32-byte public key).
 *
 * Pair with `@qorechain/sdk`'s `deriveSvmAccount`, which returns this exact
 * 64-byte `secretKey`.
 */
export function svmKeypairFromSecretKey(secretKey: Uint8Array): Keypair {
  if (secretKey.length !== 64) {
    throw new Error(
      `svmKeypairFromSecretKey: expected a 64-byte secret key, got ${secretKey.length}`,
    );
  }
  return Keypair.fromSecretKey(secretKey);
}

/** Return the base58 address for a `Keypair` or a `PublicKey`. */
export function svmAddress(key: Keypair | PublicKey): string {
  const pubkey = key instanceof PublicKey ? key : key.publicKey;
  return pubkey.toBase58();
}
