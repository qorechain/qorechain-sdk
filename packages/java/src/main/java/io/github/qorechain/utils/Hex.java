package io.github.qorechain.utils;

/** Minimal hex encode/decode helpers (lowercase, optional {@code 0x} prefix). */
public final class Hex {

    private Hex() {}

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** Encode bytes to a lowercase hex string with no prefix. */
    public static String encode(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(HEX[(b >> 4) & 0xf]);
            sb.append(HEX[b & 0xf]);
        }
        return sb.toString();
    }

    /** Encode bytes to a lowercase {@code 0x}-prefixed hex string. */
    public static String encodePrefixed(byte[] bytes) {
        return "0x" + encode(bytes);
    }

    /** Strip a leading {@code 0x}/{@code 0X} prefix if present. */
    public static String strip0x(String hex) {
        if (hex.startsWith("0x") || hex.startsWith("0X")) {
            return hex.substring(2);
        }
        return hex;
    }

    /**
     * Decode a hex string (with or without {@code 0x}) into bytes.
     *
     * @throws IllegalArgumentException if not valid even-length hex.
     */
    public static byte[] decode(String hex) {
        String body = strip0x(hex);
        if (body.isEmpty() || body.length() % 2 != 0 || !body.matches("[0-9a-fA-F]+")) {
            throw new IllegalArgumentException("invalid hex string: " + hex);
        }
        byte[] out = new byte[body.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(body.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
