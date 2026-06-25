import { describe, it, expect } from "vitest";
import {
  sha256,
  sha256Hex,
  keccak256,
  keccak256Hex,
  ripemd160,
  ripemd160Hex,
  toHex,
} from "../../src/utils/hash";

describe("hash helpers", () => {
  it("sha256 matches known vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("keccak256 matches known vectors", () => {
    expect(keccak256Hex("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(keccak256Hex("abc")).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  it("ripemd160 matches known vector for 'abc'", () => {
    expect(ripemd160Hex("abc")).toBe("0x8eb208f7e05d987a9b044a8e98c6b087f15a0bfc");
  });

  it("returns raw bytes from the non-hex variants", () => {
    const bytes = sha256("abc");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(toHex(bytes)).toBe(sha256Hex("abc"));
    expect(keccak256("abc").length).toBe(32);
    expect(ripemd160("abc").length).toBe(20);
  });

  it("accepts raw bytes as input, equivalent to the UTF-8 string", () => {
    const bytes = new TextEncoder().encode("abc");
    expect(sha256Hex(bytes)).toBe(sha256Hex("abc"));
  });
});
