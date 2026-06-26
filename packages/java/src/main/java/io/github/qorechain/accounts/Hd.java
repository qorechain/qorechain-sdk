package io.github.qorechain.accounts;

import java.math.BigInteger;
import java.util.Arrays;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.math.ec.ECPoint;
import org.bouncycastle.math.ec.rfc8032.Ed25519;

/**
 * Hierarchical-deterministic key derivation.
 *
 * <ul>
 *   <li>BIP-32 over secp256k1 (for native Cosmos and EVM accounts), supporting
 *       both hardened and non-hardened child derivation.
 *   <li>SLIP-0010 over ed25519 (for SVM accounts), hardened-only as the standard
 *       requires.
 * </ul>
 */
public final class Hd {

    private Hd() {}

    private static final X9ECParameters SECP256K1 = SECNamedCurves.getByName("secp256k1");
    private static final BigInteger CURVE_N = SECP256K1.getN();
    private static final long HARDENED = 0x80000000L;

    private static byte[] hmacSha512(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA512");
            mac.init(new SecretKeySpec(key, "HmacSHA512"));
            return mac.doFinal(data);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA512 failed", e);
        }
    }

    private static long[] parsePath(String path) {
        String p = path.trim();
        if (!p.startsWith("m/") && !p.equals("m")) {
            throw new IllegalArgumentException("path must start with m/: " + path);
        }
        if (p.equals("m")) {
            return new long[0];
        }
        String[] parts = p.substring(2).split("/");
        long[] out = new long[parts.length];
        for (int i = 0; i < parts.length; i++) {
            String seg = parts[i];
            boolean hardened = seg.endsWith("'") || seg.endsWith("h") || seg.endsWith("H");
            String num = hardened ? seg.substring(0, seg.length() - 1) : seg;
            long idx = Long.parseLong(num);
            out[i] = hardened ? (idx + HARDENED) : idx;
        }
        return out;
    }

    // ---- secp256k1 (BIP-32) ----

    /** A secp256k1 keypair: 32-byte private scalar and 33-byte compressed public key. */
    public static final class Secp256k1Key {
        public final byte[] privateKey;
        public final byte[] publicKey;

        Secp256k1Key(byte[] privateKey, byte[] publicKey) {
            this.privateKey = privateKey;
            this.publicKey = publicKey;
        }
    }

    private static byte[] compressedPublicKey(BigInteger priv) {
        ECPoint point = SECP256K1.getG().multiply(priv).normalize();
        return point.getEncoded(true);
    }

    private static byte[] ser32(long i) {
        return new byte[] {
            (byte) (i >>> 24), (byte) (i >>> 16), (byte) (i >>> 8), (byte) i
        };
    }

    private static byte[] left32(byte[] in) {
        return Arrays.copyOfRange(in, 0, 32);
    }

    private static byte[] right32(byte[] in) {
        return Arrays.copyOfRange(in, 32, 64);
    }

    /** Derive a secp256k1 key at the given BIP-32 path from a BIP-39 seed. */
    public static Secp256k1Key deriveSecp256k1(byte[] seed, String path) {
        byte[] i = hmacSha512("Bitcoin seed".getBytes(java.nio.charset.StandardCharsets.UTF_8), seed);
        BigInteger key = new BigInteger(1, left32(i));
        byte[] chainCode = right32(i);
        for (long index : parsePath(path)) {
            boolean hardened = (index & HARDENED) != 0;
            byte[] data = new byte[37];
            if (hardened) {
                // 0x00 || ser256(kpar) || ser32(i)
                byte[] kpar = leftPad(key.toByteArray(), 32);
                data[0] = 0x00;
                System.arraycopy(kpar, 0, data, 1, 32);
            } else {
                // serP(point(kpar)) || ser32(i)
                byte[] pub = compressedPublicKey(key);
                System.arraycopy(pub, 0, data, 0, 33);
            }
            System.arraycopy(ser32(index), 0, data, 33, 4);
            byte[] il = hmacSha512(chainCode, data);
            BigInteger parse = new BigInteger(1, left32(il));
            key = parse.add(key).mod(CURVE_N);
            chainCode = right32(il);
        }
        byte[] priv = leftPad(key.toByteArray(), 32);
        return new Secp256k1Key(priv, compressedPublicKey(key));
    }

    private static byte[] leftPad(byte[] in, int size) {
        if (in.length == size) {
            return in;
        }
        byte[] out = new byte[size];
        if (in.length > size) {
            // Strip a leading sign byte from BigInteger.toByteArray().
            System.arraycopy(in, in.length - size, out, 0, size);
        } else {
            System.arraycopy(in, 0, out, size - in.length, in.length);
        }
        return out;
    }

    /** Decompress a 33-byte compressed secp256k1 public key to its 65-byte uncompressed form. */
    public static byte[] decompressPublicKey(byte[] compressed) {
        ECPoint point = SECP256K1.getCurve().decodePoint(compressed).normalize();
        return point.getEncoded(false);
    }

    // ---- ed25519 (SLIP-0010) ----

    /** An ed25519 keypair: 32-byte private seed and 32-byte public key. */
    public static final class Ed25519Key {
        public final byte[] privateKey; // 32-byte seed
        public final byte[] publicKey; // 32-byte public key

        Ed25519Key(byte[] privateKey, byte[] publicKey) {
            this.privateKey = privateKey;
            this.publicKey = publicKey;
        }
    }

    /**
     * Derive an ed25519 key at the given SLIP-0010 path from a BIP-39 seed. All
     * path segments must be hardened (SLIP-0010 for ed25519 supports hardened
     * keys only).
     */
    public static Ed25519Key deriveEd25519(byte[] seed, String path) {
        byte[] i = hmacSha512("ed25519 seed".getBytes(java.nio.charset.StandardCharsets.UTF_8), seed);
        byte[] key = left32(i);
        byte[] chainCode = right32(i);
        for (long index : parsePath(path)) {
            if ((index & HARDENED) == 0) {
                throw new IllegalArgumentException("ed25519 SLIP-0010 requires hardened path segments");
            }
            byte[] data = new byte[37];
            data[0] = 0x00;
            System.arraycopy(key, 0, data, 1, 32);
            System.arraycopy(ser32(index), 0, data, 33, 4);
            byte[] il = hmacSha512(chainCode, data);
            key = left32(il);
            chainCode = right32(il);
        }
        byte[] publicKey = new byte[Ed25519.PUBLIC_KEY_SIZE];
        Ed25519.generatePublicKey(key, 0, publicKey, 0);
        return new Ed25519Key(key, publicKey);
    }
}
