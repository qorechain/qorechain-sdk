package io.github.qorechain.denom;

import java.math.BigInteger;

/**
 * Conversion between human display amounts (e.g. {@code "1.5"} QOR) and integer
 * base amounts (e.g. {@code "1500000"} uqor).
 *
 * <p>All value math is performed with {@link BigInteger} on decimal strings —
 * there is no floating-point arithmetic anywhere, so conversions are exact for
 * any magnitude. QoreChain's staking coin uses a default exponent of {@code 6}
 * (1 QOR = 10^6 uqor), but every function accepts a custom exponent.
 */
public final class Denom {

    private Denom() {}

    /** The QoreChain staking coin's default decimal exponent (1 QOR = 10^6 uqor). */
    public static final int DEFAULT_EXPONENT = 6;

    private static void checkExponent(int exponent) {
        if (exponent < 0) {
            throw new IllegalArgumentException(
                    "invalid exponent: " + exponent + " (must be a non-negative integer)");
        }
    }

    /** Convert a human display amount to its integer base amount string, exponent 6. */
    public static String toBase(String amount) {
        return toBase(amount, DEFAULT_EXPONENT);
    }

    /**
     * Convert a human display amount to its integer base amount string.
     *
     * @param amount a non-negative decimal string, e.g. {@code "1.5"}; surrounding
     *     whitespace and a single leading {@code +} are tolerated.
     * @param exponent decimal exponent (defaults to 6 via the overload).
     * @return the integer base amount with no leading zeros, e.g. {@code "1500000"}.
     * @throws IllegalArgumentException if malformed, negative, or too many decimals.
     */
    public static String toBase(String amount, int exponent) {
        checkExponent(exponent);
        String body = amount.trim();
        if (body.startsWith("-")) {
            throw new IllegalArgumentException("negative amounts are not supported: " + amount);
        }
        if (body.startsWith("+")) {
            body = body.substring(1);
        }
        if (!body.matches("\\d+(\\.\\d+)?")) {
            throw new IllegalArgumentException("invalid decimal amount: " + amount);
        }
        String intPart;
        String fracPart;
        int dot = body.indexOf('.');
        if (dot >= 0) {
            intPart = body.substring(0, dot);
            fracPart = body.substring(dot + 1);
        } else {
            intPart = body;
            fracPart = "";
        }
        if (fracPart.length() > exponent) {
            throw new IllegalArgumentException(
                    "too many decimal places in "
                            + amount
                            + ": "
                            + fracPart.length()
                            + " > exponent "
                            + exponent);
        }
        StringBuilder padded = new StringBuilder(fracPart);
        while (padded.length() < exponent) {
            padded.append('0');
        }
        return new BigInteger(intPart + padded).toString();
    }

    /** Convert an integer base amount string to a normalized display string, exponent 6. */
    public static String fromBase(String base) {
        return fromBase(base, DEFAULT_EXPONENT);
    }

    /**
     * Convert an integer base amount string to a normalized display string.
     *
     * @param base a non-negative integer string, e.g. {@code "1500000"}.
     * @param exponent decimal exponent.
     * @return the display amount with no trailing zeros and no trailing dot, e.g.
     *     {@code "1.5"}; {@code "1000000"} becomes {@code "1"}, {@code "1"} becomes
     *     {@code "0.000001"}, {@code "0"} becomes {@code "0"}.
     * @throws IllegalArgumentException if {@code base} is not a valid non-negative integer.
     */
    public static String fromBase(String base, int exponent) {
        checkExponent(exponent);
        String trimmed = base.trim();
        if (trimmed.startsWith("-")) {
            throw new IllegalArgumentException("negative amounts are not supported: " + base);
        }
        if (!trimmed.matches("\\d+")) {
            throw new IllegalArgumentException("invalid base amount: " + base);
        }
        if (exponent == 0) {
            return new BigInteger(trimmed).toString();
        }
        StringBuilder padded = new StringBuilder(trimmed);
        while (padded.length() < exponent + 1) {
            padded.insert(0, '0');
        }
        String s = padded.toString();
        String intPart = s.substring(0, s.length() - exponent);
        String fracPart = s.substring(s.length() - exponent);
        String normalizedInt = new BigInteger(intPart).toString();
        String trimmedFrac = fracPart.replaceAll("0+$", "");
        return trimmedFrac.isEmpty() ? normalizedInt : normalizedInt + "." + trimmedFrac;
    }
}
