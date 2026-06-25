import { describe, it, expect } from "vitest";
import { parseUnits, formatUnits } from "../../src/utils/units";

describe("parseUnits", () => {
  it("parses 18-decimal EVM amounts exactly", () => {
    expect(parseUnits("1", 18)).toBe(1000000000000000000n);
    expect(parseUnits("1.5", 18)).toBe(1500000000000000000n);
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
  });

  it("parses arbitrary decimals", () => {
    expect(parseUnits("123.456", 6)).toBe(123456000n);
    expect(parseUnits("0", 0)).toBe(0n);
    expect(parseUnits("42", 0)).toBe(42n);
  });

  it("tolerates leading + and whitespace", () => {
    expect(parseUnits("  +2.5 ", 2)).toBe(250n);
  });

  it("rejects malformed, negative, or over-precise input", () => {
    expect(() => parseUnits("1.2.3", 18)).toThrow();
    expect(() => parseUnits("-1", 18)).toThrow();
    expect(() => parseUnits("1e3", 18)).toThrow();
    expect(() => parseUnits("1.5", 0)).toThrow(/too many decimal/);
    expect(() => parseUnits("1", -1)).toThrow(/invalid decimals/);
  });
});

describe("formatUnits", () => {
  it("formats 18-decimal EVM values exactly, trimming zeros", () => {
    expect(formatUnits(1000000000000000000n, 18)).toBe("1");
    expect(formatUnits(1500000000000000000n, 18)).toBe("1.5");
    expect(formatUnits(1n, 18)).toBe("0.000000000000000001");
    expect(formatUnits(0n, 18)).toBe("0");
  });

  it("accepts bigint, number, and string inputs", () => {
    expect(formatUnits(123456n, 6)).toBe("0.123456");
    expect(formatUnits(123456, 6)).toBe("0.123456");
    expect(formatUnits("123456", 6)).toBe("0.123456");
  });

  it("round-trips with parseUnits", () => {
    const v = parseUnits("9876.543210987654321", 18);
    expect(formatUnits(v, 18)).toBe("9876.543210987654321");
  });

  it("rejects invalid input", () => {
    expect(() => formatUnits("12.3", 18)).toThrow();
    expect(() => formatUnits(-5n, 18)).toThrow();
    expect(() => formatUnits(1.5, 18)).toThrow();
  });
});
