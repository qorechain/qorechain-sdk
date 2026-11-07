/**
 * PQC recovery codes (`QRC1-…`).
 *
 * A recovery code is a SECOND secret, generated at random and held by the user,
 * that the account's classical (secp256k1) key says nothing about. The account's
 * ML-DSA-87 key is derived from it and from the account address, so the PQC half
 * of a hybrid signature needs something the classical half does not have.
 *
 * Format (identical to `@qorechain/wallet-adapter`):
 *
 * ```
 *   QRC1-XXXX-XXXX-…            (14 groups of 4, Crockford base32)
 * ```
 *
 *  - 256 bits of secret entropy plus a 24-bit checksum (35 bytes, 56 characters);
 *  - Crockford base32 (no I, L, O or U, case-insensitive; O is read as 0 and
 *    I / L as 1), so a code copied off paper decodes as meant;
 *  - a mistyped character fails the checksum instead of deriving a key that
 *    matches nothing;
 *  - the `QRC1-` prefix names and versions it.
 *
 * Key derivation:
 *
 * ```
 *   mldsaSeed = SHAKE256("qorechain:pqc:recovery:v1|" + lowercase(qor1) + "|" ‖ secret32, 32)
 *   keypair   = ML-DSA-87 keygen(mldsaSeed)
 * ```
 *
 * The code is the secret. Show it once, have the user write it down, and never
 * store it next to the account's seed phrase or private key.
 */

import { shake256 } from "@qorechain/pqc";
import { randomBytes } from "@noble/hashes/utils";

import { isValidBech32 } from "../utils/address";
import { generatePqcKeypair, type PqcKeypair } from "./pqc";

/** Crockford base32 alphabet (no I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** The recovery code prefix (format version 1). */
export const PQC_RECOVERY_CODE_PREFIX = "QRC1";
/** Bytes of secret entropy carried by a recovery code. */
export const PQC_RECOVERY_SECRET_LENGTH = 32;
const CHECKSUM_BYTES = 3;
const PAYLOAD_BYTES = PQC_RECOVERY_SECRET_LENGTH + CHECKSUM_BYTES; // 35 bytes = 280 bits
const CODE_CHARS = (PAYLOAD_BYTES * 8) / 5; // 56
const GROUP = 4;

const CHECKSUM_DOMAIN = "qorechain:pqc:recovery:v1:checksum";
const KEY_DOMAIN = "qorechain:pqc:recovery:v1";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function checksum(secret: Uint8Array): Uint8Array {
  const input = concat(utf8(CHECKSUM_DOMAIN), secret);
  const sum = shake256(input, CHECKSUM_BYTES);
  input.fill(0);
  return sum;
}

/** MSB-first base32 encoding (35 bytes in, 56 characters out). */
function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(chars: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of chars) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error(`recovery code contains an invalid character "${c}"`);
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const bytes = Uint8Array.from(out);
  out.fill(0);
  return bytes;
}

/**
 * Normalise a typed recovery code: upper-case it, drop spaces and `- _ .`
 * separators, read O as 0 and I / L as 1, and drop the `QRC1` prefix. Returns
 * the 56 data characters.
 *
 * @throws with a message a UI can show when the length is wrong or the code
 *   contains `U`.
 */
export function normalizeRecoveryCode(code: string): string {
  if (typeof code !== "string") throw new Error("recovery code must be a string");
  // Read the confusable letters as meant BEFORE looking for the prefix: someone
  // copying "QRC1" off paper can write "QRCI" or "QRCL".
  let s = code
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  // Strip the prefix only when the length says it is there: 56 data characters
  // can begin with "QRC1" by chance.
  if (s.length === CODE_CHARS + PQC_RECOVERY_CODE_PREFIX.length && s.startsWith(PQC_RECOVERY_CODE_PREFIX)) {
    s = s.slice(PQC_RECOVERY_CODE_PREFIX.length);
  }
  if (s.length !== CODE_CHARS) {
    throw new Error(
      `recovery code must have ${CODE_CHARS} characters after "${PQC_RECOVERY_CODE_PREFIX}-", got ${s.length}`,
    );
  }
  if (s.includes("U")) throw new Error('recovery code contains an invalid character "U"');
  return s;
}

/**
 * Decode a recovery code into its 32-byte secret. The caller owns the returned
 * buffer and should zero it after use.
 *
 * @throws on a malformed code or a checksum mismatch.
 */
export function decodeRecoveryCode(code: string): Uint8Array {
  const payload = decodeBase32(normalizeRecoveryCode(code));
  if (payload.length !== PAYLOAD_BYTES) {
    payload.fill(0);
    throw new Error("recovery code has the wrong length");
  }
  const secret = payload.slice(0, PQC_RECOVERY_SECRET_LENGTH);
  const given = payload.slice(PQC_RECOVERY_SECRET_LENGTH);
  const want = checksum(secret);
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < CHECKSUM_BYTES; i++) diff |= given[i] ^ want[i];
  payload.fill(0);
  if (diff !== 0) {
    secret.fill(0);
    throw new Error("recovery code checksum does not match: a character is mistyped");
  }
  return secret;
}

function formatCode(chars: string): string {
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP) groups.push(chars.slice(i, i + GROUP));
  return `${PQC_RECOVERY_CODE_PREFIX}-${groups.join("-")}`;
}

/**
 * Encode 32 bytes of secret entropy as a `QRC1-…` recovery code, for apps that
 * already hold the secret.
 *
 * @throws if `secret32` is not exactly 32 bytes.
 */
export function pqcRecoveryCodeFromSecret(secret32: Uint8Array): string {
  if (!(secret32 instanceof Uint8Array) || secret32.length !== PQC_RECOVERY_SECRET_LENGTH) {
    throw new Error(`recovery secret must be ${PQC_RECOVERY_SECRET_LENGTH} bytes`);
  }
  const payload = concat(secret32, checksum(secret32));
  const code = formatCode(encodeBase32(payload));
  payload.fill(0);
  return code;
}

/**
 * Generate a new recovery code from a cryptographically secure random source.
 * Show it to the user once; it is the secret.
 */
export function generatePqcRecoveryCode(): string {
  const secret = randomBytes(PQC_RECOVERY_SECRET_LENGTH);
  try {
    return pqcRecoveryCodeFromSecret(secret);
  } finally {
    secret.fill(0);
  }
}

/** `true` when `code` is a well-formed recovery code with a valid checksum. Never throws. */
export function isValidRecoveryCode(code: string): boolean {
  try {
    decodeRecoveryCode(code).fill(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive an account's ML-DSA-87 keypair from 32 bytes of recovery secret and
 * the account's `qor1…` address. Shared by {@link pqcKeyFromRecoveryCode} and
 * the seed path of `unifiedAccountFromSeed`.
 */
export function pqcKeyFromRecoverySecret(secret32: Uint8Array, address: string): PqcKeypair {
  if (!(secret32 instanceof Uint8Array) || secret32.length !== PQC_RECOVERY_SECRET_LENGTH) {
    throw new Error(`recovery secret must be ${PQC_RECOVERY_SECRET_LENGTH} bytes`);
  }
  const addr = assertQorAddress(address);
  const seedInput = concat(utf8(`${KEY_DOMAIN}|${addr}|`), secret32);
  const seed = shake256(seedInput, 32);
  seedInput.fill(0);
  try {
    return generatePqcKeypair(seed);
  } finally {
    seed.fill(0);
  }
}

/**
 * Derive an account's ML-DSA-87 keypair from its recovery code.
 *
 * Bound to the account address, so one code cannot stand in for another
 * account. Nothing here depends on the account's classical key.
 *
 * @param code - The `QRC1-…` recovery code (case, spaces and separators are
 *   tolerated).
 * @param address - The account's `qor1…` address.
 * @throws on a malformed code, a checksum mismatch, or an address that is not
 *   a `qor1…` bech32 address. Never derives a key from a mistyped code.
 */
export function pqcKeyFromRecoveryCode(code: string, address: string): PqcKeypair {
  assertQorAddress(address);
  const secret = decodeRecoveryCode(code);
  try {
    return pqcKeyFromRecoverySecret(secret, address);
  } finally {
    secret.fill(0);
  }
}

/** Validate a `qor1…` bech32 address and return it lowercased. */
function assertQorAddress(address: string): string {
  const addr = typeof address === "string" ? address.toLowerCase() : "";
  if (!addr.startsWith("qor1") || !isValidBech32(addr, "qor")) {
    throw new Error("address must be the account's qor1 bech32 address");
  }
  return addr;
}
