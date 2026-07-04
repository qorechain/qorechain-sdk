/**
 * Unified eth-native QoreChain accounts.
 *
 * ONE `eth_secp256k1` key = ONE 20-byte identity, rendered THREE ways so a wallet
 * never "has funds on one lane but not another". The 20 bytes are the Ethereum
 * derivation `keccak256(uncompressedPubkey[1:])[12:]`, so the key is natively
 * spendable on the EVM lane; the native (`qor1…`) and SVM (base58) forms are just
 * other encodings of the SAME 20 bytes — the chain reads one x/bank balance for
 * the account, visible under all three encodings.
 *
 * This is ADDITIVE. The legacy coin-118 native derivation
 * ({@link ../accounts/wallet.deriveNativeAccount}) is unchanged and still
 * supported; unified accounts are a distinct, opt-in identity model built on the
 * eth-native (coin-60) key.
 *
 * ```
 *   {
 *     mnemonic, privateKey (0x hex, 32B),
 *     publicKey (33B compressed, 0x hex),
 *     addressBytes (20B),
 *     cosmos: "qor1…",              // bech32
 *     evm:    "0x…" (EIP-55),       // hex
 *     svm:    "<base58>",           // base58(20B ‖ 12 zero bytes) = 32-byte addr
 *     pqc:    { publicKey, secretKey }  // ML-DSA-87 (Dilithium-5), for the hybrid ante
 *   }
 * ```
 *
 * Derivation uses audited primitives: @scure/bip39 (mnemonic + seed), @scure/bip32
 * (secp256k1 HD), @noble/curves (secp256k1), @noble/hashes (keccak256), @scure/base
 * (base58), and `@qorechain/pqc` (ML-DSA-87 + SHAKE-256). Secret material is
 * returned explicitly and never logged.
 */

import { mnemonicToSeed } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { base58 } from "@scure/base";
import { shake256 } from "@qorechain/pqc";

import { bytesToBech32, bech32ToHex } from "../utils/address";
import { validateMnemonic } from "./wallet";
import { generatePqcKeypair, type PqcKeypair } from "./pqc";

/** Bech32 human-readable prefix for QoreChain account addresses. */
const HRP = "qor";

/** Ethereum HD path (coin-type 60): makes the 20-byte address the keccak derivation. */
const ETH_HD_PATH_PREFIX = "m/44'/60'/0'/0/";

/**
 * The three address encodings of a single 20-byte QoreChain account, plus the
 * raw address bytes.
 */
export interface UnifiedAddresses {
  /** The raw 20-byte account address. */
  addressBytes: Uint8Array;
  /** Bech32 (`qor1…`) native encoding. */
  cosmos: string;
  /** `0x`-prefixed, EIP-55 mixed-case checksummed hex encoding. */
  evm: string;
  /** base58 of the 32-byte SVM address (`addr20 ‖ 12 zero bytes`). */
  svm: string;
}

/**
 * A fully derived unified eth-native account: one secp256k1 key rendered as all
 * three QoreChain address encodings, plus its deterministic ML-DSA-87 PQC keypair
 * for the hybrid ante.
 *
 * Secret fields (`mnemonic`, `privateKey`, `pqc.secretKey`) are returned so the
 * caller can sign; they are never logged by the SDK.
 */
export interface UnifiedAccount extends UnifiedAddresses {
  /**
   * The BIP-39 mnemonic this account was derived from, when derived from a
   * mnemonic. `undefined` for seed-derived accounts
   * ({@link unifiedAccountFromSeed}).
   */
  mnemonic?: string;
  /** `0x`-prefixed 32-byte secp256k1 private key. Handle as a secret. */
  privateKey: string;
  /** `0x`-prefixed 33-byte compressed secp256k1 public key. */
  publicKey: string;
  /** The ML-DSA-87 (Dilithium-5) keypair for the hybrid signature extension. */
  pqc: PqcKeypair;
}

/** Encode bytes to a lowercase `0x`-prefixed hex string. */
function toHexPrefixed(bytes: Uint8Array): string {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Lowercase hex (no `0x`) of bytes. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Render 20 address bytes as an EIP-55 mixed-case checksummed `0x` address.
 *
 * EIP-55: lowercase the hex address, take keccak256 of the lowercase hex (without
 * `0x`) as ASCII, and uppercase each hex nibble whose corresponding keccak nibble
 * is >= 8.
 */
function toEip55(addr20: Uint8Array): string {
  const lower = toHex(addr20);
  const hashHex = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hashHex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/**
 * Derive the three address encodings from a 20-byte account address.
 *
 * The SVM form is the base58 of the 32-byte address `addr20 ‖ 12 zero bytes`
 * (right-padded), matching the chain's unified 32-byte SVM address layout.
 *
 * @throws if `addr20` is not exactly 20 bytes.
 */
export function addressesFrom20(addr20: Uint8Array): UnifiedAddresses {
  if (addr20.length !== 20) {
    throw new Error(`address must be 20 bytes, got ${addr20.length}`);
  }
  const svmBytes = new Uint8Array(32);
  svmBytes.set(addr20, 0); // right-pad with 12 zero bytes → unified 32-byte SVM address
  return {
    addressBytes: addr20,
    cosmos: bytesToBech32(addr20, HRP),
    evm: toEip55(addr20),
    svm: base58.encode(svmBytes),
  };
}

/**
 * Decode any ONE of the three encodings of a unified account into all three.
 *
 * Provide exactly one of `cosmos` (`qor1…`), `evm` (`0x…`), or `hex` (20-byte
 * hex, with or without `0x`). The SVM base58 form is not accepted as input here
 * (it right-pads to 32 bytes; decode SVM externally to its 20-byte prefix if
 * needed).
 *
 * @throws if none of the inputs is provided, or the decoded payload is not 20 bytes.
 */
export function qoreAddresses(input: {
  cosmos?: string;
  evm?: string;
  hex?: string;
}): UnifiedAddresses {
  let addr20: Uint8Array;
  if (input.evm) {
    addr20 = hexToBytes(input.evm);
  } else if (input.hex) {
    addr20 = hexToBytes(input.hex);
  } else if (input.cosmos) {
    addr20 = bech32DataBytes(input.cosmos);
  } else {
    throw new Error("provide one of { cosmos, evm, hex }");
  }
  return addressesFrom20(addr20);
}

/** Parse a hex string (with or without `0x`) into bytes. */
function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (body.length === 0 || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Decode the raw byte payload of a bech32 (`qor1…`) address. `bech32ToHex`
 * returns `0x`-prefixed hex of the payload bytes. */
function bech32DataBytes(addr: string): Uint8Array {
  return hexToBytes(bech32ToHex(addr));
}

/**
 * The domain-separation context for the deterministic PQC seed. The 32-byte
 * SHAKE-256 of `"qorechain:pqc:v1|" + <cosmos-addr> + "|" + <secret>` is used as
 * the ML-DSA-87 keygen seed, so the PQC key is recoverable from the account and
 * the same secret. `<secret>` is the mnemonic for mnemonic-derived accounts and
 * the hex of the 32-byte seed for seed-derived accounts.
 */
const PQC_SEED_CONTEXT = "qorechain:pqc:v1|";

/** Derive the deterministic ML-DSA-87 keypair for an account. */
function derivePqc(cosmosAddr: string, secret: string): PqcKeypair {
  const seed = shake256(
    new TextEncoder().encode(`${PQC_SEED_CONTEXT}${cosmosAddr}|${secret}`),
    32,
  );
  return generatePqcKeypair(seed);
}

/** Build the address + PQC bundle from a 32-byte secp256k1 private key + secret. */
function accountFromPrivateKey(
  privkey: Uint8Array,
  pqcSecret: string,
): { addresses: UnifiedAddresses; publicKey: Uint8Array; pqc: PqcKeypair } {
  // Compressed (33B) public key for the SignerInfo pubkey; uncompressed (65B) for
  // the keccak address derivation.
  const compressed = secp256k1.getPublicKey(privkey, true); // 33 bytes
  const uncompressed = secp256k1.getPublicKey(privkey, false); // 65 bytes: 0x04||X||Y
  const addr20 = keccak_256(uncompressed.slice(1)).slice(12); // last 20 bytes
  const addresses = addressesFrom20(addr20);
  const pqc = derivePqc(addresses.cosmos, pqcSecret);
  return { addresses, publicKey: compressed, pqc };
}

/**
 * Derive a unified eth-native QoreChain account from a BIP-39 mnemonic.
 *
 * HD path: `m/44'/60'/0'/0/{index}` (SLIP-10 secp256k1). The 20-byte address is
 * `keccak256(uncompressedPubkey[1:])[12:]`; the PQC key is deterministically
 * derived from `shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32)`.
 *
 * @param mnemonic - A valid BIP-39 English mnemonic. Validated (checksum too).
 * @param index - Zero-based address index (last path segment). Defaults to `0`.
 * @throws if the mnemonic is invalid or `index` is not a non-negative integer.
 */
export async function deriveUnifiedAccount(
  mnemonic: string,
  index = 0,
): Promise<UnifiedAccount> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("invalid mnemonic");
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`index must be a non-negative integer, got ${index}`);
  }
  const seed = await mnemonicToSeed(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(`${ETH_HD_PATH_PREFIX}${index}`);
  if (!node.privateKey) {
    throw new Error("failed to derive secp256k1 key from mnemonic");
  }
  const privkey = node.privateKey;
  const { addresses, publicKey, pqc } = accountFromPrivateKey(privkey, mnemonic);
  return {
    mnemonic,
    privateKey: toHexPrefixed(privkey),
    publicKey: toHexPrefixed(publicKey),
    ...addresses,
    pqc,
  };
}

/**
 * Build a unified eth-native account directly from a 32-byte seed used AS the
 * secp256k1 private key (no HD derivation).
 *
 * Same address derivation as {@link deriveUnifiedAccount}; the PQC key is derived
 * from `shake256("qorechain:pqc:v1|" + cosmos + "|seed:" + hex(seed32), 32)` (note
 * the literal `"seed:"` prefix, so a seed-derived PQC key never collides with a
 * mnemonic-derived one). Use this for accounts anchored to a signature or an
 * externally supplied secret (see the Phantom P1a helper).
 *
 * @param seed32 - Exactly 32 bytes, used directly as the secp256k1 private key.
 * @throws if `seed32` is not 32 bytes or is not a valid secp256k1 scalar.
 */
export function unifiedAccountFromSeed(seed32: Uint8Array): UnifiedAccount {
  if (seed32.length !== 32) {
    throw new Error(`seed must be 32 bytes, got ${seed32.length}`);
  }
  if (!secp256k1.utils.isValidPrivateKey(seed32)) {
    throw new Error("seed is not a valid secp256k1 private key");
  }
  // Seed-derived accounts prefix the private-key hex with a literal "seed:" in
  // the PQC seed context (matches the reference wallet-adapter `walletFromSeed`),
  // so a seed-derived PQC key never collides with a mnemonic-derived one.
  const { addresses, publicKey, pqc } = accountFromPrivateKey(
    seed32,
    `seed:${toHex(seed32)}`,
  );
  return {
    privateKey: toHexPrefixed(seed32),
    publicKey: toHexPrefixed(publicKey),
    ...addresses,
    pqc,
  };
}
