/**
 * Phantom P1a — derive a unified QoreChain account from a Phantom signature.
 *
 * A user can bootstrap ONE canonical QoreChain identity (native / EVM / SVM, one
 * balance) from their Phantom wallet WITHOUT exporting any key: they sign a fixed,
 * domain-separated message with Phantom's ed25519 key, and the 32-byte SHAKE-256
 * of that signature seeds a unified eth-native secp256k1 account
 * ({@link ../accounts/unified.unifiedAccountFromSeed}).
 *
 * This is NON-CUSTODIAL and produces a SEPARATE canonical key from the Phantom
 * ed25519 key — Phantom never sees the derived secp256k1/PQC secrets, and the
 * derived account is a distinct on-chain identity, not the Phantom address. As
 * long as the same Phantom key signs the same fixed message, the same QoreChain
 * account is reproduced deterministically.
 */

import { shake256 } from "@qorechain/pqc";
import { base58 } from "@scure/base";
import {
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "./unified";

/**
 * The fixed domain-separation prefix signed by Phantom. The full signed message
 * is this line, a newline, and the signer's base58 public key — binding the
 * derivation to the specific Phantom key.
 */
export const PHANTOM_DERIVATION_DOMAIN =
  "QoreChain unified account derivation v1";

/**
 * Derive a unified QoreChain account from a raw Phantom (ed25519) signature.
 *
 * The account seed is `shake256(signatureBytes, 32)`, used directly as the
 * eth-native secp256k1 private key. Deterministic: the same signature always
 * yields the same account.
 *
 * @param signatureBytes - The raw ed25519 signature bytes returned by the wallet.
 */
export function unifiedAccountFromPhantomSignature(
  signatureBytes: Uint8Array,
): UnifiedAccount {
  const seed = shake256(signatureBytes, 32);
  return unifiedAccountFromSeed(seed);
}

/**
 * The minimal shape of an injected Phantom-style provider used here: `connect`
 * to obtain the public key and `signMessage` to sign the derivation message.
 */
export interface PhantomProvider {
  connect(): Promise<{ publicKey: { toBytes(): Uint8Array } | Uint8Array }>;
  publicKey?: { toBytes(): Uint8Array } | Uint8Array | null;
  signMessage(
    message: Uint8Array,
    encoding?: string,
  ): Promise<{ signature: Uint8Array } | Uint8Array>;
}

/** Normalize a provider public key (object with `toBytes` or raw bytes) to bytes. */
function pubkeyBytes(
  pk: { toBytes(): Uint8Array } | Uint8Array | null | undefined,
): Uint8Array {
  if (!pk) throw new Error("Phantom provider exposed no public key");
  if (pk instanceof Uint8Array) return pk;
  return pk.toBytes();
}

/** Normalize a `signMessage` result (object with `.signature` or raw bytes) to bytes. */
function signatureBytes(
  res: { signature: Uint8Array } | Uint8Array,
): Uint8Array {
  return res instanceof Uint8Array ? res : res.signature;
}

/** Options for {@link connectPhantomUnified}. */
export interface ConnectPhantomUnifiedOptions {
  /**
   * The Phantom-style provider. Defaults to `window.solana` in a browser. Pass an
   * explicit provider in tests or non-`window.solana` environments.
   */
  provider?: PhantomProvider;
}

/**
 * Connect Phantom in the browser and derive the user's unified QoreChain account.
 *
 * Flow: `connect()` → sign the fixed domain-separated message
 * `"QoreChain unified account derivation v1\n<phantom-pubkey-base58>"` → derive the
 * unified account from the signature via
 * {@link unifiedAccountFromPhantomSignature}.
 *
 * NON-CUSTODIAL: the returned account is a separate canonical key from the Phantom
 * ed25519 key; Phantom never handles the derived secp256k1/PQC secrets.
 *
 * @throws if no provider is available or the wallet returns no public key.
 */
export async function connectPhantomUnified(
  opts: ConnectPhantomUnifiedOptions = {},
): Promise<UnifiedAccount> {
  const provider =
    opts.provider ??
    (globalThis as { solana?: PhantomProvider }).solana ??
    undefined;
  if (!provider) {
    throw new Error(
      "no Phantom provider found (window.solana); pass opts.provider",
    );
  }

  const conn = await provider.connect();
  const pk = pubkeyBytes(
    provider.publicKey ??
      (conn as { publicKey?: { toBytes(): Uint8Array } | Uint8Array }).publicKey,
  );
  const message = `${PHANTOM_DERIVATION_DOMAIN}\n${base58.encode(pk)}`;
  const signed = await provider.signMessage(
    new TextEncoder().encode(message),
    "utf8",
  );
  return unifiedAccountFromPhantomSignature(signatureBytes(signed));
}
