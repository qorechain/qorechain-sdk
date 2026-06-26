package io.github.qorechain.utils;

/**
 * Bech32 encoding/decoding (BIP-173), used for QoreChain addresses (e.g.
 * {@code qor1...}).
 *
 * <p>bech32 stores data as 5-bit groups ("words"); {@link #convertBits} bridges
 * to and from the 8-bit byte payloads callers work with. The default 90-char
 * BIP-173 limit is raised to a safe upper bound so longer validator/consensus
 * payloads do not spuriously fail.
 */
public final class Bech32 {

    private Bech32() {}

    private static final String CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    private static final int[] GENERATOR = {0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3};

    /** A decoded bech32 string: its human-readable prefix and 8-bit byte payload. */
    public static final class Decoded {
        public final String prefix;
        public final byte[] data;

        public Decoded(String prefix, byte[] data) {
            this.prefix = prefix;
            this.data = data;
        }
    }

    private static int polymod(byte[] values) {
        int chk = 1;
        for (byte v : values) {
            int top = chk >>> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ (v & 0xff);
            for (int i = 0; i < 5; i++) {
                if (((top >>> i) & 1) != 0) {
                    chk ^= GENERATOR[i];
                }
            }
        }
        return chk;
    }

    private static byte[] hrpExpand(String hrp) {
        int n = hrp.length();
        byte[] out = new byte[n * 2 + 1];
        for (int i = 0; i < n; i++) {
            out[i] = (byte) (hrp.charAt(i) >>> 5);
            out[n + 1 + i] = (byte) (hrp.charAt(i) & 0x1f);
        }
        out[n] = 0;
        return out;
    }

    private static boolean verifyChecksum(String hrp, byte[] data) {
        byte[] exp = hrpExpand(hrp);
        byte[] combined = new byte[exp.length + data.length];
        System.arraycopy(exp, 0, combined, 0, exp.length);
        System.arraycopy(data, 0, combined, exp.length, data.length);
        return polymod(combined) == 1;
    }

    private static byte[] createChecksum(String hrp, byte[] data) {
        byte[] exp = hrpExpand(hrp);
        byte[] values = new byte[exp.length + data.length + 6];
        System.arraycopy(exp, 0, values, 0, exp.length);
        System.arraycopy(data, 0, values, exp.length, data.length);
        int mod = polymod(values) ^ 1;
        byte[] checksum = new byte[6];
        for (int i = 0; i < 6; i++) {
            checksum[i] = (byte) ((mod >>> (5 * (5 - i))) & 0x1f);
        }
        return checksum;
    }

    /**
     * Convert between bit groups, e.g. 8-bit bytes to 5-bit words ({@code from=8,
     * to=5, pad=true}) and back ({@code from=5, to=8, pad=false}).
     */
    public static byte[] convertBits(byte[] data, int from, int to, boolean pad) {
        int acc = 0;
        int bits = 0;
        int maxv = (1 << to) - 1;
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (byte b : data) {
            int value = b & 0xff;
            if ((value >>> from) != 0) {
                throw new IllegalArgumentException("invalid data range in convertBits");
            }
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) {
                bits -= to;
                out.write((acc >>> bits) & maxv);
            }
        }
        if (pad) {
            if (bits > 0) {
                out.write((acc << (to - bits)) & maxv);
            }
        } else if (bits >= from || ((acc << (to - bits)) & maxv) != 0) {
            throw new IllegalArgumentException("invalid padding in convertBits");
        }
        return out.toByteArray();
    }

    /** Encode raw 8-bit bytes to a bech32 string with the given prefix. */
    public static String encode(String prefix, byte[] bytes) {
        byte[] words = convertBits(bytes, 8, 5, true);
        byte[] checksum = createChecksum(prefix, words);
        StringBuilder sb = new StringBuilder(prefix).append('1');
        for (byte w : words) {
            sb.append(CHARSET.charAt(w));
        }
        for (byte c : checksum) {
            sb.append(CHARSET.charAt(c));
        }
        return sb.toString();
    }

    /**
     * Decode a bech32 string into its prefix and 8-bit byte payload.
     *
     * @throws IllegalArgumentException if the string is not valid bech32.
     */
    public static Decoded decode(String addr) {
        String lower = addr.toLowerCase();
        String upper = addr.toUpperCase();
        if (!addr.equals(lower) && !addr.equals(upper)) {
            throw new IllegalArgumentException("mixed-case bech32 string: " + addr);
        }
        String s = lower;
        int pos = s.lastIndexOf('1');
        if (pos < 1 || pos + 7 > s.length()) {
            throw new IllegalArgumentException("invalid bech32 string: " + addr);
        }
        String hrp = s.substring(0, pos);
        String dataPart = s.substring(pos + 1);
        byte[] data = new byte[dataPart.length()];
        for (int i = 0; i < dataPart.length(); i++) {
            int idx = CHARSET.indexOf(dataPart.charAt(i));
            if (idx < 0) {
                throw new IllegalArgumentException("invalid bech32 character: " + dataPart.charAt(i));
            }
            data[i] = (byte) idx;
        }
        if (!verifyChecksum(hrp, data)) {
            throw new IllegalArgumentException("invalid bech32 checksum: " + addr);
        }
        byte[] words = new byte[data.length - 6];
        System.arraycopy(data, 0, words, 0, words.length);
        byte[] payload = convertBits(words, 5, 8, false);
        return new Decoded(hrp, payload);
    }
}
