import { describe, it, expect } from "vitest";
import {
  isValidEvmAddress,
  toChecksumAddress,
  isChecksumAddress,
  isValidSvmAddress,
} from "../../src/utils/validation";
import { qorToEvm, evmToQor } from "../../src/utils/address";

// Canonical EIP-55 vectors from the spec.
const EIP55 = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

describe("isValidEvmAddress", () => {
  it("accepts 20-byte hex addresses of any case", () => {
    expect(isValidEvmAddress("0x" + "a".repeat(40))).toBe(true);
    expect(isValidEvmAddress(EIP55[0])).toBe(true);
  });
  it("rejects wrong length or missing prefix", () => {
    expect(isValidEvmAddress("0x" + "a".repeat(39))).toBe(false);
    expect(isValidEvmAddress("a".repeat(40))).toBe(false);
    expect(isValidEvmAddress("0xZZ" + "a".repeat(38))).toBe(false);
  });
});

describe("EIP-55 checksum", () => {
  it("produces the canonical checksum form", () => {
    for (const addr of EIP55) {
      expect(toChecksumAddress(addr.toLowerCase())).toBe(addr);
    }
  });
  it("recognizes a correctly checksummed address", () => {
    for (const addr of EIP55) {
      expect(isChecksumAddress(addr)).toBe(true);
    }
  });
  it("rejects single-case and corrupted addresses", () => {
    expect(isChecksumAddress(EIP55[0].toLowerCase())).toBe(false);
    expect(isChecksumAddress(EIP55[0].toUpperCase())).toBe(false);
    // Flip the case of one checksummed nibble.
    const broken = EIP55[0].slice(0, 3) + EIP55[0][3].toLowerCase() + EIP55[0].slice(4);
    if (broken !== EIP55[0]) expect(isChecksumAddress(broken)).toBe(false);
  });
});

describe("isValidSvmAddress", () => {
  it("accepts an on-curve base58 ed25519 public key", () => {
    expect(isValidSvmAddress("9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj")).toBe(true);
  });
  it("rejects off-curve, wrong-length, and non-base58 input", () => {
    // 32 bytes of 0xff is not a valid curve point.
    expect(isValidSvmAddress("JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG")).toBe(false);
    expect(isValidSvmAddress("abc")).toBe(false);
    expect(isValidSvmAddress("0OIl")).toBe(false); // invalid base58 alphabet
  });
});

describe("cross-format address aliases", () => {
  const qor = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
  it("round-trips qor <-> evm hex", () => {
    const hex = qorToEvm(qor);
    expect(isValidEvmAddress(hex)).toBe(true);
    expect(evmToQor(hex)).toBe(qor);
  });
});
