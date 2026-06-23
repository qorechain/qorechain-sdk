import { describe, it, expect } from "vitest";
import { toBase, fromBase } from "../../src/utils/denom";

describe("toBase", () => {
  it("converts whole and fractional QOR to uqor with default exponent 6", () => {
    expect(toBase("1.5")).toBe("1500000");
    expect(toBase("1")).toBe("1000000");
    expect(toBase("0.000001")).toBe("1");
    expect(toBase("0")).toBe("0");
  });

  it("uses exact integer math (no float drift)", () => {
    // If this were done with IEEE-754 floats, 0.1 and 0.3 would drift.
    expect(toBase("0.1")).toBe("100000");
    expect(toBase("0.3")).toBe("300000");
    expect(toBase("0.1") === "100000").toBe(true);
  });

  it("pads fewer decimals than the exponent correctly", () => {
    expect(toBase("1.2")).toBe("1200000");
    expect(toBase("123.456789")).toBe("123456789");
  });

  it("accepts a custom exponent", () => {
    expect(toBase("1", { exponent: 18 })).toBe("1000000000000000000");
    expect(toBase("1.5", { exponent: 18 })).toBe("1500000000000000000");
    expect(toBase("5", { exponent: 0 })).toBe("5");
  });

  it("strips a leading plus and trims surrounding whitespace", () => {
    expect(toBase(" 1.5 ")).toBe("1500000");
  });

  it("throws when there are more decimal places than the exponent", () => {
    expect(() => toBase("1.1234567")).toThrow(/decimal/i);
    expect(() => toBase("1.1", { exponent: 0 })).toThrow(/decimal/i);
  });

  it("throws on non-decimal / garbage input", () => {
    expect(() => toBase("abc")).toThrow(/invalid/i);
    expect(() => toBase("1.2.3")).toThrow(/invalid/i);
    expect(() => toBase("")).toThrow(/invalid/i);
    expect(() => toBase(".")).toThrow(/invalid/i);
    expect(() => toBase("1e3")).toThrow(/invalid/i);
  });

  it("throws on negative amounts", () => {
    expect(() => toBase("-1")).toThrow(/negative/i);
    expect(() => toBase("-0.5")).toThrow(/negative/i);
  });

  it("throws on an invalid exponent", () => {
    expect(() => toBase("1", { exponent: -1 })).toThrow(/exponent/i);
    expect(() => toBase("1", { exponent: 1.5 })).toThrow(/exponent/i);
  });
});

describe("fromBase", () => {
  it("normalizes base amounts to display strings", () => {
    expect(fromBase("1500000")).toBe("1.5");
    expect(fromBase("1000000")).toBe("1");
    expect(fromBase("1")).toBe("0.000001");
    expect(fromBase("0")).toBe("0");
  });

  it("strips trailing zeros and the trailing dot", () => {
    expect(fromBase("1200000")).toBe("1.2");
    expect(fromBase("1230000")).toBe("1.23");
    expect(fromBase("10000000")).toBe("10");
  });

  it("handles amounts smaller than one whole unit", () => {
    expect(fromBase("123456")).toBe("0.123456");
    expect(fromBase("100000")).toBe("0.1");
  });

  it("accepts a custom exponent", () => {
    expect(fromBase("1000000000000000000", { exponent: 18 })).toBe("1");
    expect(fromBase("5", { exponent: 0 })).toBe("5");
  });

  it("throws on non-integer / garbage input", () => {
    expect(() => fromBase("1.5")).toThrow(/invalid/i);
    expect(() => fromBase("abc")).toThrow(/invalid/i);
    expect(() => fromBase("")).toThrow(/invalid/i);
    expect(() => fromBase("-100")).toThrow(/negative/i);
  });
});

describe("round-trip", () => {
  it("fromBase(toBase(x)) === x for normalized values", () => {
    expect(fromBase(toBase("123.456789"))).toBe("123.456789");
    expect(fromBase(toBase("1.5"))).toBe("1.5");
    expect(fromBase(toBase("0.000001"))).toBe("0.000001");
    expect(fromBase(toBase("0"))).toBe("0");
  });
});
