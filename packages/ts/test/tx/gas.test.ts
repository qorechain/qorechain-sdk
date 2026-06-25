import { describe, it, expect } from "vitest";
import { GasPrice, calculateFee } from "../../src/tx/gas";

describe("GasPrice.fromString", () => {
  it("parses an amount+denom token", () => {
    const gp = GasPrice.fromString("0.025uqor");
    expect(gp.denom).toBe("uqor");
    expect(gp.toString()).toBe("0.025uqor");
  });

  it("parses an integer price", () => {
    expect(GasPrice.fromString("2uqor").toString()).toBe("2uqor");
  });

  it("tolerates whitespace and a space before the denom", () => {
    expect(GasPrice.fromString(" 0.5 uqor ").toString()).toBe("0.5uqor");
  });

  it("rejects malformed strings", () => {
    expect(() => GasPrice.fromString("uqor")).toThrow();
    expect(() => GasPrice.fromString("0.025")).toThrow();
    expect(() => GasPrice.fromString("abc")).toThrow();
  });
});

describe("calculateFee", () => {
  it("computes ceil(gas * price) for a fractional price", () => {
    // 200000 * 0.025 = 5000 exactly
    const fee = calculateFee(200000, "0.025uqor");
    expect(fee).toEqual({
      amount: [{ denom: "uqor", amount: "5000" }],
      gas: "200000",
    });
  });

  it("rounds the fee up (ceil) when not exact", () => {
    // 100001 * 0.025 = 2500.025 -> ceil 2501
    const fee = calculateFee(100001, GasPrice.fromString("0.025uqor"));
    expect(fee.amount[0].amount).toBe("2501");
  });

  it("handles large gas exactly with bigint math", () => {
    const fee = calculateFee("100000000000000", "0.025uqor");
    expect(fee.amount[0].amount).toBe("2500000000000");
  });
});
