package io.github.qorechain.pqc;

import java.security.SecureRandom;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAKeyGenerationParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAKeyPairGenerator;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPublicKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSASigner;

/**
 * Post-quantum (PQC) signing for QoreChain using ML-DSA-87 (Dilithium-5, NIST
 * FIPS 204), delegated entirely to BouncyCastle's {@code mldsa} primitives.
 *
 * <p>Provides keygen / sign / verify and the on-chain hybrid-signature extension
 * builder. It does NOT assemble or broadcast transactions — the tx builder
 * attaches the extension this module describes.
 */
public final class Pqc {

    private Pqc() {}

    /** ML-DSA-87 public-key length, in bytes (FIPS 204 / core: 2592). */
    public static final int ML_DSA_87_PUBLIC_KEY_LENGTH = 2592;
    /** ML-DSA-87 secret-key length, in bytes (FIPS 204 / core: 4896). */
    public static final int ML_DSA_87_SECRET_KEY_LENGTH = 4896;
    /** ML-DSA-87 signature length, in bytes (FIPS 204 / core: 4627). */
    public static final int ML_DSA_87_SIGNATURE_LENGTH = 4627;
    /** Length, in bytes, of the deterministic-keygen seed per FIPS 204. */
    public static final int ML_DSA_87_SEED_LENGTH = 32;

    /**
     * The TX-extension type URL for the on-chain {@code PQCHybridSignature}
     * message (core: {@code HybridSigTypeURL}).
     */
    public static final String HYBRID_SIG_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature";

    /**
     * Generate a random ML-DSA-87 keypair.
     */
    public static PqcKeypair generatePqcKeypair() {
        return generatePqcKeypair(null);
    }

    /**
     * Generate an ML-DSA-87 keypair.
     *
     * @param seed optional 32-byte seed for reproducible keygen (e.g. derived
     *     from a wallet). When non-null it deterministically seeds the keygen RNG;
     *     when null a cryptographically random keypair is produced.
     * @throws IllegalArgumentException if {@code seed} is non-null and not 32 bytes.
     */
    public static PqcKeypair generatePqcKeypair(byte[] seed) {
        if (seed != null && seed.length != ML_DSA_87_SEED_LENGTH) {
            throw new IllegalArgumentException(
                    "ML-DSA-87 seed must be " + ML_DSA_87_SEED_LENGTH + " bytes, got " + seed.length);
        }
        SecureRandom random = (seed != null) ? new FixedSeedRandom(seed) : new SecureRandom();
        MLDSAKeyPairGenerator gen = new MLDSAKeyPairGenerator();
        gen.init(new MLDSAKeyGenerationParameters(random, MLDSAParameters.ml_dsa_87));
        AsymmetricCipherKeyPair kp = gen.generateKeyPair();
        byte[] pub = ((MLDSAPublicKeyParameters) kp.getPublic()).getEncoded();
        byte[] sec = ((MLDSAPrivateKeyParameters) kp.getPrivate()).getEncoded();
        return new PqcKeypair(pub, sec);
    }

    /**
     * Sign a message with an ML-DSA-87 secret key (pure mode, empty context).
     *
     * <p>Signing is DETERMINISTIC (FIPS-204 §3.4, {@code rnd} = 32 zero bytes):
     * the same {@code (secretKey, message)} always yields the same signature.
     * The chain's on-chain PQC verifier accepts ONLY deterministic ML-DSA-87
     * signatures (hedged signatures are rejected with codespace {@code pqc}),
     * so this default is consensus-critical. Use {@link #pqcSignHedged} only
     * for off-chain uses that want side-channel hedging.
     */
    public static byte[] pqcSign(byte[] secretKey, byte[] message) {
        MLDSAPrivateKeyParameters priv =
                new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_87, secretKey);
        MLDSASigner signer = new MLDSASigner();
        // No ParametersWithRandom: BouncyCastle then signs deterministically.
        signer.init(true, priv);
        signer.update(message, 0, message.length);
        try {
            return signer.generateSignature();
        } catch (org.bouncycastle.crypto.CryptoException e) {
            throw new IllegalStateException("ML-DSA-87 signing failed", e);
        }
    }

    /**
     * Sign a message with an ML-DSA-87 secret key using the RANDOMIZED (hedged)
     * FIPS-204 variant.
     *
     * <p>NOT accepted by the chain's PQC verifier — use {@link #pqcSign} for
     * anything that goes on-chain.
     */
    public static byte[] pqcSignHedged(byte[] secretKey, byte[] message) {
        MLDSAPrivateKeyParameters priv =
                new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_87, secretKey);
        MLDSASigner signer = new MLDSASigner();
        signer.init(true, new ParametersWithRandom(priv, new SecureRandom()));
        signer.update(message, 0, message.length);
        try {
            return signer.generateSignature();
        } catch (org.bouncycastle.crypto.CryptoException e) {
            throw new IllegalStateException("ML-DSA-87 signing failed", e);
        }
    }

    /** Verify an ML-DSA-87 signature over a message. */
    public static boolean pqcVerify(byte[] publicKey, byte[] message, byte[] signature) {
        MLDSAPublicKeyParameters pub =
                new MLDSAPublicKeyParameters(MLDSAParameters.ml_dsa_87, publicKey);
        MLDSASigner verifier = new MLDSASigner();
        verifier.init(false, pub);
        verifier.update(message, 0, message.length);
        return verifier.verifySignature(signature);
    }

    /**
     * Build the on-chain {@code PQCHybridSignature} extension from a signature.
     *
     * <p>Validation mirrors the core: the algorithm must be a signature scheme,
     * the signature must be non-empty, and for Dilithium-5 the signature/public-key
     * lengths are enforced.
     *
     * @param algorithmId PQC algorithm ID (e.g. {@link PqcAlgorithm#ALGORITHM_DILITHIUM5}).
     * @param signature raw PQC signature bytes.
     * @param publicKey optional PQC public key for auto-registration; omitted from
     *     the JSON when null.
     */
    public static HybridSignatureExtension buildHybridSignatureExtension(
            int algorithmId, byte[] signature, byte[] publicKey) {
        if (!PqcAlgorithm.isSignatureAlgorithm(algorithmId)) {
            throw new IllegalArgumentException(
                    "algorithm "
                            + PqcAlgorithm.algorithmName(algorithmId)
                            + " is not a PQC signature algorithm");
        }
        if (signature.length == 0) {
            throw new IllegalArgumentException("PQC signature cannot be empty");
        }
        if (algorithmId == PqcAlgorithm.ALGORITHM_DILITHIUM5) {
            if (signature.length != ML_DSA_87_SIGNATURE_LENGTH) {
                throw new IllegalArgumentException(
                        "dilithium5 signature must be "
                                + ML_DSA_87_SIGNATURE_LENGTH
                                + " bytes, got "
                                + signature.length);
            }
            if (publicKey != null && publicKey.length != ML_DSA_87_PUBLIC_KEY_LENGTH) {
                throw new IllegalArgumentException(
                        "dilithium5 public key must be "
                                + ML_DSA_87_PUBLIC_KEY_LENGTH
                                + " bytes, got "
                                + publicKey.length);
            }
        }
        return new HybridSignatureExtension(algorithmId, signature, publicKey);
    }

    /**
     * A {@link SecureRandom} that hands the ML-DSA-87 key generator the supplied
     * 32-byte seed VERBATIM as the FIPS-204 keygen randomness ξ.
     *
     * <p>BouncyCastle's {@code MLDSAKeyPairGenerator} draws ξ with a single
     * {@code nextBytes(new byte[32])} call and then runs the standard FIPS-204
     * {@code H(ξ ‖ K ‖ L, 128)} expansion internally. Returning the seed unchanged
     * on that first draw makes the keypair byte-identical to
     * {@code @noble/post-quantum}'s {@code mldsa87.keygen(seed)} (verified: same
     * public-key bytes for the same seed), so a wallet's deterministic PQC key is
     * portable across the QoreChain SDKs. Any subsequent draw yields zeros (unused
     * by ml_dsa keygen).
     */
    private static final class FixedSeedRandom extends SecureRandom {
        private final byte[] seed;
        private boolean consumed = false;

        FixedSeedRandom(byte[] seed) {
            this.seed = seed.clone();
        }

        @Override
        public void nextBytes(byte[] bytes) {
            if (!consumed && bytes.length == seed.length) {
                System.arraycopy(seed, 0, bytes, 0, seed.length);
                consumed = true;
            } else {
                java.util.Arrays.fill(bytes, (byte) 0);
            }
        }
    }
}
