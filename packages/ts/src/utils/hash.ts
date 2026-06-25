/**
 * Hash helpers re-exported from [`@noble/hashes`](https://github.com/paulmillr/noble-hashes).
 *
 * Each function accepts a UTF-8 string or raw bytes and returns the digest as
 * raw bytes, with a `*Hex` companion returning a lowercase `0x`-prefixed hex
 * string. No new cryptography is implemented here — these are thin, ergonomic
 * wrappers so callers don't need to depend on `@noble/hashes` directly or pick
 * the right submodule path.
 */

import { sha256 as nobleSha256 } from "@noble/hashes/sha256";
import { keccak_256 as nobleKeccak256 } from "@noble/hashes/sha3";
import { ripemd160 as nobleRipemd160 } from "@noble/hashes/ripemd160";

/** Input accepted by the hash helpers: a UTF-8 string or raw bytes. */
export type HashInput = string | Uint8Array;

const encoder = new TextEncoder();

/** Coerce a {@link HashInput} into bytes (UTF-8 encoding strings). */
function toBytes(input: HashInput): Uint8Array {
  return typeof input === "string" ? encoder.encode(input) : input;
}

/** Encode bytes to a lowercase `0x`-prefixed hex string. */
export function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 digest of `input` as raw bytes. */
export function sha256(input: HashInput): Uint8Array {
  return nobleSha256(toBytes(input));
}

/** SHA-256 digest of `input` as a `0x`-prefixed hex string. */
export function sha256Hex(input: HashInput): string {
  return toHex(sha256(input));
}

/** keccak-256 digest of `input` as raw bytes (the EVM hashing primitive). */
export function keccak256(input: HashInput): Uint8Array {
  return nobleKeccak256(toBytes(input));
}

/** keccak-256 digest of `input` as a `0x`-prefixed hex string. */
export function keccak256Hex(input: HashInput): string {
  return toHex(keccak256(input));
}

/** RIPEMD-160 digest of `input` as raw bytes. */
export function ripemd160(input: HashInput): Uint8Array {
  return nobleRipemd160(toBytes(input));
}

/** RIPEMD-160 digest of `input` as a `0x`-prefixed hex string. */
export function ripemd160Hex(input: HashInput): string {
  return toHex(ripemd160(input));
}
