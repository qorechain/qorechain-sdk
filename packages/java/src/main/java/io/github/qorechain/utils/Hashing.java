package io.github.qorechain.utils;

import java.nio.charset.StandardCharsets;
import org.bouncycastle.crypto.digests.KeccakDigest;
import org.bouncycastle.crypto.digests.RIPEMD160Digest;
import org.bouncycastle.crypto.digests.SHA256Digest;

/**
 * Hash helpers built on BouncyCastle: SHA-256, keccak-256 (the EVM hashing
 * primitive), and RIPEMD-160.
 *
 * <p>Each function accepts raw bytes or a UTF-8 string and returns the digest as
 * raw bytes, with a {@code *Hex} companion returning a lowercase
 * {@code 0x}-prefixed hex string.
 */
public final class Hashing {

    private Hashing() {}

    private static byte[] toBytes(String input) {
        return input.getBytes(StandardCharsets.UTF_8);
    }

    /** SHA-256 digest of {@code input}. */
    public static byte[] sha256(byte[] input) {
        SHA256Digest d = new SHA256Digest();
        d.update(input, 0, input.length);
        byte[] out = new byte[d.getDigestSize()];
        d.doFinal(out, 0);
        return out;
    }

    public static byte[] sha256(String input) {
        return sha256(toBytes(input));
    }

    public static String sha256Hex(byte[] input) {
        return Hex.encodePrefixed(sha256(input));
    }

    public static String sha256Hex(String input) {
        return Hex.encodePrefixed(sha256(input));
    }

    /** keccak-256 digest of {@code input} (the EVM hashing primitive, NOT SHA3-256). */
    public static byte[] keccak256(byte[] input) {
        KeccakDigest d = new KeccakDigest(256);
        d.update(input, 0, input.length);
        byte[] out = new byte[d.getDigestSize()];
        d.doFinal(out, 0);
        return out;
    }

    public static byte[] keccak256(String input) {
        return keccak256(toBytes(input));
    }

    public static String keccak256Hex(byte[] input) {
        return Hex.encodePrefixed(keccak256(input));
    }

    public static String keccak256Hex(String input) {
        return Hex.encodePrefixed(keccak256(input));
    }

    /** RIPEMD-160 digest of {@code input}. */
    public static byte[] ripemd160(byte[] input) {
        RIPEMD160Digest d = new RIPEMD160Digest();
        d.update(input, 0, input.length);
        byte[] out = new byte[d.getDigestSize()];
        d.doFinal(out, 0);
        return out;
    }

    public static byte[] ripemd160(String input) {
        return ripemd160(toBytes(input));
    }

    public static String ripemd160Hex(byte[] input) {
        return Hex.encodePrefixed(ripemd160(input));
    }

    public static String ripemd160Hex(String input) {
        return Hex.encodePrefixed(ripemd160(input));
    }
}
