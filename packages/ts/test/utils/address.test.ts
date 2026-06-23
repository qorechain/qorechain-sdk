import { describe, it, expect } from "vitest";
import {
  bech32ToHex,
  bytesToBech32,
  hexToBech32,
  isValidBech32,
} from "../../src/utils/address";

// A known 20-byte value (40 hex chars). Used as a self-generated round-trip vector.
const HEX20 = "0x0123456789abcdef0123456789abcdef01234567";
const BYTES20 = Uint8Array.from(
  HEX20.slice(2).match(/.{2}/g)!.map((h) => parseInt(h, 16)),
);

describe("hexToBech32 / bech32ToHex round-trip", () => {
  it("round-trips a 20-byte hex through a qor1 address", () => {
    const addr = hexToBech32(HEX20, "qor");
    expect(addr.startsWith("qor1")).toBe(true);
    expect(bech32ToHex(addr)).toBe(HEX20);
  });

  it("defaults the prefix to qor", () => {
    const addr = hexToBech32(HEX20);
    expect(addr.startsWith("qor1")).toBe(true);
  });

  it("accepts both 0x-prefixed and bare hex and yields the same address", () => {
    const withPrefix = hexToBech32(HEX20, "qor");
    const bare = hexToBech32(HEX20.slice(2), "qor");
    expect(bare).toBe(withPrefix);
  });

  it("returns lowercased, 0x-prefixed hex from bech32ToHex", () => {
    const addr = hexToBech32("0x" + "AB".repeat(20), "qor");
    expect(bech32ToHex(addr)).toBe("0x" + "ab".repeat(20));
  });

  it("supports other prefixes", () => {
    const addr = hexToBech32(HEX20, "qorvaloper");
    expect(addr.startsWith("qorvaloper1")).toBe(true);
    expect(bech32ToHex(addr)).toBe(HEX20);
  });

  it("throws on invalid hex", () => {
    expect(() => hexToBech32("0x123")).toThrow(/hex/i); // odd length
    expect(() => hexToBech32("0xzz")).toThrow(/hex/i); // non-hex chars
    expect(() => hexToBech32("")).toThrow(/hex/i);
  });

  it("throws when decoding an invalid bech32 string", () => {
    expect(() => bech32ToHex("not-a-bech32-address")).toThrow();
  });
});

describe("bytesToBech32", () => {
  it("round-trips raw bytes through bech32ToHex for a 20-byte input", () => {
    const addr = bytesToBech32(BYTES20, "qor");
    expect(addr.startsWith("qor1")).toBe(true);
    expect(bech32ToHex(addr)).toBe(HEX20);
  });

  it("defaults the prefix to qor", () => {
    expect(bytesToBech32(BYTES20).startsWith("qor1")).toBe(true);
  });

  it("matches the old hexToBech32(toHex(bytes)) path exactly", () => {
    expect(bytesToBech32(BYTES20, "qor")).toBe(hexToBech32(HEX20, "qor"));
  });

  it("supports other prefixes", () => {
    const addr = bytesToBech32(BYTES20, "qorvaloper");
    expect(addr.startsWith("qorvaloper1")).toBe(true);
    expect(bech32ToHex(addr)).toBe(HEX20);
  });
});

describe("isValidBech32", () => {
  const addr = hexToBech32(HEX20, "qor");

  it("is true for a well-formed address", () => {
    expect(isValidBech32(addr)).toBe(true);
  });

  it("is true when the prefix matches", () => {
    expect(isValidBech32(addr, "qor")).toBe(true);
  });

  it("is false when the required prefix does not match", () => {
    expect(isValidBech32(addr, "qorvaloper")).toBe(false);
  });

  it("is false for a corrupted checksum", () => {
    const corrupted = addr.slice(0, -1) + (addr.endsWith("q") ? "p" : "q");
    expect(isValidBech32(corrupted)).toBe(false);
  });

  it("is false for non-bech32 garbage", () => {
    expect(isValidBech32("hello world")).toBe(false);
    expect(isValidBech32("")).toBe(false);
  });
});
