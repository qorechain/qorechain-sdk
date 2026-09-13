package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.pqc.HybridSignatureExtension;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcAlgorithm;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.HybridTx;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * ML-DSA-87 sizes, sign/verify/tamper, deterministic keygen, and protobuf encoding
 * of the hybrid-signature extension.
 */
class PqcTest {

    @Test
    void mlDsa87Sizes() {
        assertEquals(2592, Pqc.ML_DSA_87_PUBLIC_KEY_LENGTH);
        assertEquals(4896, Pqc.ML_DSA_87_SECRET_KEY_LENGTH);
        assertEquals(4627, Pqc.ML_DSA_87_SIGNATURE_LENGTH);
        PqcKeypair kp = Pqc.generatePqcKeypair();
        assertEquals(2592, kp.publicKey.length);
        assertEquals(4896, kp.secretKey.length);
        byte[] sig = Pqc.pqcSign(kp.secretKey, "transaction body bytes".getBytes(StandardCharsets.UTF_8));
        assertEquals(4627, sig.length);
    }

    @Test
    void signVerifyAndTamper() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "transaction body bytes".getBytes(StandardCharsets.UTF_8);
        byte[] sig = Pqc.pqcSign(kp.secretKey, msg);
        assertTrue(Pqc.pqcVerify(kp.publicKey, msg, sig));
        byte[] tampered = "transaction body bytesX".getBytes(StandardCharsets.UTF_8);
        assertFalse(Pqc.pqcVerify(kp.publicKey, tampered, sig));
    }

    @Test
    void deterministicKeygenFromSeed() {
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 9);
        PqcKeypair k1 = Pqc.generatePqcKeypair(seed);
        PqcKeypair k2 = Pqc.generatePqcKeypair(seed);
        assertArrayEquals(k1.publicKey, k2.publicKey);
        assertArrayEquals(k1.secretKey, k2.secretKey);
    }

    @Test
    void invalidSeedLengthThrows() {
        assertThrows(IllegalArgumentException.class, () -> Pqc.generatePqcKeypair(new byte[10]));
    }

    @Test
    void hybridSigTypeUrl() {
        assertEquals("/qorechain.pqc.v1.PQCHybridSignature", Pqc.HYBRID_SIG_TYPE_URL);
    }

    @Test
    void extensionProtoOmitsPublicKeyWhenAbsent() throws Exception {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] sig = Pqc.pqcSign(kp.secretKey, "m".getBytes(StandardCharsets.UTF_8));
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(PqcAlgorithm.ALGORITHM_DILITHIUM5, sig, null);
        com.google.protobuf.Any any = HybridTx.encodeHybridExtension(ext);
        // Protobuf-encoded: leading field-1 varint tag 0x08, NEVER JSON 0x7b ('{').
        assertEquals((byte) 0x08, any.getValue().byteAt(0));
        assertNotEquals((byte) 0x7b, any.getValue().byteAt(0));
        qorechain.pqc.v1.Hybrid.PQCHybridSignature decoded =
                qorechain.pqc.v1.Hybrid.PQCHybridSignature.parseFrom(any.getValue());
        assertEquals(1, decoded.getAlgorithmId());
        assertArrayEquals(sig, decoded.getPqcSignature().toByteArray());
        assertEquals(0, decoded.getPqcPublicKey().size());
    }

    @Test
    void extensionProtoIncludesPublicKeyWhenPresent() throws Exception {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] sig = Pqc.pqcSign(kp.secretKey, "m".getBytes(StandardCharsets.UTF_8));
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5, sig, kp.publicKey);
        com.google.protobuf.Any any = HybridTx.encodeHybridExtension(ext);
        assertEquals((byte) 0x08, any.getValue().byteAt(0));
        qorechain.pqc.v1.Hybrid.PQCHybridSignature decoded =
                qorechain.pqc.v1.Hybrid.PQCHybridSignature.parseFrom(any.getValue());
        assertEquals(1, decoded.getAlgorithmId());
        assertArrayEquals(kp.publicKey, decoded.getPqcPublicKey().toByteArray());
        assertEquals(1, ext.algorithmId);
    }

    @Test
    void buildExtensionRejectsEmptyAndWrongSize() {
        assertThrows(
                IllegalArgumentException.class,
                () -> Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5, new byte[0], null));
        assertThrows(
                IllegalArgumentException.class,
                () -> Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5, new byte[10], null));
    }

    /**
     * The FIPS-204 encodings are fixed-length, and the five official QoreChain
     * bindings must agree on that: an ML-DSA-87 signature is 4627 bytes, not 4628
     * with a byte of trailing garbage. (A probe found the Go binding accepting the
     * over-long form while Rust rejected it — a disagreement the chain cannot
     * afford.) Verification therefore rejects on length, before the library runs.
     */
    @Test
    void verifyRejectsSignaturesThatAreNotExactlySpecLength() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "transaction body bytes".getBytes(StandardCharsets.UTF_8);
        byte[] sig = Pqc.pqcSign(kp.secretKey, msg);
        assertEquals(Pqc.ML_DSA_87_SIGNATURE_LENGTH, sig.length);
        // The exact-length signature still verifies.
        assertTrue(Pqc.pqcVerify(kp.publicKey, msg, sig));

        // One extra trailing byte: same 4627-byte prefix, still rejected.
        byte[] tooLong = Arrays.copyOf(sig, sig.length + 1);
        assertEquals(Pqc.ML_DSA_87_SIGNATURE_LENGTH + 1, tooLong.length);
        assertFalse(Pqc.pqcVerify(kp.publicKey, msg, tooLong));

        // Truncated by one byte: rejected.
        byte[] truncated = Arrays.copyOf(sig, sig.length - 1);
        assertFalse(Pqc.pqcVerify(kp.publicKey, msg, truncated));

        // Null / empty are rejected as failures, not crashes.
        assertFalse(Pqc.pqcVerify(kp.publicKey, msg, null));
        assertFalse(Pqc.pqcVerify(kp.publicKey, msg, new byte[0]));
    }

    @Test
    void verifyRejectsPublicKeysThatAreNotExactlySpecLength() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "transaction body bytes".getBytes(StandardCharsets.UTF_8);
        byte[] sig = Pqc.pqcSign(kp.secretKey, msg);

        assertFalse(Pqc.pqcVerify(Arrays.copyOf(kp.publicKey, kp.publicKey.length + 1), msg, sig));
        assertFalse(Pqc.pqcVerify(Arrays.copyOf(kp.publicKey, kp.publicKey.length - 1), msg, sig));
        assertFalse(Pqc.pqcVerify(null, msg, sig));
    }

    @Test
    void signRejectsSecretKeysThatAreNotExactlySpecLength() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "m".getBytes(StandardCharsets.UTF_8);
        byte[] tooLong = Arrays.copyOf(kp.secretKey, kp.secretKey.length + 1);
        byte[] truncated = Arrays.copyOf(kp.secretKey, kp.secretKey.length - 1);

        assertThrows(IllegalArgumentException.class, () -> Pqc.pqcSign(tooLong, msg));
        assertThrows(IllegalArgumentException.class, () -> Pqc.pqcSign(truncated, msg));
        assertThrows(IllegalArgumentException.class, () -> Pqc.pqcSign(null, msg));
        assertThrows(IllegalArgumentException.class, () -> Pqc.pqcSignHedged(tooLong, msg));
    }

    @Test
    void algorithmConstants() {
        assertEquals(1, PqcAlgorithm.ALGORITHM_DILITHIUM5);
        assertEquals(2, PqcAlgorithm.ALGORITHM_MLKEM1024);
        assertTrue(PqcAlgorithm.isSignatureAlgorithm(PqcAlgorithm.ALGORITHM_DILITHIUM5));
        assertFalse(PqcAlgorithm.isSignatureAlgorithm(PqcAlgorithm.ALGORITHM_MLKEM1024));
    }
}
