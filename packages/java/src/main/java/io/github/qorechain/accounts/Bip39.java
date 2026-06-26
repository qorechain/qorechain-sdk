package io.github.qorechain.accounts;

import io.github.qorechain.utils.Hashing;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * BIP-39 mnemonic generation, validation, and seed derivation against the
 * English wordlist.
 *
 * <p>{@link #toSeed} runs PBKDF2-HMAC-SHA512 (2048 iterations) per BIP-39.
 * {@link #validate} checks both the wordlist membership AND the entropy
 * checksum — the load-bearing guard against a typo'd phrase silently deriving a
 * valid-looking but WRONG account.
 */
public final class Bip39 {

    private Bip39() {}

    private static final String[] WORDLIST;
    private static final Map<String, Integer> WORD_INDEX;

    static {
        List<String> words = new ArrayList<>(2048);
        try (InputStream in = Bip39.class.getResourceAsStream("english.txt")) {
            if (in == null) {
                throw new IllegalStateException("BIP-39 english wordlist resource not found");
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                String w = line.trim();
                if (!w.isEmpty()) {
                    words.add(w);
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        if (words.size() != 2048) {
            throw new IllegalStateException("BIP-39 wordlist must have 2048 words, got " + words.size());
        }
        WORDLIST = words.toArray(new String[0]);
        WORD_INDEX = new HashMap<>(2048);
        for (int i = 0; i < WORDLIST.length; i++) {
            WORD_INDEX.put(WORDLIST[i], i);
        }
    }

    /**
     * Generate a fresh mnemonic.
     *
     * @param strengthBits entropy in bits: {@code 128} → 12 words, {@code 256} → 24 words.
     */
    public static String generate(int strengthBits) {
        if (strengthBits != 128 && strengthBits != 160 && strengthBits != 192
                && strengthBits != 224 && strengthBits != 256) {
            throw new IllegalArgumentException("invalid strength: " + strengthBits);
        }
        byte[] entropy = new byte[strengthBits / 8];
        new SecureRandom().nextBytes(entropy);
        return entropyToMnemonic(entropy);
    }

    private static String entropyToMnemonic(byte[] entropy) {
        byte[] hash = Hashing.sha256(entropy);
        int checksumBits = entropy.length * 8 / 32;
        // Build the bit string: entropy bits + checksum bits, sliced into 11-bit groups.
        int totalBits = entropy.length * 8 + checksumBits;
        StringBuilder bits = new StringBuilder(totalBits);
        for (byte b : entropy) {
            bits.append(toBinary(b & 0xff, 8));
        }
        bits.append(toBinary((hash[0] & 0xff) >> (8 - checksumBits), checksumBits));
        List<String> words = new ArrayList<>();
        for (int i = 0; i < bits.length(); i += 11) {
            int idx = Integer.parseInt(bits.substring(i, i + 11), 2);
            words.add(WORDLIST[idx]);
        }
        return String.join(" ", words);
    }

    private static String toBinary(int value, int width) {
        StringBuilder sb = new StringBuilder(Integer.toBinaryString(value));
        while (sb.length() < width) {
            sb.insert(0, '0');
        }
        return sb.toString();
    }

    /**
     * Validate a mnemonic against the English wordlist and its checksum. Never throws.
     *
     * @return true only if every word is in the wordlist, the word count is valid,
     *     and the entropy checksum matches.
     */
    public static boolean validate(String mnemonic) {
        String[] words = normalize(mnemonic).split(" ");
        int n = words.length;
        if (n % 3 != 0 || n < 12 || n > 24) {
            return false;
        }
        StringBuilder bits = new StringBuilder(n * 11);
        for (String w : words) {
            Integer idx = WORD_INDEX.get(w);
            if (idx == null) {
                return false;
            }
            bits.append(toBinary(idx, 11));
        }
        int totalBits = n * 11;
        int checksumBits = totalBits / 33;
        int entropyBits = totalBits - checksumBits;
        byte[] entropy = new byte[entropyBits / 8];
        for (int i = 0; i < entropy.length; i++) {
            entropy[i] = (byte) Integer.parseInt(bits.substring(i * 8, i * 8 + 8), 2);
        }
        byte[] hash = Hashing.sha256(entropy);
        String expectedChecksum = toBinary((hash[0] & 0xff) >> (8 - checksumBits), checksumBits);
        String actualChecksum = bits.substring(entropyBits);
        return expectedChecksum.equals(actualChecksum);
    }

    /**
     * Validate the mnemonic, then derive its 64-byte BIP-39 seed
     * (PBKDF2-HMAC-SHA512, 2048 iterations, salt {@code "mnemonic" + passphrase}).
     *
     * @throws IllegalArgumentException if the mnemonic is invalid.
     */
    public static byte[] toSeed(String mnemonic, String passphrase) {
        if (!validate(mnemonic)) {
            throw new IllegalArgumentException("invalid mnemonic");
        }
        String normalized = normalize(mnemonic);
        byte[] password = normalized.getBytes(StandardCharsets.UTF_8);
        byte[] salt =
                Normalizer.normalize("mnemonic" + (passphrase == null ? "" : passphrase),
                                Normalizer.Form.NFKD)
                        .getBytes(StandardCharsets.UTF_8);
        return pbkdf2HmacSha512(password, salt, 2048, 64);
    }

    /** Derive the BIP-39 seed with an empty passphrase. */
    public static byte[] toSeed(String mnemonic) {
        return toSeed(mnemonic, "");
    }

    private static String normalize(String mnemonic) {
        return Normalizer.normalize(mnemonic.trim().replaceAll("\\s+", " "), Normalizer.Form.NFKD);
    }

    private static byte[] pbkdf2HmacSha512(byte[] password, byte[] salt, int iterations, int dkLen) {
        try {
            Mac mac = Mac.getInstance("HmacSHA512");
            mac.init(new SecretKeySpec(password, "HmacSHA512"));
            int hLen = mac.getMacLength();
            int blocks = (int) Math.ceil((double) dkLen / hLen);
            byte[] out = new byte[blocks * hLen];
            byte[] block = new byte[salt.length + 4];
            System.arraycopy(salt, 0, block, 0, salt.length);
            for (int i = 1; i <= blocks; i++) {
                block[salt.length] = (byte) (i >>> 24);
                block[salt.length + 1] = (byte) (i >>> 16);
                block[salt.length + 2] = (byte) (i >>> 8);
                block[salt.length + 3] = (byte) i;
                byte[] u = mac.doFinal(block);
                byte[] t = Arrays.copyOf(u, u.length);
                for (int j = 1; j < iterations; j++) {
                    u = mac.doFinal(u);
                    for (int k = 0; k < t.length; k++) {
                        t[k] ^= u[k];
                    }
                }
                System.arraycopy(t, 0, out, (i - 1) * hLen, hLen);
            }
            return Arrays.copyOf(out, dkLen);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("PBKDF2-HMAC-SHA512 failed", e);
        }
    }
}
