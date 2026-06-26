package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.pqc.HybridSignatureExtension;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcAlgorithm;
import io.github.qorechain.pqc.PqcKeypair;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** ML-DSA-87 sizes, sign/verify/tamper, deterministic keygen, and extension JSON. */
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
    void extensionJsonOmitsPublicKeyWhenAbsent() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] sig = Pqc.pqcSign(kp.secretKey, "m".getBytes(StandardCharsets.UTF_8));
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(PqcAlgorithm.ALGORITHM_DILITHIUM5, sig, null);
        String json = ext.toJson();
        assertTrue(json.contains("\"algorithm_id\":1"));
        assertTrue(json.contains("\"pqc_signature\":\""));
        assertFalse(json.contains("pqc_public_key"));
    }

    @Test
    void extensionJsonIncludesPublicKeyWhenPresent() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] sig = Pqc.pqcSign(kp.secretKey, "m".getBytes(StandardCharsets.UTF_8));
        HybridSignatureExtension ext =
                Pqc.buildHybridSignatureExtension(
                        PqcAlgorithm.ALGORITHM_DILITHIUM5, sig, kp.publicKey);
        assertTrue(ext.toJson().contains("\"pqc_public_key\":\""));
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

    @Test
    void algorithmConstants() {
        assertEquals(1, PqcAlgorithm.ALGORITHM_DILITHIUM5);
        assertEquals(2, PqcAlgorithm.ALGORITHM_MLKEM1024);
        assertTrue(PqcAlgorithm.isSignatureAlgorithm(PqcAlgorithm.ALGORITHM_DILITHIUM5));
        assertFalse(PqcAlgorithm.isSignatureAlgorithm(PqcAlgorithm.ALGORITHM_MLKEM1024));
    }
}
