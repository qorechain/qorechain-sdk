/**
 * Cross-VM address validation and EIP-55 checksum helpers.
 *
 * QoreChain spans three address formats: bech32 (`qor1...`, validated in
 * `utils/address`), EVM hex (`0x...`, 20 bytes), and SVM ed25519 public keys
 * (base58, 32 bytes). These helpers validate the EVM and SVM forms and expose
 * the EIP-55 mixed-case checksum used by EVM tooling.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { base58 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519";

const encoder = new TextEncoder();

/**
 * Test whether `address` is a structurally valid EVM address: `0x` followed by
 * exactly 40 hex characters (20 bytes). Case is not checked; use
 * {@link isChecksumAddress} to verify an EIP-55 checksum. Never throws.
 */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Compute the EIP-55 mixed-case checksum form of an EVM address.
 *
 * Hashes the lowercase hex (without `0x`) with keccak-256 and uppercases each
 * hex nibble whose corresponding hash nibble is >= 8.
 *
 * @param address - A 20-byte EVM address, with or without `0x`, any case.
 * @returns The `0x`-prefixed checksummed address.
 * @throws If `address` is not a valid 20-byte hex address.
 */
export function toChecksumAddress(address: string): string {
  const body = (address.startsWith("0x") || address.startsWith("0X")
    ? address.slice(2)
    : address
  ).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(body)) {
    throw new Error(`invalid EVM address: ${address}`);
  }
  const hash = keccak_256(encoder.encode(body));
  let out = "0x";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else {
      // Each byte covers two nibbles; pick the high or low nibble per position.
      const hashByte = hash[i >> 1];
      const nibble = i % 2 === 0 ? hashByte >> 4 : hashByte & 0x0f;
      out += nibble >= 8 ? ch.toUpperCase() : ch;
    }
  }
  return out;
}

/**
 * Test whether `address` is a correctly EIP-55-checksummed EVM address.
 *
 * Returns `true` only if the address is structurally valid *and* its mixed-case
 * pattern matches {@link toChecksumAddress}. All-lowercase or all-uppercase
 * addresses (which carry no checksum information) return `false`. Never throws.
 */
export function isChecksumAddress(address: string): boolean {
  if (!isValidEvmAddress(address)) return false;
  try {
    const body = address.slice(2);
    // Pure single-case addresses are valid hex but carry no checksum.
    if (body === body.toLowerCase() || body === body.toUpperCase()) return false;
    return toChecksumAddress(address) === address;
  } catch {
    return false;
  }
}

/**
 * Test whether `address` is a valid SVM (Solana-compatible) public-key address:
 * a base58 string decoding to exactly 32 bytes that is a valid ed25519 curve
 * point. Off-curve PDAs are intentionally rejected. Never throws.
 */
export function isValidSvmAddress(address: string): boolean {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    return false;
  }
  if (bytes.length !== 32) return false;
  try {
    // A valid account address is an ed25519 public key (on the curve).
    ed25519.Point.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}
