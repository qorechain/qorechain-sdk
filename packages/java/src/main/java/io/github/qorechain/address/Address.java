package io.github.qorechain.address;

import io.github.qorechain.utils.Bech32;
import io.github.qorechain.utils.Hex;

/**
 * Conversion and validation for QoreChain bech32 addresses (e.g. {@code qor1...})
 * and their underlying byte payloads expressed as {@code 0x}-prefixed hex.
 */
public final class Address {

    private Address() {}

    /** Default bech32 human-readable prefix for QoreChain account addresses. */
    public static final String DEFAULT_PREFIX = "qor";

    /** Decode a bech32 address to a {@code 0x}-prefixed hex string of its byte payload. */
    public static String bech32ToHex(String addr) {
        return Hex.encodePrefixed(Bech32.decode(addr).data);
    }

    /** Encode raw bytes to a bech32 address with the given prefix. */
    public static String bytesToBech32(byte[] bytes, String prefix) {
        return Bech32.encode(prefix, bytes);
    }

    /** Encode raw bytes to a bech32 account address ({@code qor} prefix). */
    public static String bytesToBech32(byte[] bytes) {
        return bytesToBech32(bytes, DEFAULT_PREFIX);
    }

    /** Encode hex bytes (with or without {@code 0x}) to a bech32 address with the given prefix. */
    public static String hexToBech32(String hex, String prefix) {
        return bytesToBech32(Hex.decode(hex), prefix);
    }

    /** Encode hex bytes to a bech32 account address ({@code qor} prefix). */
    public static String hexToBech32(String hex) {
        return hexToBech32(hex, DEFAULT_PREFIX);
    }

    /** Validate a bech32 address. Never throws. */
    public static boolean isValidBech32(String addr) {
        return isValidBech32(addr, null);
    }

    /**
     * Validate a bech32 address, optionally requiring a specific prefix. Never throws.
     *
     * @param prefix if non-null, the decoded prefix must match exactly.
     */
    public static boolean isValidBech32(String addr, String prefix) {
        try {
            Bech32.Decoded d = Bech32.decode(addr);
            return prefix == null || d.prefix.equals(prefix);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Decode a {@code qor1...} account address to the {@code 0x}-hex of its 20-byte
     * payload — the same bytes the matching EVM address carries.
     */
    public static String qorToEvm(String addr) {
        return bech32ToHex(addr);
    }

    /** Encode an EVM {@code 0x...} address into the matching {@code qor1...} account address. */
    public static String evmToQor(String hex) {
        return hexToBech32(hex, DEFAULT_PREFIX);
    }
}
