package io.github.qorechain.accounts;

import io.github.qorechain.utils.Hashing;
import java.math.BigInteger;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.signers.HMacDSAKCalculator;

/**
 * secp256k1 ECDSA signing for Native SIGN_MODE_DIRECT classical signatures.
 *
 * <p>The Native lane signs {@code sha256(signDocBytes)} with RFC-6979 deterministic
 * ECDSA, normalizes to low-S, and serializes the signature as the raw 64-byte
 * {@code r || s} (each 32 bytes big-endian) - NOT DER.
 */
public final class Secp256k1 {

    private Secp256k1() {}

    private static final X9ECParameters CURVE_PARAMS = SECNamedCurves.getByName("secp256k1");
    private static final ECDomainParameters DOMAIN =
            new ECDomainParameters(
                    CURVE_PARAMS.getCurve(),
                    CURVE_PARAMS.getG(),
                    CURVE_PARAMS.getN(),
                    CURVE_PARAMS.getH());
    private static final BigInteger HALF_N = CURVE_PARAMS.getN().shiftRight(1);

    /**
     * Sign {@code message} (which is hashed with SHA-256 first) with a 32-byte
     * secp256k1 private key, returning the 64-byte {@code r || s} low-S signature.
     */
    public static byte[] signCosmos(byte[] privateKey, byte[] message) {
        return signHash(privateKey, Hashing.sha256(message));
    }

    /**
     * Sign an eth-native ({@code eth_secp256k1}) SignDoc: RFC-6979 deterministic
     * ECDSA over {@code keccak256(message)}, returning the 64-byte {@code r || s}
     * low-S signature. This is the classical half of the eth-native Native lane
     * (the address is {@code keccak(pubkey)[12:]}), where the SignDoc is hashed
     * with keccak-256 - NOT sha256.
     */
    public static byte[] signEth(byte[] privateKey, byte[] message) {
        return signHash(privateKey, Hashing.keccak256(message));
    }

    /**
     * Sign a pre-computed 32-byte {@code hash} with a 32-byte secp256k1 private key
     * using RFC-6979 deterministic ECDSA, returning the 64-byte {@code r || s}
     * low-S signature.
     */
    public static byte[] signHash(byte[] privateKey, byte[] hash) {
        ECDSASigner signer = new ECDSASigner(new HMacDSAKCalculator(new org.bouncycastle.crypto.digests.SHA256Digest()));
        signer.init(true, new ECPrivateKeyParameters(new BigInteger(1, privateKey), DOMAIN));
        BigInteger[] sig = signer.generateSignature(hash);
        BigInteger r = sig[0];
        BigInteger s = sig[1];
        if (s.compareTo(HALF_N) > 0) {
            s = CURVE_PARAMS.getN().subtract(s); // low-S normalization
        }
        byte[] out = new byte[64];
        System.arraycopy(to32(r), 0, out, 0, 32);
        System.arraycopy(to32(s), 0, out, 32, 32);
        return out;
    }

    /**
     * Sign a pre-computed 32-byte {@code hash} like {@link #signHash} and append the
     * recovery id, returning the 65-byte {@code r || s || recId} signature
     * ({@code recId} is 0 or 1; add 27 for the Ethereum {@code v}).
     */
    public static byte[] signHashRecoverable(byte[] privateKey, byte[] hash) {
        byte[] rs = signHash(privateKey, hash);
        byte[] pub = publicKey(privateKey, false);
        BigInteger r = new BigInteger(1, java.util.Arrays.copyOfRange(rs, 0, 32));
        BigInteger s = new BigInteger(1, java.util.Arrays.copyOfRange(rs, 32, 64));
        for (int recId = 0; recId < 2; recId++) {
            byte[] q = recoverPublicKey(recId, r, s, hash);
            if (q != null && java.util.Arrays.equals(q, pub)) {
                byte[] out = new byte[65];
                System.arraycopy(rs, 0, out, 0, 64);
                out[64] = (byte) recId;
                return out;
            }
        }
        throw new IllegalStateException("could not compute the signature recovery id");
    }

    /**
     * Recover the 65-byte uncompressed public key from an ECDSA signature over
     * {@code hash} (SEC 1 section 4.1.6), or {@code null} when {@code recId} does
     * not give a point.
     */
    public static byte[] recoverPublicKey(int recId, BigInteger r, BigInteger s, byte[] hash) {
        BigInteger n = CURVE_PARAMS.getN();
        if (r.signum() <= 0 || r.compareTo(n) >= 0 || s.signum() <= 0 || s.compareTo(n) >= 0) {
            return null;
        }
        org.bouncycastle.math.ec.ECCurve curve = CURVE_PARAMS.getCurve();
        BigInteger p = curve.getField().getCharacteristic();
        if (r.compareTo(p) >= 0) {
            return null;
        }
        byte[] enc = new byte[33];
        enc[0] = (byte) (0x02 | (recId & 1));
        System.arraycopy(to32(r), 0, enc, 1, 32);
        org.bouncycastle.math.ec.ECPoint bigR;
        try {
            bigR = curve.decodePoint(enc);
        } catch (IllegalArgumentException e) {
            return null;
        }
        BigInteger e = new BigInteger(1, hash);
        BigInteger rInv = r.modInverse(n);
        org.bouncycastle.math.ec.ECPoint q =
                org.bouncycastle.math.ec.ECAlgorithms.sumOfTwoMultiplies(
                                CURVE_PARAMS.getG(), e.negate().mod(n).multiply(rInv).mod(n),
                                bigR, s.multiply(rInv).mod(n))
                        .normalize();
        return q.isInfinity() ? null : q.getEncoded(false);
    }

    /** The public key of a 32-byte private key: 33-byte compressed or 65-byte uncompressed. */
    public static byte[] publicKey(byte[] privateKey, boolean compressed) {
        return CURVE_PARAMS.getG().multiply(new BigInteger(1, privateKey)).normalize().getEncoded(compressed);
    }

    /** The 20-byte Ethereum address of a private key: {@code keccak256(uncompressed[1:])[12:]}. */
    public static byte[] ethAddress(byte[] privateKey) {
        byte[] pub = publicKey(privateKey, false);
        byte[] h = Hashing.keccak256(java.util.Arrays.copyOfRange(pub, 1, 65));
        return java.util.Arrays.copyOfRange(h, 12, 32);
    }

    private static byte[] to32(BigInteger v) {
        byte[] b = v.toByteArray();
        byte[] out = new byte[32];
        if (b.length > 32) {
            System.arraycopy(b, b.length - 32, out, 0, 32);
        } else {
            System.arraycopy(b, 0, out, 32 - b.length, b.length);
        }
        return out;
    }
}
