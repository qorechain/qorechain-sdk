package io.github.qorechain.accounts;

import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.utils.Bech32;
import io.github.qorechain.utils.Hashing;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * PQC recovery codes ({@code QRC1-...}).
 *
 * <p>A recovery code is a second secret, generated at random and held by the user,
 * that the account's classical secp256k1 key says nothing about. The account's
 * ML-DSA-87 key is derived from it and from the account address, so the PQC half
 * of a hybrid signature needs something the classical half does not have.
 *
 * <p>Format: 32 random bytes plus a 3-byte checksum
 * ({@code shake256("qorechain:pqc:recovery:v1:checksum" || secret, 3)}), encoded as
 * 56 Crockford base32 characters (no I, L, O or U; case-insensitive; O is read as
 * 0, I and L as 1) and shown as {@code QRC1-} followed by 14 groups of 4.
 *
 * <p>The key derivation is
 * {@code shake256("qorechain:pqc:recovery:v1|" + lowercase(qor1Address) + "|" || secret, 32)}
 * fed to the deterministic ML-DSA-87 keygen, byte-identical with
 * {@code @qorechain/wallet-adapter} and the other QoreChain SDKs.
 *
 * <p>The code is the secret. Show it once, have the user write it down, and never
 * store it next to the account's seed phrase.
 */
public final class PqcRecovery {

    private PqcRecovery() {}

    /** The prefix that names and versions a recovery code. */
    public static final String PQC_RECOVERY_CODE_PREFIX = "QRC1";

    /** Crockford base32: no I, L, O or U. */
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    /** Length of the secret a recovery code carries, in bytes. */
    public static final int SECRET_BYTES = 32;

    private static final int CHECKSUM_BYTES = 3;
    private static final int PAYLOAD_BYTES = SECRET_BYTES + CHECKSUM_BYTES; // 35 bytes = 280 bits
    private static final int CODE_CHARS = (PAYLOAD_BYTES * 8) / 5; // 56
    private static final int GROUP = 4;

    private static final byte[] CHECKSUM_DOMAIN =
            "qorechain:pqc:recovery:v1:checksum".getBytes(StandardCharsets.UTF_8);
    private static final String KEY_DOMAIN = "qorechain:pqc:recovery:v1";

    private static final Pattern QOR1 = Pattern.compile("^qor1[02-9ac-hj-np-z]{38,}$");
    private static final Pattern SEPARATORS = Pattern.compile("[\\s\\-_.]");

    private static final SecureRandom RANDOM = new SecureRandom();

    // ---- Public API ----

    /**
     * Generate a new recovery code from the platform CSPRNG
     * ({@link SecureRandom}). Show it to the user once; it is the secret.
     */
    public static String generatePqcRecoveryCode() {
        byte[] secret = new byte[SECRET_BYTES];
        RANDOM.nextBytes(secret);
        try {
            return pqcRecoveryCodeFromSecret(secret);
        } finally {
            Arrays.fill(secret, (byte) 0);
        }
    }

    /**
     * Encode 32 bytes of secret entropy the application already holds as a
     * recovery code. The caller keeps ownership of {@code secret32} (it is not
     * zeroed here).
     *
     * @throws IllegalArgumentException if {@code secret32} is not 32 bytes.
     */
    public static String pqcRecoveryCodeFromSecret(byte[] secret32) {
        requireSecret(secret32, "secret");
        byte[] payload = new byte[PAYLOAD_BYTES];
        System.arraycopy(secret32, 0, payload, 0, SECRET_BYTES);
        byte[] sum = checksum(secret32);
        System.arraycopy(sum, 0, payload, SECRET_BYTES, CHECKSUM_BYTES);
        String chars = encodeBase32(payload);
        Arrays.fill(payload, (byte) 0);
        return formatCode(chars);
    }

    /** True when {@code code} is a well-formed recovery code with a valid checksum. */
    public static boolean isValidRecoveryCode(String code) {
        try {
            Arrays.fill(decodeRecoveryCode(code), (byte) 0);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /**
     * Normalise what a person typed: upper-case it, drop spaces and the separators
     * {@code - _ .}, read O as 0 and I/L as 1, and drop the {@code QRC1} prefix when
     * the length says it is there. Returns the 56 data characters.
     *
     * @throws IllegalArgumentException with a message a UI can show.
     */
    public static String normalizeRecoveryCode(String code) {
        if (code == null) {
            throw new IllegalArgumentException("recovery code must be a string");
        }
        // Read the confusable letters as what was meant BEFORE looking for the
        // prefix: someone copying "QRC1" off paper can write "QRCI" or "QRCL".
        String s = SEPARATORS.matcher(code.toUpperCase(Locale.ROOT)).replaceAll("");
        s = s.replace('O', '0').replace('I', '1').replace('L', '1');
        // Strip the prefix only when the length says it is there: 56 data characters
        // can begin with "QRC1" by chance, and cutting those would break a valid code.
        if (s.length() == CODE_CHARS + PQC_RECOVERY_CODE_PREFIX.length()
                && s.startsWith(PQC_RECOVERY_CODE_PREFIX)) {
            s = s.substring(PQC_RECOVERY_CODE_PREFIX.length());
        }
        if (s.length() != CODE_CHARS) {
            throw new IllegalArgumentException(
                    "recovery code must have " + CODE_CHARS + " characters after \""
                            + PQC_RECOVERY_CODE_PREFIX + "-\", got " + s.length());
        }
        if (s.indexOf('U') >= 0) {
            throw new IllegalArgumentException("recovery code contains an invalid character \"U\"");
        }
        return s;
    }

    /**
     * Derive the account's ML-DSA-87 keypair from its recovery code.
     *
     * <p>Bound to the account address, so one code cannot stand in for another
     * account and the same code never yields the same key for two accounts.
     * Nothing here depends on the account's classical key.
     *
     * @param code the {@code QRC1-...} recovery code.
     * @param qor1Address the account's canonical {@code qor1...} address.
     * @throws IllegalArgumentException on a malformed address, a malformed code or
     *     a checksum mismatch (a key is never derived from a mistyped code).
     */
    public static PqcKeypair pqcKeyFromRecoveryCode(String code, String qor1Address) {
        String address = requireQor1Address(qor1Address, "pqcKeyFromRecoveryCode");
        byte[] secret = decodeRecoveryCode(code);
        try {
            return keyFromSecret(secret, address);
        } finally {
            Arrays.fill(secret, (byte) 0);
        }
    }

    // ---- Package-private (used by UnifiedAccounts) ----

    /**
     * Decode a recovery code into its 32-byte secret. The caller must zero the
     * returned array.
     */
    static byte[] decodeRecoveryCode(String code) {
        byte[] payload = decodeBase32(normalizeRecoveryCode(code));
        // 56 chars = 280 bits = exactly 35 bytes; anything else is a decoder fault.
        if (payload.length != PAYLOAD_BYTES) {
            Arrays.fill(payload, (byte) 0);
            throw new IllegalArgumentException("recovery code has the wrong length");
        }
        byte[] secret = Arrays.copyOfRange(payload, 0, SECRET_BYTES);
        byte[] want = checksum(secret);
        int diff = 0;
        for (int i = 0; i < CHECKSUM_BYTES; i++) {
            diff |= (payload[SECRET_BYTES + i] ^ want[i]) & 0xff;
        }
        Arrays.fill(payload, (byte) 0);
        if (diff != 0) {
            Arrays.fill(secret, (byte) 0);
            throw new IllegalArgumentException(
                    "recovery code checksum does not match: a character is mistyped");
        }
        return secret;
    }

    /**
     * {@code ML-DSA-87 keygen(shake256("qorechain:pqc:recovery:v1|" + address + "|" || secret32, 32))}.
     * {@code address} must already be lower-case. Does not zero {@code secret32}.
     */
    static PqcKeypair keyFromSecret(byte[] secret32, String address) {
        byte[] prefix = (KEY_DOMAIN + "|" + address + "|").getBytes(StandardCharsets.UTF_8);
        byte[] seedInput = new byte[prefix.length + secret32.length];
        System.arraycopy(prefix, 0, seedInput, 0, prefix.length);
        System.arraycopy(secret32, 0, seedInput, prefix.length, secret32.length);
        byte[] seed = Hashing.shake256(seedInput, 32);
        Arrays.fill(seedInput, (byte) 0);
        try {
            return Pqc.generatePqcKeypair(seed);
        } finally {
            Arrays.fill(seed, (byte) 0);
        }
    }

    /** Validate and lower-case a {@code qor1...} bech32 account address. */
    static String requireQor1Address(String qor1Address, String caller) {
        String msg = caller + ": address must be the account's qor1... address";
        if (qor1Address == null) {
            throw new IllegalArgumentException(msg);
        }
        String address = qor1Address.toLowerCase(Locale.ROOT);
        if (!QOR1.matcher(address).matches()) {
            throw new IllegalArgumentException(msg);
        }
        try {
            if (!"qor".equals(Bech32.decode(address).prefix)) {
                throw new IllegalArgumentException(msg);
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(msg, e);
        }
        return address;
    }

    static void requireSecret(byte[] secret32, String name) {
        if (secret32 == null || secret32.length != SECRET_BYTES) {
            throw new IllegalArgumentException(
                    name + " must be " + SECRET_BYTES + " bytes, got "
                            + (secret32 == null ? "null" : secret32.length));
        }
    }

    // ---- Encoding ----

    private static byte[] checksum(byte[] secret) {
        byte[] in = new byte[CHECKSUM_DOMAIN.length + secret.length];
        System.arraycopy(CHECKSUM_DOMAIN, 0, in, 0, CHECKSUM_DOMAIN.length);
        System.arraycopy(secret, 0, in, CHECKSUM_DOMAIN.length, secret.length);
        byte[] out = Hashing.shake256(in, CHECKSUM_BYTES);
        Arrays.fill(in, (byte) 0);
        return out;
    }

    private static String encodeBase32(byte[] bytes) {
        StringBuilder out = new StringBuilder((bytes.length * 8 + 4) / 5);
        int bits = 0;
        int value = 0;
        for (byte b : bytes) {
            value = ((value << 8) | (b & 0xff)) & 0xfff; // at most 12 live bits
            bits += 8;
            while (bits >= 5) {
                out.append(ALPHABET.charAt((value >>> (bits - 5)) & 31));
                bits -= 5;
            }
        }
        if (bits > 0) {
            out.append(ALPHABET.charAt((value << (5 - bits)) & 31));
        }
        return out.toString();
    }

    private static byte[] decodeBase32(String chars) {
        byte[] out = new byte[chars.length() * 5 / 8];
        int n = 0;
        int bits = 0;
        int value = 0;
        for (int i = 0; i < chars.length(); i++) {
            char c = chars.charAt(i);
            int v = ALPHABET.indexOf(c);
            if (v < 0) {
                Arrays.fill(out, (byte) 0);
                throw new IllegalArgumentException(
                        "recovery code contains an invalid character \"" + c + "\"");
            }
            value = ((value << 5) | v) & 0xfff;
            bits += 5;
            if (bits >= 8) {
                out[n++] = (byte) ((value >>> (bits - 8)) & 255);
                bits -= 8;
            }
        }
        return n == out.length ? out : Arrays.copyOf(out, n);
    }

    private static String formatCode(String chars) {
        StringBuilder sb = new StringBuilder(PQC_RECOVERY_CODE_PREFIX);
        for (int i = 0; i < chars.length(); i += GROUP) {
            sb.append('-').append(chars, i, Math.min(chars.length(), i + GROUP));
        }
        return sb.toString();
    }
}
