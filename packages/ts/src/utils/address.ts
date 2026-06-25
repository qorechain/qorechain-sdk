/**
 * Conversion and validation for QoreChain bech32 addresses (e.g. `qor1...`) and
 * their underlying byte payloads expressed as `0x`-prefixed hex.
 *
 * bech32 stores data as 5-bit groups ("words"), so encoding/decoding goes
 * through {@link bech32.toWords}/{@link bech32.fromWords} to convert to and from
 * the 8-bit byte representation that callers work with as hex.
 */

import { bech32 } from "bech32";

/** Default bech32 human-readable prefix for QoreChain account addresses. */
const DEFAULT_PREFIX = "qor";

/**
 * bech32 enforces a 90-character limit by default. QoreChain addresses are
 * short, but validator/consensus prefixes plus longer payloads can approach it,
 * so we raise the limit to a safe upper bound to avoid spurious failures.
 */
const LIMIT = 1023;

/** Strip an optional `0x`/`0X` prefix from a hex string. */
function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

/** Parse a hex string (with or without `0x`) into bytes, validating strictly. */
function hexToBytes(hex: string): Uint8Array {
  const body = stripHexPrefix(hex);
  if (body.length === 0 || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Encode bytes to a lowercase `0x`-prefixed hex string. */
function bytesToHex(bytes: ArrayLike<number>): string {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Decode a bech32 address to a `0x`-prefixed hex string of its byte payload.
 *
 * @param addr - A bech32 address, e.g. `qor1...`.
 * @returns The underlying bytes as lowercase `0x`-prefixed hex.
 * @throws If `addr` is not a valid bech32 string.
 */
export function bech32ToHex(addr: string): string {
  const { words } = bech32.decode(addr, LIMIT);
  const bytes = bech32.fromWords(words);
  return bytesToHex(bytes);
}

/**
 * Encode raw bytes to a bech32 address with the given prefix.
 *
 * This is the primitive encoder; callers holding a `Uint8Array` payload (e.g.
 * the 20-byte `ripemd160(sha256(pubkey))` account hash) should use this
 * directly rather than round-tripping through hex.
 *
 * @param bytes - The raw byte payload.
 * @param prefix - The bech32 human-readable prefix. Defaults to `"qor"`.
 * @returns The bech32-encoded address, e.g. `qor1...`.
 */
export function bytesToBech32(
  bytes: Uint8Array,
  prefix: string = DEFAULT_PREFIX,
): string {
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words, LIMIT);
}

/**
 * Encode hex bytes to a bech32 address with the given prefix.
 *
 * @param hex - The byte payload as hex, with or without a `0x` prefix.
 * @param prefix - The bech32 human-readable prefix. Defaults to `"qor"`.
 * @returns The bech32-encoded address, e.g. `qor1...`.
 * @throws If `hex` is not a valid hex string.
 */
export function hexToBech32(hex: string, prefix: string = DEFAULT_PREFIX): string {
  return bytesToBech32(hexToBytes(hex), prefix);
}

/**
 * Validate a bech32 address, optionally requiring a specific prefix.
 *
 * @param addr - The candidate address string.
 * @param prefix - If given, the decoded prefix must match exactly.
 * @returns `true` if `addr` is a structurally valid bech32 string (correct
 *   checksum) and, when `prefix` is supplied, its prefix matches; `false`
 *   otherwise. Never throws.
 */
export function isValidBech32(addr: string, prefix?: string): boolean {
  const decoded = bech32.decodeUnsafe(addr, LIMIT);
  if (!decoded) {
    return false;
  }
  return prefix === undefined ? true : decoded.prefix === prefix;
}

/**
 * Decode a QoreChain bech32 account address into the `0x`-prefixed hex form of
 * its 20-byte payload — the same byte payload an EVM address carries.
 *
 * QoreChain shares one account-key space across its VMs: a native `qor1...`
 * address and the matching EVM `0x...` address are two encodings of the same
 * underlying account bytes. This is the bech32 → EVM-hex direction; it is an
 * alias of {@link bech32ToHex} named for the cross-VM use case.
 *
 * @param addr - A `qor1...` bech32 account address.
 * @returns The 20-byte payload as a lowercase `0x`-prefixed hex string.
 * @throws If `addr` is not a valid bech32 string.
 */
export function qorToEvm(addr: string): string {
  return bech32ToHex(addr);
}

/**
 * Encode an EVM `0x...` address into the matching QoreChain bech32 account
 * address. The hex → bech32 direction of {@link qorToEvm}; an alias of
 * {@link hexToBech32} with the `qor` account prefix.
 *
 * @param hex - A 20-byte EVM address, with or without `0x`.
 * @param prefix - bech32 prefix. Defaults to `"qor"`.
 * @returns The bech32 account address, e.g. `qor1...`.
 * @throws If `hex` is not a valid hex string.
 */
export function evmToQor(hex: string, prefix: string = DEFAULT_PREFIX): string {
  return hexToBech32(hex, prefix);
}
