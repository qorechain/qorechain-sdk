/**
 * Mnemonic generation/validation and hierarchical-deterministic (HD) derivation
 * of QoreChain accounts in all three supported schemes:
 *
 * 1. native — Cosmos-style secp256k1, BIP-44 path `m/44'/118'/0'/0/{index}`,
 *    address = bech32(`qor`, ripemd160(sha256(compressedPubkey))).
 * 2. evm    — secp256k1, BIP-44 path `m/44'/60'/0'/0/{index}`,
 *    address = `0x` + last 20 bytes of keccak256(uncompressedPubkey[1:]),
 *    rendered with an EIP-55 mixed-case checksum.
 * 3. svm    — ed25519, SLIP-0010 path `m/44'/501'/{index}'/0'` (all hardened,
 *    the Solana standard), address = base58(32-byte ed25519 public key).
 *
 * Derivation uses audited primitives: @scure/bip39 (mnemonic + seed), @scure/bip32
 * (secp256k1 HD), micro-key-producer SLIP-0010 (ed25519 HD), @noble/hashes and
 * @noble/curves. Secret material is returned explicitly from the derive functions
 * and is never logged.
 *
 * Dependency note: this module pins @noble/hashes/@noble/curves/@scure/base on
 * the 1.x line, while `micro-key-producer` brings its own 2.x copies of those
 * packages. The two majors are installed side by side intentionally. They never
 * exchange hash or curve instances across the boundary — micro-key-producer is
 * used only as a self-contained SLIP-0010 derivation black box (seed in, ed25519
 * node out), so the duplicate copies are isolated and harmless. Do not force a
 * `pnpm.overrides` that drags micro-key-producer onto a different major; that
 * would risk breaking its internals for no behavioural gain here.
 */

import {
  generateMnemonic as bip39Generate,
  validateMnemonic as bip39Validate,
  mnemonicToSeed,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { HDKey as Slip10HDKey } from "micro-key-producer/slip10.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { keccak_256 } from "@noble/hashes/sha3";
import { base58 } from "@scure/base";

import { bytesToBech32 } from "../utils/address";
import type {
  DerivationOptions,
  Secp256k1Account,
  Ed25519Account,
} from "./types";

/** Bech32 human-readable prefix for native QoreChain account addresses. */
const NATIVE_PREFIX = "qor";

/** Coin types per SLIP-0044. */
const COIN_TYPE_NATIVE = 118; // Cosmos
const COIN_TYPE_EVM = 60; // Ethereum
const COIN_TYPE_SVM = 501; // Solana

/**
 * Generate a fresh BIP-39 mnemonic.
 *
 * @param strength - Entropy in bits: `128` → 12 words (default), `256` → 24 words.
 * @returns A space-separated English mnemonic phrase.
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
  return bip39Generate(wordlist, strength);
}

/**
 * Validate a BIP-39 mnemonic against the English wordlist and its checksum.
 *
 * @param mnemonic - The candidate phrase.
 * @returns `true` if the phrase is a structurally valid, checksum-correct
 *   English BIP-39 mnemonic; `false` otherwise. Never throws.
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic, wordlist);
}

/** Resolve the address index from options, defaulting to 0. */
function addressIndex(opts?: DerivationOptions): number {
  const index = opts?.accountIndex ?? 0;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`accountIndex must be a non-negative integer, got ${index}`);
  }
  return index;
}

/**
 * Validate a mnemonic and derive its BIP-39 seed.
 *
 * Centralizing this here is the single guard against the fund-loss footgun where
 * a typo'd phrase (valid words, wrong checksum) would otherwise silently derive
 * a valid-looking but WRONG account. {@link mnemonicToSeed} does NOT check the
 * checksum, so we must validate first. The thrown error deliberately omits the
 * mnemonic text to avoid leaking secret material into logs.
 */
async function seedFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("invalid mnemonic");
  }
  return mnemonicToSeed(mnemonic);
}

/** Derive a secp256k1 HD node at the given BIP-44 path from a mnemonic. */
async function deriveSecp256k1(
  mnemonic: string,
  coinType: number,
  index: number,
): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await seedFromMnemonic(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(
    `m/44'/${coinType}'/0'/0/${index}`,
  );
  if (!node.privateKey || !node.publicKey) {
    throw new Error("failed to derive secp256k1 key from mnemonic");
  }
  // node.publicKey is the 33-byte compressed form.
  return { privateKey: node.privateKey, publicKey: node.publicKey };
}

/**
 * Render 20 address bytes as an EIP-55 mixed-case checksummed `0x` address.
 *
 * EIP-55: lowercase the hex address, take keccak256 of the lowercase hex
 * (without `0x`) as ASCII, and uppercase each hex nibble whose corresponding
 * keccak nibble is >= 8.
 */
function toEip55Checksum(addressBytes: Uint8Array): string {
  const lowerHex = Array.from(addressBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(keccak_256(new TextEncoder().encode(lowerHex)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let out = "0x";
  for (let i = 0; i < lowerHex.length; i++) {
    const c = lowerHex[i];
    out += parseInt(hashHex[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

/**
 * Derive a native QoreChain account (Cosmos-style secp256k1) from a mnemonic.
 *
 * Path: `m/44'/118'/0'/0/{accountIndex}`. The address is the bech32 (`qor`)
 * encoding of `ripemd160(sha256(compressedPublicKey))`.
 *
 * @returns The account including its 32-byte secp256k1 private key.
 */
export async function deriveNativeAccount(
  mnemonic: string,
  opts?: DerivationOptions,
): Promise<Secp256k1Account> {
  const index = addressIndex(opts);
  const { privateKey, publicKey } = await deriveSecp256k1(
    mnemonic,
    COIN_TYPE_NATIVE,
    index,
  );
  const digest = ripemd160(sha256(publicKey)); // 20 bytes
  const address = bytesToBech32(digest, NATIVE_PREFIX);
  return { type: "native", address, publicKey, privateKey };
}

/**
 * Derive an EVM account from a mnemonic.
 *
 * Path: `m/44'/60'/0'/0/{accountIndex}`. The address is the last 20 bytes of
 * `keccak256(uncompressedPublicKey[1:])`, EIP-55 checksummed.
 *
 * @returns The account including its 32-byte secp256k1 private key.
 */
export async function deriveEvmAccount(
  mnemonic: string,
  opts?: DerivationOptions,
): Promise<Secp256k1Account> {
  const index = addressIndex(opts);
  const { privateKey, publicKey } = await deriveSecp256k1(
    mnemonic,
    COIN_TYPE_EVM,
    index,
  );
  // EVM addresses are computed from the 64-byte uncompressed public key body
  // (drop the 0x04 prefix byte). Decompress the already-derived compressed key
  // rather than touching the private key again.
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(
    false,
  ); // 65 bytes
  const hash = keccak_256(uncompressed.slice(1)); // 32 bytes
  const addressBytes = hash.slice(-20); // last 20 bytes
  const address = toEip55Checksum(addressBytes);
  return { type: "evm", address, publicKey, privateKey };
}

/**
 * Derive an SVM (Solana-style ed25519) account from a mnemonic.
 *
 * Path: `m/44'/501'/{accountIndex}'/0'` — the conventional Solana derivation,
 * all segments hardened (SLIP-0010 for ed25519 supports hardened keys only).
 * The address is the base58 encoding of the 32-byte ed25519 public key.
 *
 * @returns The account including its 64-byte Solana-style secret key
 *   (`privateSeed32 || publicKey32`).
 */
export async function deriveSvmAccount(
  mnemonic: string,
  opts?: DerivationOptions,
): Promise<Ed25519Account> {
  const index = addressIndex(opts);
  const seed = await seedFromMnemonic(mnemonic);
  const node = Slip10HDKey.fromMasterSeed(seed).derive(
    `m/44'/${COIN_TYPE_SVM}'/${index}'/0'`,
  );
  const publicKey = node.publicKeyRaw; // bare 32-byte ed25519 public key
  // Solana secret keys are 64 bytes: the 32-byte private seed followed by the
  // 32-byte public key (the format Keypair.fromSecretKey expects).
  const secretKey = new Uint8Array(64);
  secretKey.set(node.privateKey, 0);
  secretKey.set(publicKey, 32);
  const address = base58.encode(publicKey);
  return { type: "svm", address, publicKey, secretKey };
}
