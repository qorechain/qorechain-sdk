package io.github.qorechain.pqc;

import com.fasterxml.jackson.databind.JsonNode;
import com.google.protobuf.ByteString;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.StdFee;
import java.util.List;

/**
 * High-level quantum-safe developer-experience helpers.
 *
 * <p>QoreChain treats post-quantum cryptography (PQC) as a first-class signature
 * scheme: an account registers an ML-DSA-87 (Dilithium-5) key on-chain
 * ({@code MsgRegisterPQCKey}), after which its transactions can carry a hybrid
 * (classical secp256k1 + ML-DSA-87) signature that the ante handler verifies in
 * full. The low-level primitives already exist — {@link Pqc#generatePqcKeypair()},
 * {@link HybridTx#buildHybridTx}, the {@code QorechainMessages.pqc.registerPqcKey}
 * composer, and the {@code qor_getPQCKeyStatus} read. This class wraps them into a
 * tiny, idempotent surface so a dApp becomes <b>quantum-safe by default</b>: one
 * call to be PQC-protected.
 *
 * <p>The headline calls:
 * <ul>
 *   <li>{@link #isPqcRegistered} / {@link #getPqcStatus} — read whether an address
 *       has a registered PQC key (via {@code qor_getPQCKeyStatus}).
 *   <li>{@link #ensurePqcRegistered} — register the signer's Dilithium key if (and
 *       only if) it is not already registered. Idempotent: safe to call on every
 *       app start.
 *   <li>{@link #migrateToHybrid} — ensure registration, then hand back a hybrid
 *       send path wired to {@link HybridTx#buildHybridTx} and the broadcaster.
 *   <li>{@link #migratePqcKey} — rotate an account's PQC key ({@code MsgMigratePQCKey}).
 * </ul>
 *
 * <p>Reads take a {@link QorClient} directly; writes take a {@link Signer},
 * {@link Broadcaster}, and (for the idempotency pre-flight) an optional
 * {@link QorClient}. The {@link Signer} mirrors the one used by the cross-VM
 * client from the parallel round.
 *
 * <p><b>Precompile alternative:</b> the same status is readable on the EVM side via
 * the {@code pqcKeyStatus(address) returns (bool registered, uint8 algorithmId,
 * bytes pubkey)} precompile at {@link #PQC_KEY_STATUS_PRECOMPILE_ADDRESS} (exposed
 * by {@code io.github.qorechain.evm.EvmPrecompiles}). The helpers below prefer the
 * {@code qor_getPQCKeyStatus} JSON-RPC method; the precompile is the documented
 * alternative for callers already on the EVM side.
 */
public final class PqcDx {

    private PqcDx() {}

    /** EVM precompile address for the {@code pqcKeyStatus} read (documented alternative). */
    public static final String PQC_KEY_STATUS_PRECOMPILE_ADDRESS =
            "0x0000000000000000000000000000000000000A02";

    /** Default key-type tag forwarded to {@code MsgRegisterPQCKey}. */
    public static final String DEFAULT_KEY_TYPE = "hybrid";

    /** Normalized PQC registration status for an address. */
    public static final class PqcStatus {
        /** Whether the address has a registered PQC key. */
        public final boolean registered;
        /**
         * The registered algorithm id, when known ({@link PqcAlgorithm#ALGORITHM_DILITHIUM5}),
         * or {@link PqcAlgorithm#ALGORITHM_UNSPECIFIED} when the chain did not report one.
         */
        public final int algorithmId;
        /** The registered PQC public key, when the chain returns it; otherwise {@code null}. */
        public final byte[] pubkey;

        public PqcStatus(boolean registered, int algorithmId, byte[] pubkey) {
            this.registered = registered;
            this.algorithmId = algorithmId;
            this.pubkey = pubkey;
        }
    }

    /**
     * The signing / broadcasting context shared across writes: secp256k1 keys, the
     * signer's ML-DSA-87 keypair, chain id, account identity, and fee. Mirrors the
     * cross-VM client's {@code Signer} plus the bound PQC keypair.
     */
    public static final class Signer {
        public String sender;
        public byte[] secp256k1PrivateKey;
        public byte[] secp256k1PublicKey;
        /** The signer's ML-DSA-87 (Dilithium-5) keypair (registered + used for hybrid signing). */
        public PqcKeypair pqcKeypair;
        public StdFee fee;
        public String memo = "";
        public String chainId;
        public long accountNumber;
        public long sequence;
        public long timeoutHeight = 0L;
    }

    /** Options for {@link #ensurePqcRegistered}. */
    public static final class EnsureOptions {
        /**
         * The account's classical ECDSA (secp256k1) public key, registered alongside
         * the Dilithium key. When {@code null}, the signer's {@code secp256k1PublicKey}
         * is used; pass an explicit value to override.
         */
        public byte[] ecdsaPubkey;
        /** Key-type tag forwarded to {@code MsgRegisterPQCKey} (default {@link #DEFAULT_KEY_TYPE}). */
        public String keyType = DEFAULT_KEY_TYPE;
        /**
         * A pre-read status to avoid a redundant {@code qor_getPQCKeyStatus} round-trip.
         * When provided and {@code registered}, the registration is skipped.
         */
        public PqcStatus status;
    }

    /** Result of {@link #ensurePqcRegistered}. */
    public static final class EnsureResult {
        /** {@code true} when the key was already registered (no transaction was sent). */
        public final boolean alreadyRegistered;
        /** The registration transaction hash, when a registration was broadcast; else {@code null}. */
        public final String txHash;
        /** The raw broadcast result, when a registration was broadcast; else {@code null}. */
        public final Broadcaster.Result result;

        public EnsureResult(boolean alreadyRegistered, String txHash, Broadcaster.Result result) {
            this.alreadyRegistered = alreadyRegistered;
            this.txHash = txHash;
            this.result = result;
        }
    }

    // ---- Reads ----

    /**
     * Read the PQC registration status of an address via {@code qor_getPQCKeyStatus}.
     *
     * <p>The chain returns a rich JSON object; this normalizes the common fields
     * ({@code registered}, {@code algorithmId}/{@code algorithm_id},
     * {@code pubkey}/{@code public_key}) into a {@link PqcStatus}. Unknown shapes
     * degrade to {@code registered = false}.
     */
    public static PqcStatus getPqcStatus(QorClient qor, String address) {
        JsonNode raw = qor.getPqcKeyStatus(address);
        if (raw == null || !raw.isObject()) {
            return new PqcStatus(false, PqcAlgorithm.ALGORITHM_UNSPECIFIED, null);
        }
        boolean registered =
                asBool(firstOf(raw, "registered", "isRegistered", "is_registered"));
        int algorithmId = asInt(firstOf(raw, "algorithmId", "algorithm_id"));
        byte[] pubkey = asBytes(firstOf(raw, "pubkey", "publicKey", "public_key"));
        return new PqcStatus(registered, algorithmId, pubkey);
    }

    /**
     * Whether {@code address} has a registered PQC key.
     *
     * <p>Thin boolean wrapper over {@link #getPqcStatus} using
     * {@code qor_getPQCKeyStatus} (preferred). The EVM {@code pqcKeyStatus}
     * precompile is the documented alternative.
     */
    public static boolean isPqcRegistered(QorClient qor, String address) {
        return getPqcStatus(qor, address).registered;
    }

    // ---- Writes ----

    /**
     * Build the {@code MsgRegisterPQCKey} {@link TypedMessage} for a signer (no
     * broadcasting). Useful for packing registration into a larger transaction body.
     */
    public static TypedMessage buildRegisterPqcKeyMsg(Signer signer, EnsureOptions opts) {
        EnsureOptions o = opts != null ? opts : new EnsureOptions();
        byte[] ecdsaPubkey = o.ecdsaPubkey != null ? o.ecdsaPubkey : signer.secp256k1PublicKey;
        String keyType = o.keyType != null ? o.keyType : DEFAULT_KEY_TYPE;

        qorechain.pqc.v1.Tx.MsgRegisterPQCKey.Builder msg =
                qorechain.pqc.v1.Tx.MsgRegisterPQCKey.newBuilder()
                        .setSender(signer.sender == null ? "" : signer.sender)
                        .setDilithiumPubkey(
                                ByteString.copyFrom(signer.pqcKeypair.publicKey))
                        .setEcdsaPubkey(
                                ByteString.copyFrom(ecdsaPubkey == null ? new byte[0] : ecdsaPubkey))
                        .setKeyType(keyType);
        return QorechainMessages.pqc.registerPqcKey(msg.build());
    }

    /**
     * Register the signer's PQC key if it is not already registered — idempotent.
     *
     * <p>If {@code qor} is non-null (or a pre-read {@code opts.status} is supplied)
     * and the key is already registered, this returns
     * {@code EnsureResult{alreadyRegistered=true}} WITHOUT broadcasting. Otherwise
     * it builds, signs, and broadcasts {@code MsgRegisterPQCKey} with the signer's
     * Dilithium public key (from {@code signer.pqcKeypair}) plus the supplied (or
     * signer's) ECDSA public key.
     *
     * <p>This is the single call that makes a dApp quantum-safe: run it once at
     * startup (or before the first hybrid tx) and the account is PQC-protected.
     *
     * @param signer the signing context (keys, chain id, account, fee).
     * @param bc the consensus-RPC broadcaster.
     * @param qor optional status source for the idempotency pre-flight; when
     *     {@code null} and no {@code opts.status} is supplied, the registration is
     *     broadcast unconditionally.
     * @param opts ECDSA pubkey / key-type / pre-read status (may be {@code null}).
     */
    public static EnsureResult ensurePqcRegistered(
            Signer signer, Broadcaster bc, QorClient qor, EnsureOptions opts) {
        EnsureOptions o = opts != null ? opts : new EnsureOptions();

        // Pre-flight: skip registration entirely when already registered.
        PqcStatus status = o.status;
        if (status == null && qor != null) {
            status = getPqcStatus(qor, signer.sender);
        }
        if (status != null && status.registered) {
            return new EnsureResult(true, null, null);
        }

        TypedMessage message = buildRegisterPqcKeyMsg(signer, o);

        NativeTx.Options txOpts = new NativeTx.Options();
        txOpts.messages = List.of(message);
        txOpts.secp256k1PrivateKey = signer.secp256k1PrivateKey;
        txOpts.secp256k1PublicKey = signer.secp256k1PublicKey;
        txOpts.fee = signer.fee;
        txOpts.memo = signer.memo;
        txOpts.chainId = signer.chainId;
        txOpts.accountNumber = signer.accountNumber;
        txOpts.sequence = signer.sequence;
        txOpts.timeoutHeight = signer.timeoutHeight;

        NativeTx.Built built = NativeTx.buildAndSign(txOpts);
        Broadcaster.Result result = bc.broadcast(built.txRawBytes, Broadcaster.Mode.SYNC);
        return new EnsureResult(false, result.transactionHash, result);
    }

    /** Options for {@link #migratePqcKey} (PQC key rotation, {@code MsgMigratePQCKey}). */
    public static final class MigrateOptions {
        /** The current (old) PQC public key being rotated out. */
        public byte[] oldPublicKey;
        /** The new PQC public key to register. */
        public byte[] newPublicKey;
        /** The new key's algorithm id (default {@link PqcAlgorithm#ALGORITHM_DILITHIUM5}). */
        public int newAlgorithmId = PqcAlgorithm.ALGORITHM_DILITHIUM5;
        /** Signature by the OLD key proving ownership of the rotation request. */
        public byte[] oldSignature;
        /** Signature by the NEW key proving ownership of the new key. */
        public byte[] newSignature;
    }

    /** Build the {@code MsgMigratePQCKey} {@link TypedMessage} for a signer (no broadcasting). */
    public static TypedMessage buildMigratePqcKeyMsg(Signer signer, MigrateOptions opts) {
        qorechain.pqc.v1.Tx.MsgMigratePQCKey.Builder msg =
                qorechain.pqc.v1.Tx.MsgMigratePQCKey.newBuilder()
                        .setSender(signer.sender == null ? "" : signer.sender)
                        .setOldPublicKey(
                                ByteString.copyFrom(
                                        opts.oldPublicKey == null ? new byte[0] : opts.oldPublicKey))
                        .setNewPublicKey(
                                ByteString.copyFrom(
                                        opts.newPublicKey == null ? new byte[0] : opts.newPublicKey))
                        .setNewAlgorithmId(opts.newAlgorithmId)
                        .setOldSignature(
                                ByteString.copyFrom(
                                        opts.oldSignature == null ? new byte[0] : opts.oldSignature))
                        .setNewSignature(
                                ByteString.copyFrom(
                                        opts.newSignature == null ? new byte[0] : opts.newSignature));
        return QorechainMessages.pqc.migratePqcKey(msg.build());
    }

    /**
     * Rotate an account's PQC key via {@code MsgMigratePQCKey}.
     *
     * <p>The chain proves ownership of BOTH the old and new keys (the caller
     * supplies {@code oldSignature} / {@code newSignature} per the chain's
     * migration contract), so key rotation never strands an account. Use this when
     * upgrading algorithms or rolling a compromised key.
     */
    public static Broadcaster.Result migratePqcKey(
            Signer signer, Broadcaster bc, MigrateOptions opts) {
        TypedMessage message = buildMigratePqcKeyMsg(signer, opts);

        NativeTx.Options txOpts = new NativeTx.Options();
        txOpts.messages = List.of(message);
        txOpts.secp256k1PrivateKey = signer.secp256k1PrivateKey;
        txOpts.secp256k1PublicKey = signer.secp256k1PublicKey;
        txOpts.fee = signer.fee;
        txOpts.memo = signer.memo;
        txOpts.chainId = signer.chainId;
        txOpts.accountNumber = signer.accountNumber;
        txOpts.sequence = signer.sequence;
        txOpts.timeoutHeight = signer.timeoutHeight;

        NativeTx.Built built = NativeTx.buildAndSign(txOpts);
        return bc.broadcast(built.txRawBytes, Broadcaster.Mode.SYNC);
    }

    /**
     * A hybrid send path returned by {@link #migrateToHybrid}: the PQC key is
     * guaranteed registered, and {@link #send(List)} builds and broadcasts a hybrid
     * (classical secp256k1 + ML-DSA-87) transaction via {@link HybridTx}.
     *
     * <p>The signer (incl. its bound {@code pqcKeypair}) is captured, so callers
     * just pass the messages to send.
     */
    public static final class HybridSendPath {
        /** Whether the PQC key was already registered before this call. */
        public final boolean alreadyRegistered;
        /** The registration tx hash, when a registration was broadcast; else {@code null}. */
        public final String registrationTxHash;
        /** The bound ML-DSA-87 keypair used for the hybrid half. */
        public final PqcKeypair pqcKeypair;

        private final Signer signer;
        private final Broadcaster broadcaster;

        HybridSendPath(
                boolean alreadyRegistered,
                String registrationTxHash,
                Signer signer,
                Broadcaster broadcaster) {
            this.alreadyRegistered = alreadyRegistered;
            this.registrationTxHash = registrationTxHash;
            this.pqcKeypair = signer.pqcKeypair;
            this.signer = signer;
            this.broadcaster = broadcaster;
        }

        /** Build a fully signed hybrid tx for {@code messages} (PQC keypair pre-bound). */
        public HybridTx.Built buildHybridTx(List<TypedMessage> messages) {
            HybridTx.Options opts = new HybridTx.Options();
            opts.messages = messages;
            opts.secp256k1PrivateKey = signer.secp256k1PrivateKey;
            opts.secp256k1PublicKey = signer.secp256k1PublicKey;
            opts.pqcKeypair = signer.pqcKeypair;
            opts.fee = signer.fee;
            opts.memo = signer.memo;
            opts.chainId = signer.chainId;
            opts.accountNumber = signer.accountNumber;
            opts.sequence = signer.sequence;
            opts.timeoutHeight = signer.timeoutHeight;
            return HybridTx.buildHybridTx(opts);
        }

        /** Build, sign, and broadcast a hybrid tx for {@code messages} (SYNC mode). */
        public Broadcaster.Result send(List<TypedMessage> messages) {
            HybridTx.Built built = buildHybridTx(messages);
            return broadcaster.broadcast(built.txRawBytes, Broadcaster.Mode.SYNC);
        }
    }

    /**
     * Make an account quantum-safe and hand back a hybrid send path.
     *
     * <p>Ensures the signer's PQC key is registered (idempotent — see
     * {@link #ensurePqcRegistered}), then returns a {@link HybridSendPath} bound to
     * the signer's keypair and broadcaster. After this call, the dApp's
     * transactions can carry a verified hybrid signature via
     * {@link HybridSendPath#send(List)}.
     *
     * @param signer the signing context (incl. the bound {@code pqcKeypair}).
     * @param bc the consensus-RPC broadcaster.
     * @param qor optional status source for the registration pre-flight.
     * @param opts registration options (may be {@code null}).
     */
    public static HybridSendPath migrateToHybrid(
            Signer signer, Broadcaster bc, QorClient qor, EnsureOptions opts) {
        EnsureResult ensured = ensurePqcRegistered(signer, bc, qor, opts);
        return new HybridSendPath(
                ensured.alreadyRegistered, ensured.txHash, signer, bc);
    }

    // ---- JSON normalization helpers ----

    private static JsonNode firstOf(JsonNode obj, String... fields) {
        for (String f : fields) {
            JsonNode v = obj.get(f);
            if (v != null && !v.isNull()) {
                return v;
            }
        }
        return null;
    }

    /** Truthy-coerce a JSON value the chain may return as bool/number/string. */
    private static boolean asBool(JsonNode v) {
        if (v == null || v.isNull()) {
            return false;
        }
        if (v.isBoolean()) {
            return v.asBoolean();
        }
        if (v.isNumber()) {
            return v.asLong() != 0L;
        }
        if (v.isTextual()) {
            String s = v.asText();
            return s.equals("true") || s.equals("1");
        }
        return false;
    }

    /** Parse a numeric field the chain may return as number or string. */
    private static int asInt(JsonNode v) {
        if (v == null || v.isNull()) {
            return PqcAlgorithm.ALGORITHM_UNSPECIFIED;
        }
        if (v.isNumber()) {
            return v.asInt();
        }
        if (v.isTextual()) {
            String s = v.asText().trim();
            if (!s.isEmpty()) {
                try {
                    return Integer.parseInt(s);
                } catch (NumberFormatException ignored) {
                    return PqcAlgorithm.ALGORITHM_UNSPECIFIED;
                }
            }
        }
        return PqcAlgorithm.ALGORITHM_UNSPECIFIED;
    }

    /**
     * Decode a public-key field the chain may return as a hex string (0x-optional)
     * or a base64 string. Returns {@code null} when absent or undecodable.
     */
    private static byte[] asBytes(JsonNode v) {
        if (v == null || v.isNull() || !v.isTextual()) {
            return null;
        }
        String s = v.asText().trim();
        if (s.isEmpty()) {
            return null;
        }
        String hex = s.startsWith("0x") || s.startsWith("0X") ? s.substring(2) : s;
        if (hex.length() % 2 == 0 && hex.matches("[0-9a-fA-F]+")) {
            byte[] out = new byte[hex.length() / 2];
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            }
            return out;
        }
        try {
            return java.util.Base64.getDecoder().decode(s);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }
}
