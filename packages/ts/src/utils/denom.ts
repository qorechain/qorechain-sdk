/**
 * Conversion between human display amounts (e.g. `"1.5"` QOR) and integer base
 * amounts (e.g. `"1500000"` uqor).
 *
 * All value math is performed with {@link BigInt} on decimal strings — there is
 * no floating-point arithmetic anywhere in this module, so conversions are exact
 * for any magnitude and never drift (e.g. `toBase("0.1")` is exactly
 * `"100000"`).
 *
 * QoreChain's staking coin uses a default exponent of `6` (1 QOR = 10^6 uqor),
 * but every function accepts a custom `exponent` for other denominations.
 */

/** The QoreChain staking coin's default decimal exponent (1 QOR = 10^6 uqor). */
const DEFAULT_EXPONENT = 6;

/** Options shared by the denom conversion helpers. */
export interface DenomOptions {
  /** Decimal exponent relating base to display (1 display = 10^exponent base). Defaults to 6. */
  exponent?: number;
}

function resolveExponent(opts?: DenomOptions): number {
  const exponent = opts?.exponent ?? DEFAULT_EXPONENT;
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(`invalid exponent: ${exponent} (must be a non-negative integer)`);
  }
  return exponent;
}

/**
 * Convert a human display amount to its integer base amount string.
 *
 * @param amount - A non-negative decimal string, e.g. `"1.5"`. Surrounding
 *   whitespace and a single leading `+` are tolerated. Scientific notation,
 *   thousands separators, and other formatting are rejected.
 * @param opts - Optional `exponent` (defaults to 6).
 * @returns The integer base amount as a string with no leading zeros, e.g.
 *   `"1500000"`.
 * @throws If `amount` is not a valid decimal string, is negative, or has more
 *   fractional digits than `exponent` allows.
 */
export function toBase(amount: string, opts?: DenomOptions): string {
  const exponent = resolveExponent(opts);
  const trimmed = amount.trim();

  let body = trimmed;
  if (body.startsWith("-")) {
    throw new Error(`negative amounts are not supported: ${amount}`);
  }
  if (body.startsWith("+")) {
    body = body.slice(1);
  }

  // Strict decimal: optional integer part, optional single fractional part,
  // digits only. Rejects "", ".", "1.2.3", "1e3", "abc", etc.
  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new Error(`invalid decimal amount: ${amount}`);
  }

  const [intPart, fracPart = ""] = body.split(".");
  if (fracPart.length > exponent) {
    throw new Error(
      `too many decimal places in ${amount}: ${fracPart.length} > exponent ${exponent}`,
    );
  }

  // Right-pad the fractional digits to exactly `exponent` places, then read the
  // whole thing as one big integer. Pure string + BigInt math, no floats.
  const padded = fracPart.padEnd(exponent, "0");
  const base = BigInt(intPart + padded);
  return base.toString();
}

/**
 * Convert an integer base amount string to a normalized display string.
 *
 * @param base - A non-negative integer string, e.g. `"1500000"`.
 * @param opts - Optional `exponent` (defaults to 6).
 * @returns The display amount with no trailing zeros and no trailing dot, e.g.
 *   `"1.5"`. `"1000000"` becomes `"1"`, `"1"` becomes `"0.000001"`, `"0"`
 *   becomes `"0"`.
 * @throws If `base` is not a valid non-negative integer string.
 */
export function fromBase(base: string, opts?: DenomOptions): string {
  const exponent = resolveExponent(opts);
  const trimmed = base.trim();

  if (trimmed.startsWith("-")) {
    throw new Error(`negative amounts are not supported: ${base}`);
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`invalid base amount: ${base}`);
  }

  if (exponent === 0) {
    // No fractional component; strip leading zeros via BigInt.
    return BigInt(trimmed).toString();
  }

  // Left-pad so there are at least `exponent + 1` digits, then split.
  const padded = trimmed.padStart(exponent + 1, "0");
  const intPart = padded.slice(0, padded.length - exponent);
  const fracPart = padded.slice(padded.length - exponent);

  const normalizedInt = BigInt(intPart).toString();
  const trimmedFrac = fracPart.replace(/0+$/, "");
  return trimmedFrac.length > 0 ? `${normalizedInt}.${trimmedFrac}` : normalizedInt;
}
