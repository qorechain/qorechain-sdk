/**
 * Generic, integer-exact unit conversion for arbitrary token decimals.
 *
 * Where {@link toBase}/{@link fromBase} in `utils/denom` are specialized to the
 * QoreChain staking coin (`uqor`, exponent 6), these helpers take an explicit
 * `decimals` argument and are the right tool for EVM-style 18-decimal tokens,
 * SPL tokens, or any other denomination.
 *
 * All math is performed with {@link BigInt} on decimal strings — there is no
 * floating-point arithmetic, so conversions are exact for any magnitude. Values
 * are returned as `bigint` (for `parseUnits`) and decimal strings (for
 * `formatUnits`) so no precision is lost across the boundary.
 */

/**
 * Parse a human display amount into its integer base-unit value.
 *
 * @param amount - A non-negative decimal string, e.g. `"1.5"`. A single leading
 *   `+` and surrounding whitespace are tolerated. Scientific notation,
 *   thousands separators, and other formatting are rejected.
 * @param decimals - Number of fractional decimals the unit has (e.g. `18` for
 *   most ERC-20 tokens). Must be a non-negative integer.
 * @returns The base-unit value as a `bigint`, e.g.
 *   `parseUnits("1.5", 18) === 1500000000000000000n`.
 * @throws If `amount` is malformed, negative, or has more fractional digits
 *   than `decimals` allows.
 */
export function parseUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals: ${decimals} (must be a non-negative integer)`);
  }
  const trimmed = amount.trim();

  let body = trimmed;
  if (body.startsWith("-")) {
    throw new Error(`negative amounts are not supported: ${amount}`);
  }
  if (body.startsWith("+")) {
    body = body.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new Error(`invalid decimal amount: ${amount}`);
  }

  const [intPart, fracPart = ""] = body.split(".");
  if (fracPart.length > decimals) {
    throw new Error(
      `too many decimal places in ${amount}: ${fracPart.length} > decimals ${decimals}`,
    );
  }

  const padded = fracPart.padEnd(decimals, "0");
  return BigInt(intPart + padded);
}

/**
 * Format an integer base-unit value as a normalized human display string.
 *
 * @param value - The base-unit value as a `bigint`, `number`, or decimal
 *   string. Must be a non-negative integer.
 * @param decimals - Number of fractional decimals the unit has.
 * @returns The display amount with no trailing zeros and no trailing dot, e.g.
 *   `formatUnits(1500000000000000000n, 18) === "1.5"`. `0` formats as `"0"`.
 * @throws If `value` is not a valid non-negative integer or `decimals` is invalid.
 */
export function formatUnits(value: bigint | number | string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals: ${decimals} (must be a non-negative integer)`);
  }

  let big: bigint;
  if (typeof value === "bigint") {
    big = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`value must be an integer: ${value}`);
    }
    big = BigInt(value);
  } else {
    const t = value.trim();
    if (!/^[+-]?\d+$/.test(t)) {
      throw new Error(`invalid base value: ${value}`);
    }
    big = BigInt(t);
  }

  if (big < 0n) {
    throw new Error(`negative amounts are not supported: ${value}`);
  }

  if (decimals === 0) {
    return big.toString();
  }

  const digits = big.toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals);

  const normalizedInt = BigInt(intPart).toString();
  const trimmedFrac = fracPart.replace(/0+$/, "");
  return trimmedFrac.length > 0 ? `${normalizedInt}.${trimmedFrac}` : normalizedInt;
}
