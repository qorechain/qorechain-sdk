import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import {
  generatePqcRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  pqcKeyFromRecoveryCode,
  pqcRecoveryCodeFromSecret,
  unifiedAccountFromSeed,
} from "../../src/index";

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Known-answer vectors shared with the wallet-adapter and every SDK language. */
const SEED_ADDR = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
const CODE_07 =
  "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK";
const RECOVERY_PK_SHA256 = "cf50dca6c9a0d86eeac9d6a50ee54e567e2126184143be694b8df1f31c8e23ef";
const LEGACY_PK_SHA256 = "3710d198ff5d3206601e9dfd7e0e4bac0656de0fee28f5a20b39e05c81e46bd0";

const seed01 = () => new Uint8Array(32).fill(1);
const secret07 = () => new Uint8Array(32).fill(7);

describe("QRC1 recovery codes", () => {
  it("encodes 0x07×32 to the known code", () => {
    expect(pqcRecoveryCodeFromSecret(secret07())).toBe(CODE_07);
    expect(isValidRecoveryCode(CODE_07)).toBe(true);
  });

  it("generates valid, distinct codes in the QRC1 layout", () => {
    const a = generatePqcRecoveryCode();
    const b = generatePqcRecoveryCode();
    expect(a).toMatch(/^QRC1(-[0-9A-HJKMNP-TV-Z]{4}){14}$/);
    expect(isValidRecoveryCode(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("decodes a lowercase code with spaces and O/I/L confusables", () => {
    // "0W3G-E1R7-..." typed in lowercase, spaced, with O for 0 and l / i for 1.
    const typed = CODE_07.toLowerCase()
      .replace(/-/g, " ")
      .replace(/0/g, "o")
      .replace(/1/g, (_m, off: number) => (off % 2 === 0 ? "l" : "i"));
    expect(isValidRecoveryCode(typed)).toBe(true);
    expect(normalizeRecoveryCode(typed)).toBe(normalizeRecoveryCode(CODE_07));
    const k1 = pqcKeyFromRecoveryCode(typed, SEED_ADDR);
    expect(toHex(sha256(k1.publicKey))).toBe(RECOVERY_PK_SHA256);
  });

  it("accepts the code without its prefix", () => {
    expect(isValidRecoveryCode(CODE_07.slice(5))).toBe(true);
  });

  it("rejects one changed character with a checksum error", () => {
    const bad = CODE_07.slice(0, 10) + (CODE_07[10] === "Z" ? "Y" : "Z") + CODE_07.slice(11);
    expect(isValidRecoveryCode(bad)).toBe(false);
    expect(() => pqcKeyFromRecoveryCode(bad, SEED_ADDR)).toThrow(/checksum/);
  });

  it("rejects a wrong length and the letter U", () => {
    expect(() => normalizeRecoveryCode(CODE_07.slice(0, -1))).toThrow(/56 characters/);
    expect(() => normalizeRecoveryCode("U" + CODE_07.slice(6))).toThrow(/"U"/);
    expect(isValidRecoveryCode("")).toBe(false);
  });

  it("derives the known key from the code and address", () => {
    const kp = pqcKeyFromRecoveryCode(CODE_07, SEED_ADDR);
    expect(kp.publicKey.length).toBe(2592);
    expect(toHex(sha256(kp.publicKey))).toBe(RECOVERY_PK_SHA256);
    // Upper-case address input is read the same way.
    const kp2 = pqcKeyFromRecoveryCode(CODE_07, SEED_ADDR.toUpperCase());
    expect(toHex(sha256(kp2.publicKey))).toBe(RECOVERY_PK_SHA256);
  });

  it("requires a qor1 bech32 address", () => {
    expect(() => pqcKeyFromRecoveryCode(CODE_07, "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1")).toThrow(/qor1/);
    expect(() => pqcKeyFromRecoveryCode(CODE_07, "cosmos1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj")).toThrow(/qor1/);
    // Broken bech32 checksum.
    expect(() => pqcKeyFromRecoveryCode(CODE_07, SEED_ADDR.slice(0, -1) + "q")).toThrow(/qor1/);
  });
});

describe("unifiedAccountFromSeed PQC key source", () => {
  it("derives the known key from a recovery code", () => {
    const a = unifiedAccountFromSeed(seed01(), { recoveryCode: CODE_07 });
    expect(a.cosmos).toBe(SEED_ADDR);
    expect(toHex(sha256(a.pqc.publicKey))).toBe(RECOVERY_PK_SHA256);
  });

  it("gives the same key from pqcSecret as from the matching code", () => {
    const a = unifiedAccountFromSeed(seed01(), { pqcSecret: secret07() });
    expect(a.cosmos).toBe(SEED_ADDR);
    expect(toHex(sha256(a.pqc.publicKey))).toBe(RECOVERY_PK_SHA256);
  });

  it("keeps the old derivation under legacySeedDerivation", () => {
    const a = unifiedAccountFromSeed(seed01(), { legacySeedDerivation: true });
    expect(a.cosmos).toBe(SEED_ADDR);
    expect(toHex(sha256(a.pqc.publicKey))).toBe(LEGACY_PK_SHA256);
  });

  it("throws when no PQC key source is given", () => {
    expect(() => unifiedAccountFromSeed(seed01())).toThrow(/recoveryCode.*pqcSecret.*legacySeedDerivation/s);
    expect(() => unifiedAccountFromSeed(seed01(), {})).toThrow(/second secret/);
    expect(() => unifiedAccountFromSeed(seed01(), { legacySeedDerivation: false })).toThrow(/second secret/);
  });

  it("throws when more than one source is given", () => {
    expect(() =>
      unifiedAccountFromSeed(seed01(), { recoveryCode: CODE_07, pqcSecret: secret07() }),
    ).toThrow(/only one/);
    expect(() =>
      unifiedAccountFromSeed(seed01(), { pqcSecret: secret07(), legacySeedDerivation: true }),
    ).toThrow(/only one/);
  });

  it("rejects a pqcSecret that is not 32 bytes and a bad recovery code", () => {
    expect(() => unifiedAccountFromSeed(seed01(), { pqcSecret: new Uint8Array(31) })).toThrow(/32 bytes/);
    expect(() => unifiedAccountFromSeed(seed01(), { recoveryCode: "QRC1-0000" })).toThrow(/56 characters/);
  });

  it("refuses a pqcSecret (or recovery code) equal to seed32", () => {
    expect(() => unifiedAccountFromSeed(seed01(), { pqcSecret: seed01() })).toThrow(/must not equal seed32/);
    const sameCode = pqcRecoveryCodeFromSecret(seed01());
    expect(() => unifiedAccountFromSeed(seed01(), { recoveryCode: sameCode })).toThrow(/same 32 bytes as seed32/);
  });

  it("does not modify the caller's pqcSecret", () => {
    const s = secret07();
    unifiedAccountFromSeed(seed01(), { pqcSecret: s });
    expect(s.every((x) => x === 7)).toBe(true);
  });
});
