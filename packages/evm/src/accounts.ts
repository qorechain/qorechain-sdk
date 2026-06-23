/**
 * Account helpers for the QoreChain EVM Engine.
 *
 * These re-expose viem's account utilities so callers don't need a second import
 * path. `@qorechain/sdk`'s `deriveEvmAccount` returns a `privateKey` you can pass
 * straight into {@link evmAccountFromPrivateKey}.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { Hex, PrivateKeyAccount } from "viem";

/**
 * Create a viem account from a `0x`-prefixed private key.
 *
 * Pair with `@qorechain/sdk`'s `deriveEvmAccount(mnemonic)`, which provides the
 * `privateKey` derived for the EVM coin type.
 */
export function evmAccountFromPrivateKey(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}
