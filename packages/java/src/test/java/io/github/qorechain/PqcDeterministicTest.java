package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/**
 * Deterministic-signing regression tests.
 *
 * <p>The chain's PQC verifier accepts ONLY deterministic (FIPS-204 §3.4,
 * {@code rnd} = 32 zero bytes) ML-DSA-87 signatures; hedged signing is rejected
 * with codespace {@code pqc}. These tests pin the deterministic default against
 * the shared qorechain-pqc vectors.
 */
class PqcDeterministicTest {

    private static byte[] fromHex(String s) {
        int n = s.length() / 2;
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }

    private static JsonNode vectors() throws Exception {
        try (InputStream in =
                PqcDeterministicTest.class.getResourceAsStream("/ml-dsa-87-deterministic.json")) {
            return new ObjectMapper().readTree(in).get("cases");
        }
    }

    @Test
    void pqcSignIsDeterministic() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "deterministic ML-DSA-87 required by the chain".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(
                Pqc.pqcSign(kp.secretKey, msg),
                Pqc.pqcSign(kp.secretKey, msg),
                "two signatures over the same input must be byte-identical");
    }

    @Test
    void pqcSignMatchesSharedDeterministicVectors() throws Exception {
        for (JsonNode c : vectors()) {
            byte[] secretKey = fromHex(c.get("secretKey").asText());
            byte[] publicKey = fromHex(c.get("publicKey").asText());
            byte[] message = fromHex(c.get("message").asText());
            byte[] expected = fromHex(c.get("signature").asText());

            byte[] sig = Pqc.pqcSign(secretKey, message);
            assertArrayEquals(expected, sig, "signature must match the shared vector");
            assertTrue(Pqc.pqcVerify(publicKey, message, sig));
        }
    }

    @Test
    void pqcSignHedgedOptInDiffersButVerifies() {
        PqcKeypair kp = Pqc.generatePqcKeypair();
        byte[] msg = "hedged signatures are NOT accepted by the chain".getBytes(StandardCharsets.UTF_8);
        byte[] det = Pqc.pqcSign(kp.secretKey, msg);
        byte[] hedged = Pqc.pqcSignHedged(kp.secretKey, msg);
        assertFalse(Arrays.equals(det, hedged));
        assertTrue(Pqc.pqcVerify(kp.publicKey, msg, hedged));
    }
}
