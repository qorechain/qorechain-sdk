package io.github.qorechain.utils;

import java.math.BigInteger;

/** Base58 (Bitcoin alphabet) encode/decode, used for SVM (Solana-style) addresses. */
public final class Base58 {

    private Base58() {}

    private static final String ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    private static final BigInteger BASE = BigInteger.valueOf(58);

    /** Encode bytes to a base58 string, preserving leading-zero bytes as {@code '1'}. */
    public static String encode(byte[] input) {
        if (input.length == 0) {
            return "";
        }
        int zeros = 0;
        while (zeros < input.length && input[zeros] == 0) {
            zeros++;
        }
        BigInteger num = new BigInteger(1, input);
        StringBuilder sb = new StringBuilder();
        while (num.signum() > 0) {
            BigInteger[] divmod = num.divideAndRemainder(BASE);
            num = divmod[0];
            sb.append(ALPHABET.charAt(divmod[1].intValue()));
        }
        for (int i = 0; i < zeros; i++) {
            sb.append('1');
        }
        return sb.reverse().toString();
    }

    /**
     * Decode a base58 string to bytes.
     *
     * @throws IllegalArgumentException if the string contains a non-base58 char.
     */
    public static byte[] decode(String input) {
        if (input.isEmpty()) {
            return new byte[0];
        }
        BigInteger num = BigInteger.ZERO;
        for (int i = 0; i < input.length(); i++) {
            int idx = ALPHABET.indexOf(input.charAt(i));
            if (idx < 0) {
                throw new IllegalArgumentException("invalid base58 character: " + input.charAt(i));
            }
            num = num.multiply(BASE).add(BigInteger.valueOf(idx));
        }
        byte[] bytes = num.toByteArray();
        // Strip a leading sign byte if BigInteger added one.
        int offset = (bytes.length > 1 && bytes[0] == 0) ? 1 : 0;
        int leadingZeros = 0;
        while (leadingZeros < input.length() && input.charAt(leadingZeros) == '1') {
            leadingZeros++;
        }
        byte[] out = new byte[leadingZeros + (bytes.length - offset)];
        System.arraycopy(bytes, offset, out, leadingZeros, bytes.length - offset);
        return out;
    }
}
