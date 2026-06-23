/**
 * Adapter from a native QoreChain secp256k1 key to a cosmjs signer.
 *
 * The accounts module (`deriveNativeAccount`, Task 13) yields a raw 32-byte
 * secp256k1 private key. The transaction layer signs through cosmjs's
 * `SigningStargateClient`, which expects an `OfflineDirectSigner`. This module
 * bridges the two via `@cosmjs/proto-signing`'s `DirectSecp256k1Wallet`, binding
 * the key to the network's bech32 account prefix (`qor`).
 *
 * The signer performs SIGN_MODE_DIRECT (protobuf) signing — the native chain's
 * default — so the produced address and signatures match what the node's ante
 * handler verifies for a classical secp256k1 account.
 */

import {
  DirectSecp256k1Wallet,
  type OfflineDirectSigner,
} from "@cosmjs/proto-signing";

/**
 * Adapt a raw secp256k1 private key into a cosmjs {@link OfflineDirectSigner}.
 *
 * @param privateKey - Raw 32-byte secp256k1 private key (e.g. the `privateKey`
 *   field of a {@link Secp256k1Account} from `deriveNativeAccount`).
 * @param prefix - Bech32 account prefix for the network (QoreChain: `"qor"`).
 * @returns A direct (protobuf) offline signer whose single account address is
 *   the bech32 encoding of the key under `prefix`.
 */
export async function directSignerFromPrivateKey(
  privateKey: Uint8Array,
  prefix: string,
): Promise<OfflineDirectSigner> {
  if (privateKey.length !== 32) {
    throw new Error(
      `secp256k1 private key must be 32 bytes, got ${privateKey.length}`,
    );
  }
  return DirectSecp256k1Wallet.fromKey(privateKey, prefix);
}
