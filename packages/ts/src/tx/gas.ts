/**
 * Gas-price parsing and fee computation for the auto-gas path.
 *
 * A gas price is a decimal amount of a base denom per unit of gas, written as a
 * single token like `"0.025uqor"`. {@link GasPrice.fromString} parses that into
 * an exact fraction (numerator / denominator) so fee math stays integer-exact
 * with no floating-point drift, and {@link calculateFee} turns a gas limit plus
 * a gas price into a Cosmos {@link StdFee}.
 *
 * This mirrors the cosmjs `GasPrice`/`calculateFee` concept but is reimplemented
 * here so the SDK does not depend on cosmjs's internal fee module and so the
 * arithmetic is auditable and ceil-rounded the way a node's min-gas-price check
 * expects.
 */

import type { StdFee } from "./fees";

/** A decimal amount of a base denom per unit of gas (e.g. `0.025 uqor`). */
export class GasPrice {
  /**
   * @param numerator - The price scaled by `10^scale`, as an integer.
   * @param scale - Number of fractional decimal places encoded in `numerator`.
   * @param denom - The base denomination (e.g. `"uqor"`).
   */
  private constructor(
    readonly numerator: bigint,
    readonly scale: number,
    readonly denom: string,
  ) {}

  /**
   * Parse a gas price like `"0.025uqor"` (decimal amount immediately followed by
   * a denom). The denom must start with a letter; the amount is a non-negative
   * decimal.
   *
   * @throws If the string is not a valid `<amount><denom>` token.
   */
  static fromString(gasPrice: string): GasPrice {
    const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z][a-zA-Z0-9/:._-]*)$/.exec(
      gasPrice.trim(),
    );
    if (!match) {
      throw new Error(
        `invalid gas price: "${gasPrice}" (expected e.g. "0.025uqor")`,
      );
    }
    const [, amount, denom] = match;
    const [intPart, fracPart = ""] = amount.split(".");
    const scale = fracPart.length;
    const numerator = BigInt((intPart || "0") + fracPart);
    return new GasPrice(numerator, scale, denom);
  }

  /**
   * Construct directly from a decimal amount string and denom, e.g.
   * `GasPrice.from("0.025", "uqor")`.
   */
  static from(amount: string, denom: string): GasPrice {
    return GasPrice.fromString(`${amount}${denom}`);
  }

  /** Render back to the canonical `"<amount><denom>"` string. */
  toString(): string {
    const s = this.numerator.toString().padStart(this.scale + 1, "0");
    const cut = s.length - this.scale;
    const intPart = s.slice(0, cut);
    const fracPart = s.slice(cut).replace(/0+$/, "");
    const amount = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
    return `${amount}${this.denom}`;
  }
}

/**
 * Compute a {@link StdFee} for the given gas limit at the given gas price.
 *
 * The fee amount is `ceil(gas * price)` in the price's denom, computed with
 * BigInt math: `ceil(gas * numerator / 10^scale)`. Ceil rounding ensures the
 * offered fee always meets a node's `gas * minGasPrice` threshold.
 *
 * @param gas - The gas limit, as a number or decimal string.
 * @param gasPrice - A {@link GasPrice} or a parseable string (`"0.025uqor"`).
 */
export function calculateFee(gas: number | string, gasPrice: GasPrice | string): StdFee {
  const price = typeof gasPrice === "string" ? GasPrice.fromString(gasPrice) : gasPrice;
  const gasLimit = typeof gas === "number" ? BigInt(Math.ceil(gas)) : BigInt(gas);
  const denominator = 10n ** BigInt(price.scale);
  const raw = gasLimit * price.numerator;
  // ceil division
  const amount = (raw + denominator - 1n) / denominator;
  return {
    amount: [{ denom: price.denom, amount: amount.toString() }],
    gas: gasLimit.toString(),
  };
}
