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
 * secp256k1 ECDSA signing for Cosmos SIGN_MODE_DIRECT classical signatures.
 *
 * <p>Cosmos signs {@code sha256(signDocBytes)} with RFC-6979 deterministic
 * ECDSA, normalizes to low-S, and serializes the signature as the raw 64-byte
 * {@code r || s} (each 32 bytes big-endian) — NOT DER.
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
        byte[] hash = Hashing.sha256(message);
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
