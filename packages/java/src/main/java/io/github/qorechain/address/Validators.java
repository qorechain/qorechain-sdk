package io.github.qorechain.address;

import io.github.qorechain.utils.Base58;
import io.github.qorechain.utils.Hashing;
import java.nio.charset.StandardCharsets;
import org.bouncycastle.math.ec.rfc8032.Ed25519;

/**
 * Cross-VM address validation and the EIP-55 mixed-case checksum.
 *
 * <p>QoreChain spans three address formats: bech32 ({@code qor1...}, in
 * {@link Address}), EVM hex ({@code 0x...}, 20 bytes), and SVM ed25519 public
 * keys (base58, 32 bytes). These helpers validate the EVM and SVM forms and
 * expose the EIP-55 checksum used by EVM tooling.
 */
public final class Validators {

    private Validators() {}

    /** Test whether {@code address} is {@code 0x} + exactly 40 hex chars. Case-insensitive. */
    public static boolean isValidEvmAddress(String address) {
        return address.matches("0x[0-9a-fA-F]{40}");
    }

    /**
     * Compute the EIP-55 mixed-case checksum form of an EVM address.
     *
     * @throws IllegalArgumentException if not a valid 20-byte hex address.
     */
    public static String toChecksumAddress(String address) {
        String body =
                (address.startsWith("0x") || address.startsWith("0X")
                                ? address.substring(2)
                                : address)
                        .toLowerCase();
        if (!body.matches("[0-9a-f]{40}")) {
            throw new IllegalArgumentException("invalid EVM address: " + address);
        }
        byte[] hash = Hashing.keccak256(body.getBytes(StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder("0x");
        for (int i = 0; i < body.length(); i++) {
            char ch = body.charAt(i);
            if (ch >= '0' && ch <= '9') {
                out.append(ch);
            } else {
                int hashByte = hash[i >> 1] & 0xff;
                int nibble = (i % 2 == 0) ? (hashByte >> 4) : (hashByte & 0x0f);
                out.append(nibble >= 8 ? Character.toUpperCase(ch) : ch);
            }
        }
        return out.toString();
    }

    /**
     * Test whether {@code address} is a correctly EIP-55-checksummed EVM address.
     * All-lowercase / all-uppercase addresses (no checksum info) return false.
     * Never throws.
     */
    public static boolean isChecksumAddress(String address) {
        if (!isValidEvmAddress(address)) {
            return false;
        }
        String body = address.substring(2);
        if (body.equals(body.toLowerCase()) || body.equals(body.toUpperCase())) {
            return false;
        }
        try {
            return toChecksumAddress(address).equals(address);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Test whether {@code address} is a valid SVM public key: a base58 string
     * decoding to exactly 32 bytes that is a valid ed25519 curve point. Off-curve
     * PDAs are rejected. Never throws.
     */
    public static boolean isValidSvmAddress(String address) {
        byte[] bytes;
        try {
            bytes = Base58.decode(address);
        } catch (RuntimeException e) {
            return false;
        }
        if (bytes.length != 32) {
            return false;
        }
        return Ed25519.validatePublicKeyFull(bytes, 0);
    }
}
