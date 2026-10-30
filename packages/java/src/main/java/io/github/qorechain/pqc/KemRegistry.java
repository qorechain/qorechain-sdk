package io.github.qorechain.pqc;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.RestClient;
import java.util.Base64;

/**
 * The on-chain KEM key registry (chain v3.2.5): an account publishes one
 * key-encapsulation public key (ML-KEM-1024, FIPS 203) so that anyone can encrypt
 * to it. It is not an authentication key; the account keeps signing with its
 * ML-DSA-87 key.
 *
 * <ul>
 *   <li>{@link #registerKemKey} / {@link #removeKemKey} build the messages. Both
 *       always need the account's hybrid signature (send them through
 *       {@link PqcDx.HybridSendPath}); the sender must already have a usable
 *       post-quantum signature key. There is no proof of possession: the hybrid
 *       signature authenticates the registration.
 *   <li>One key per account. Sending a registration again replaces the key, and
 *       the response reports {@code replaced}.
 *   <li>{@link #fetchKemKey} reads a published key over REST
 *       ({@code /qorechain/pqc/v1/kem/{address}}, bech32 or 0x address).
 * </ul>
 *
 * <p>The SDK only carries the chain messages and the query. Encryption is out of
 * scope; the chain stores and serves the raw key and defines no encryption
 * context.
 */
public final class KemRegistry {

    private KemRegistry() {}

    /** Algorithm id of ML-KEM-1024 in the chain's algorithm registry. */
    public static final int ALGORITHM_ML_KEM_1024 = 2;

    /** Size of an ML-KEM-1024 encapsulation (public) key, bytes. */
    public static final int ML_KEM_1024_PUBLIC_KEY_SIZE = 1568;

    /** The polynomial part of an ML-KEM-1024 public key: 4 x 384 bytes. */
    static final int ML_KEM_1024_T_HAT_SIZE = 1536;

    /** The ML-KEM modulus; every decoded coefficient must be below it. */
    static final int ML_KEM_Q = 3329;

    /**
     * Check a public key the way the chain does for {@code algorithmId}. For
     * ML-KEM-1024 (id 2): exactly 1568 bytes, every 12-bit coefficient of the
     * first 1536 bytes below 3329 (the FIPS 203 modulus check), and those bytes
     * not all zero. Other algorithm ids are left to the chain.
     *
     * @throws IllegalArgumentException naming the problem.
     */
    public static void validatePublicKey(int algorithmId, byte[] publicKey) {
        if (publicKey == null || publicKey.length == 0) {
            throw new IllegalArgumentException("KEM public key is empty");
        }
        if (algorithmId != ALGORITHM_ML_KEM_1024) {
            return;
        }
        if (publicKey.length != ML_KEM_1024_PUBLIC_KEY_SIZE) {
            throw new IllegalArgumentException(
                    "an ML-KEM-1024 public key is " + ML_KEM_1024_PUBLIC_KEY_SIZE + " bytes, got "
                            + publicKey.length);
        }
        boolean allZero = true;
        for (int i = 0; i < ML_KEM_1024_T_HAT_SIZE; i += 3) {
            int b0 = publicKey[i] & 0xFF;
            int b1 = publicKey[i + 1] & 0xFF;
            int b2 = publicKey[i + 2] & 0xFF;
            int c0 = b0 | ((b1 & 0x0F) << 8);
            int c1 = (b1 >> 4) | (b2 << 4);
            if (c0 >= ML_KEM_Q || c1 >= ML_KEM_Q) {
                throw new IllegalArgumentException(
                        "ML-KEM-1024 public key fails the FIPS 203 modulus check (a coefficient near byte "
                                + i + " is not below " + ML_KEM_Q + ")");
            }
            if ((b0 | b1 | b2) != 0) {
                allZero = false;
            }
        }
        if (allZero) {
            throw new IllegalArgumentException("ML-KEM-1024 public key is all zero");
        }
    }

    /** {@code MsgRegisterKEMKey} for an ML-KEM-1024 key ({@link #ALGORITHM_ML_KEM_1024}). */
    public static TypedMessage registerKemKey(String sender, byte[] publicKey) {
        return registerKemKey(sender, publicKey, ALGORITHM_ML_KEM_1024);
    }

    /**
     * {@code MsgRegisterKEMKey}: publish (or replace) the sender's KEM key. The
     * key is checked first ({@link #validatePublicKey}).
     */
    public static TypedMessage registerKemKey(String sender, byte[] publicKey, int algorithmId) {
        return QorechainMessages.pqc.registerKemKey(
                qorechain.pqc.v1.Tx.MsgRegisterKEMKey.newBuilder()
                        .setSender(sender)
                        .setAlgorithmId(algorithmId)
                        .setPublicKey(com.google.protobuf.ByteString.copyFrom(publicKey))
                        .build());
    }

    /** {@code MsgRemoveKEMKey}: withdraw the sender's published KEM key. */
    public static TypedMessage removeKemKey(String sender) {
        return QorechainMessages.pqc.removeKemKey(
                qorechain.pqc.v1.Tx.MsgRemoveKEMKey.newBuilder().setSender(sender).build());
    }

    /** A published KEM key. */
    public static final class KemKey {
        /** The bech32 account address that published the key. */
        public final String address;
        public final int algorithmId;
        /** The chain's name for the algorithm (e.g. {@code mlkem1024}). */
        public final String algorithmName;
        /** The raw encapsulation key. */
        public final byte[] publicKey;
        /** Height of the registration that published this key (a replacement resets it). */
        public final long registeredHeight;

        public KemKey(String address, int algorithmId, String algorithmName, byte[] publicKey, long registeredHeight) {
            this.address = address;
            this.algorithmId = algorithmId;
            this.algorithmName = algorithmName;
            this.publicKey = publicKey;
            this.registeredHeight = registeredHeight;
        }
    }

    /** The answer of {@link #fetchKemKey}: {@code key} is {@code null} when not {@code found}. */
    public static final class KemKeyResult {
        public final boolean found;
        public final KemKey key;

        public KemKeyResult(boolean found, KemKey key) {
            this.found = found;
            this.key = key;
        }
    }

    /** The REST path of the KEM key query. */
    public static String kemKeyPath(String address) {
        return "/qorechain/pqc/v1/kem/" + address;
    }

    /**
     * Read the KEM key {@code address} (bech32 or 0x) published.
     *
     * @throws IllegalStateException when the answer has no {@code found} field.
     */
    public static KemKeyResult fetchKemKey(String restUrl, String address) {
        return parseKemKey(new RestClient(restUrl).getKemKey(address));
    }

    /** Parse a {@code /qorechain/pqc/v1/kem/{address}} answer. */
    public static KemKeyResult parseKemKey(JsonNode body) {
        JsonNode found = body == null ? null : body.get("found");
        if (found == null || !found.isBoolean()) {
            throw new IllegalStateException("no \"found\" field in the KEM key answer: " + body);
        }
        JsonNode k = body.get("key");
        if (!found.asBoolean() || k == null || k.isNull()) {
            return new KemKeyResult(found.asBoolean(), null);
        }
        String pk = k.path("public_key").asText("");
        return new KemKeyResult(
                true,
                new KemKey(
                        k.path("address").asText(""),
                        k.path("algorithm_id").asInt(0),
                        k.path("algorithm_name").asText(""),
                        pk.isEmpty() ? new byte[0] : Base64.getDecoder().decode(pk),
                        Long.parseLong(k.path("registered_height").asText("0"))));
    }
}
