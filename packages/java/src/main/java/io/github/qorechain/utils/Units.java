package io.github.qorechain.utils;

import java.math.BigInteger;

/**
 * Generic, integer-exact unit conversion for arbitrary token decimals (e.g. 18
 * for most ERC-20 tokens). All math is {@link BigInteger} on decimal strings —
 * no floating-point arithmetic.
 */
public final class Units {

    private Units() {}

    /**
     * Parse a human display amount into its integer base-unit value.
     *
     * @throws IllegalArgumentException if malformed, negative, or too many decimals.
     */
    public static BigInteger parseUnits(String amount, int decimals) {
        if (decimals < 0) {
            throw new IllegalArgumentException(
                    "invalid decimals: " + decimals + " (must be a non-negative integer)");
        }
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
        int dot = body.indexOf('.');
        String intPart = dot >= 0 ? body.substring(0, dot) : body;
        String fracPart = dot >= 0 ? body.substring(dot + 1) : "";
        if (fracPart.length() > decimals) {
            throw new IllegalArgumentException(
                    "too many decimal places in "
                            + amount
                            + ": "
                            + fracPart.length()
                            + " > decimals "
                            + decimals);
        }
        StringBuilder padded = new StringBuilder(fracPart);
        while (padded.length() < decimals) {
            padded.append('0');
        }
        return new BigInteger(intPart + padded);
    }

    /**
     * Format an integer base-unit value as a normalized human display string.
     *
     * @throws IllegalArgumentException if negative or decimals invalid.
     */
    public static String formatUnits(BigInteger value, int decimals) {
        if (decimals < 0) {
            throw new IllegalArgumentException(
                    "invalid decimals: " + decimals + " (must be a non-negative integer)");
        }
        if (value.signum() < 0) {
            throw new IllegalArgumentException("negative amounts are not supported: " + value);
        }
        if (decimals == 0) {
            return value.toString();
        }
        StringBuilder digits = new StringBuilder(value.toString());
        while (digits.length() < decimals + 1) {
            digits.insert(0, '0');
        }
        String s = digits.toString();
        String intPart = s.substring(0, s.length() - decimals);
        String fracPart = s.substring(s.length() - decimals);
        String normalizedInt = new BigInteger(intPart).toString();
        String trimmedFrac = fracPart.replaceAll("0+$", "");
        return trimmedFrac.isEmpty() ? normalizedInt : normalizedInt + "." + trimmedFrac;
    }

    /** Convenience overload accepting a decimal-string base value. */
    public static String formatUnits(String value, int decimals) {
        String t = value.trim();
        if (!t.matches("[+-]?\\d+")) {
            throw new IllegalArgumentException("invalid base value: " + value);
        }
        return formatUnits(new BigInteger(t), decimals);
    }
}
