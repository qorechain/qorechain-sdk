package io.github.qorechain.tx;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Per-network post-quantum sign-bytes: the exact byte strings an ML-DSA-87 key
 * signs for a hybrid transaction, a PQC key migration, and a bridge attestation.
 *
 * <p>Each network verifies exactly ONE form at any height, never both:
 *
 * <ul>
 *   <li><b>v1</b> — the original forms. Verified by networks that have applied none
 *       of the {@link #SIGN_BYTES_V2_UPGRADES} plans (today: mainnet
 *       {@code qorechain-vladi}).
 *   <li><b>v2</b> — domain-tagged and chain-id-bound. Verified once one of those plans
 *       is applied (today: testnet {@code qorechain-diana}, which applied
 *       {@code v3.1.98} at height 5,746,000) and by every network born on that release
 *       or later.
 * </ul>
 *
 * <p>The switch ships under TWO plan names, {@code v3.2.0} (mainnet) and
 * {@code v3.1.98} (already applied on the testnet), both in
 * {@link #SIGN_BYTES_V2_UPGRADES}. A client must ask the network about every one of
 * them; asking a single name resolves v1 on the other network and every hybrid
 * transaction there is refused with {@code pqc} code 21.
 *
 * <p>Byte layouts (all lengths big-endian, strings UTF-8, no terminators):
 *
 * <pre>
 *   hybrid v1    = BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
 *   hybrid v2    = "qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖
 *                  BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
 *   migration v1 = "qorechain-key-migration:chain=%s:from=%d:to=%d:account=%s:height=%d"
 *   migration v2 = "qorechain-key-migration-v2" ‖ BE64(len chainId) ‖ chainId ‖
 *                  BE64(len account) ‖ account ‖ BE32(from) ‖ BE32(to) ‖ BE64(height) ‖
 *                  BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub
 *   bridge v1    = chain|eventType|operationId|txHash|amount|asset   (no chain id)
 *   bridge v2    = "qorechain-bridge-attestation-v2" ‖ for f in
 *                  [chainId, chain, eventType, operationId, txHash, amount, asset]:
 *                  BE64(len f) ‖ f
 * </pre>
 *
 * <p>Which form to sign is decided by {@link #versionFor} (pure) or, with a network
 * lookup, by {@link SignBytesResolver}. Everything in this class is pure.
 */
public final class SignBytes {

    private SignBytes() {}

    /** Domain tag of the v2 hybrid transaction sign-bytes. */
    public static final String HYBRID_DOMAIN = "qorechain-pqc-hybrid-v2";

    /** Domain tag of the v2 key-migration sign-bytes. */
    public static final String MIGRATION_DOMAIN = "qorechain-key-migration-v2";

    /** Domain tag of the v2 bridge-attestation sign-bytes. */
    public static final String BRIDGE_DOMAIN = "qorechain-bridge-attestation-v2";

    /**
     * The PRIMARY name of the coordinated upgrade whose handler switches a pre-existing
     * network to v2 — the name mainnet ({@code qorechain-vladi}) applies.
     *
     * <p>It is <b>not</b> the only one. A client must ask the network about every name
     * in {@link #SIGN_BYTES_V2_UPGRADES}, never this one alone: the testnet took the
     * same batch under the earlier name {@code v3.1.98} and keeps that record forever,
     * so a single-name lookup answers "not applied" on one of the two networks and
     * resolves v1 there — the form it refuses with {@code pqc} code 21.
     */
    public static final String SIGN_BYTES_V2_UPGRADE = "v3.2.0";

    /**
     * Every upgrade plan name whose application switches a legacy network from v1 to
     * v2, most likely first.
     *
     * <p>The chain registers ONE handler under all of these names (qorechain-core
     * {@code x/pqc/types.SignBytesV2Upgrades}): mainnet applies {@code v3.2.0}, while
     * the testnet already applied {@code v3.1.98} and keeps answering under it. A
     * resolver queries {@code /cosmos/upgrade/v1beta1/applied_plan/{name}} for each
     * name in this order and takes v2 as soon as one answers a height greater than
     * zero.
     */
    public static final List<String> SIGN_BYTES_V2_UPGRADES = List.of("v3.2.0", "v3.1.98");

    /**
     * Networks that were running before v2 existed; they switch to v2 only once one of
     * {@link #SIGN_BYTES_V2_UPGRADES} is applied. Any other chain id is v2 from its
     * first block.
     */
    public static final Set<String> LEGACY_CHAINS = Set.of("qorechain-vladi", "qorechain-diana");

    /** The pqc codespace error code for a refused hybrid signature. */
    public static final int PQC_HYBRID_VERIFY_FAILED_CODE = 21;

    /** The chain's log text for a refused hybrid signature. */
    public static final String PQC_HYBRID_VERIFY_FAILED_LOG =
            "hybrid PQC signature verification failed";

    /** A resolved sign-bytes form. */
    public enum Version {
        V1(1),
        V2(2);

        private final int number;

        Version(int number) {
            this.number = number;
        }

        /** 1 or 2. */
        public int number() {
            return number;
        }

        /** {@code "v1"} or {@code "v2"}. */
        public String wireName() {
            return "v" + number;
        }
    }

    /**
     * A caller's choice: {@link #AUTO} asks the network (via
     * {@link SignBytesResolver}); {@link #V1}/{@link #V2} force a form with no network
     * call.
     */
    public enum Mode {
        AUTO,
        V1,
        V2;

        /** Parse {@code "auto"}, {@code "v1"} or {@code "v2"} (case-insensitive; null/empty = AUTO). */
        public static Mode parse(String s) {
            if (s == null || s.isEmpty()) {
                return AUTO;
            }
            switch (s.toLowerCase(Locale.ROOT)) {
                case "auto":
                    return AUTO;
                case "v1":
                    return V1;
                case "v2":
                    return V2;
                default:
                    throw new IllegalArgumentException(
                            "sign-bytes mode must be auto, v1 or v2, got \"" + s + "\"");
            }
        }

        /** The explicit version for V1/V2, or {@code null} for AUTO. */
        public Version explicitVersion() {
            switch (this) {
                case V1:
                    return Version.V1;
                case V2:
                    return Version.V2;
                default:
                    return null;
            }
        }
    }

    // ---- version selection ----

    /** Whether {@code chainId} is one of the pre-v2 networks in {@link #LEGACY_CHAINS}. */
    public static boolean isLegacyChain(String chainId) {
        return chainId != null && LEGACY_CHAINS.contains(chainId);
    }

    /**
     * The form a client must sign for {@code chainId}, given the height at which one
     * of {@link #SIGN_BYTES_V2_UPGRADES} was applied on that chain — the greatest
     * height any of the names answered, 0 when none has been applied. Mirrors the
     * chain's {@code SignBytesVersionFor} exactly: v2 when the height is positive OR
     * the chain is not a legacy network; v1 otherwise.
     */
    public static Version versionFor(String chainId, long v2AppliedHeight) {
        if (v2AppliedHeight > 0 || !isLegacyChain(chainId)) {
            return Version.V2;
        }
        return Version.V1;
    }

    /**
     * The version a pure (synchronous, network-free) builder must use.
     *
     * <p>An explicit {@code version} is returned as-is. When it is {@code null}, a
     * non-legacy chain is unambiguously v2; a legacy chain ({@code qorechain-vladi},
     * {@code qorechain-diana}) cannot be decided without asking the network, so this
     * throws rather than guessing.
     *
     * @throws IllegalStateException for a legacy chain with no explicit version.
     */
    public static Version requireVersion(String chainId, Version version) {
        if (version != null) {
            return version;
        }
        if (!isLegacyChain(chainId)) {
            return Version.V2;
        }
        throw new IllegalStateException(
                "hybrid sign-bytes version is required for chain \""
                        + chainId
                        + "\": it signs v1 until one of the "
                        + upgradeNames()
                        + " upgrades is applied and v2 after. Pass an explicit"
                        + " signBytesVersion (V1/V2), or resolve it with SignBytesResolver"
                        + " against the network's REST endpoint.");
    }

    /** {@link #SIGN_BYTES_V2_UPGRADES} rendered for an error message ("v3.2.0 / v3.1.98"). */
    static String upgradeNames() {
        return String.join(" / ", SIGN_BYTES_V2_UPGRADES);
    }

    // ---- hybrid ----

    /** Hybrid v1: {@code BE32(len b0) ‖ b0 ‖ BE32(len authInfo) ‖ authInfo}. */
    public static byte[] hybridV1(byte[] b0, byte[] authInfo) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(8 + b0.length + authInfo.length);
        out.writeBytes(be32(b0.length));
        out.writeBytes(b0);
        out.writeBytes(be32(authInfo.length));
        out.writeBytes(authInfo);
        return out.toByteArray();
    }

    /**
     * Hybrid v2: {@code "qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖
     * BE32(len b0) ‖ b0 ‖ BE32(len authInfo) ‖ authInfo}.
     */
    public static byte[] hybridV2(String chainId, byte[] b0, byte[] authInfo) {
        requireChainId(chainId);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(utf8(HYBRID_DOMAIN));
        writeBe64Prefixed(out, utf8(chainId));
        out.writeBytes(be32(b0.length));
        out.writeBytes(b0);
        out.writeBytes(be32(authInfo.length));
        out.writeBytes(authInfo);
        return out.toByteArray();
    }

    /** Hybrid sign-bytes in the given form ({@code chainId} is ignored by v1). */
    public static byte[] hybrid(Version version, String chainId, byte[] b0, byte[] authInfo) {
        if (version == null) {
            throw new IllegalArgumentException("sign-bytes version is required");
        }
        return version == Version.V2 ? hybridV2(chainId, b0, authInfo) : hybridV1(b0, authInfo);
    }

    // ---- key migration ----

    /**
     * Migration v1 (legacy ASCII):
     * {@code qorechain-key-migration:chain=%s:from=%d:to=%d:account=%s:height=%d}.
     * Algorithm ids are formatted unsigned (they are {@code uint32} on chain).
     */
    public static byte[] migrationV1(
            String chainId, String account, int fromAlgorithmId, int toAlgorithmId, long height) {
        return utf8(
                "qorechain-key-migration:chain="
                        + chainId
                        + ":from="
                        + Integer.toUnsignedString(fromAlgorithmId)
                        + ":to="
                        + Integer.toUnsignedString(toAlgorithmId)
                        + ":account="
                        + account
                        + ":height="
                        + height);
    }

    /** Migration v2 (see the class header for the layout). */
    public static byte[] migrationV2(
            String chainId,
            String account,
            int fromAlgorithmId,
            int toAlgorithmId,
            long height,
            byte[] oldPublicKey,
            byte[] newPublicKey) {
        requireChainId(chainId);
        byte[] oldPub = oldPublicKey == null ? new byte[0] : oldPublicKey;
        byte[] newPub = newPublicKey == null ? new byte[0] : newPublicKey;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(utf8(MIGRATION_DOMAIN));
        writeBe64Prefixed(out, utf8(chainId));
        writeBe64Prefixed(out, utf8(account));
        out.writeBytes(be32(fromAlgorithmId));
        out.writeBytes(be32(toAlgorithmId));
        out.writeBytes(be64(height));
        out.writeBytes(be32(oldPub.length));
        out.writeBytes(oldPub);
        out.writeBytes(be32(newPub.length));
        out.writeBytes(newPub);
        return out.toByteArray();
    }

    /** Migration sign-bytes in the given form (v1 ignores the public keys). */
    public static byte[] migration(
            Version version,
            String chainId,
            String account,
            int fromAlgorithmId,
            int toAlgorithmId,
            long height,
            byte[] oldPublicKey,
            byte[] newPublicKey) {
        if (version == null) {
            throw new IllegalArgumentException("sign-bytes version is required");
        }
        return version == Version.V2
                ? migrationV2(
                        chainId,
                        account,
                        fromAlgorithmId,
                        toAlgorithmId,
                        height,
                        oldPublicKey,
                        newPublicKey)
                : migrationV1(chainId, account, fromAlgorithmId, toAlgorithmId, height);
    }

    // ---- bridge attestation ----

    /**
     * Bridge attestation v1 (legacy ASCII, no chain id):
     * {@code chain|eventType|operationId|txHash|amount|asset}. {@code amount} is the
     * decimal integer string.
     */
    public static byte[] bridgeV1(
            String chain,
            String eventType,
            String operationId,
            String txHash,
            String amount,
            String asset) {
        return utf8(
                String.join("|", chain, eventType, operationId, txHash, amount, asset));
    }

    /** Bridge attestation v2 (see the class header for the layout). */
    public static byte[] bridgeV2(
            String chainId,
            String chain,
            String eventType,
            String operationId,
            String txHash,
            String amount,
            String asset) {
        requireChainId(chainId);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(utf8(BRIDGE_DOMAIN));
        for (String f : new String[] {chainId, chain, eventType, operationId, txHash, amount, asset}) {
            writeBe64Prefixed(out, utf8(f));
        }
        return out.toByteArray();
    }

    /** Bridge attestation sign-bytes in the given form (v1 ignores {@code chainId}). */
    public static byte[] bridge(
            Version version,
            String chainId,
            String chain,
            String eventType,
            String operationId,
            String txHash,
            String amount,
            String asset) {
        if (version == null) {
            throw new IllegalArgumentException("sign-bytes version is required");
        }
        return version == Version.V2
                ? bridgeV2(chainId, chain, eventType, operationId, txHash, amount, asset)
                : bridgeV1(chain, eventType, operationId, txHash, amount, asset);
    }

    // ---- rejection detection ----

    /**
     * Whether a broadcast refusal is the chain rejecting the hybrid PQC signature —
     * the symptom of signing the wrong sign-bytes form. True when
     * {@code codespace == "pqc" && code == 21}, or when the log/message contains
     * {@value #PQC_HYBRID_VERIFY_FAILED_LOG}. Code 21 in any other codespace is NOT
     * this case.
     */
    public static boolean isHybridVerifyRejection(int code, String codespace, String log) {
        if ("pqc".equals(codespace) && code == PQC_HYBRID_VERIFY_FAILED_CODE) {
            return true;
        }
        return log != null && log.contains(PQC_HYBRID_VERIFY_FAILED_LOG);
    }

    /** {@link #isHybridVerifyRejection(int, String, String)} over a thrown broadcast error. */
    public static boolean isHybridVerifyRejection(Throwable error) {
        if (error instanceof TxError.QoreTxException) {
            TxError.QoreTxException e = (TxError.QoreTxException) error;
            if (isHybridVerifyRejection(e.code, e.codespace, e.rawLog)) {
                return true;
            }
        }
        return error != null
                && error.getMessage() != null
                && error.getMessage().contains(PQC_HYBRID_VERIFY_FAILED_LOG);
    }

    // ---- encoding helpers ----

    /** Big-endian 4-byte encoding of {@code n} (as an unsigned 32-bit value). */
    public static byte[] be32(int n) {
        return new byte[] {
            (byte) (n >>> 24), (byte) (n >>> 16), (byte) (n >>> 8), (byte) n
        };
    }

    /** Big-endian 8-byte encoding of {@code n}. */
    public static byte[] be64(long n) {
        byte[] out = new byte[8];
        for (int i = 7; i >= 0; i--) {
            out[i] = (byte) n;
            n >>>= 8;
        }
        return out;
    }

    private static void writeBe64Prefixed(ByteArrayOutputStream out, byte[] field) {
        out.writeBytes(be64(field.length));
        out.writeBytes(field);
    }

    private static byte[] utf8(String s) {
        return (s == null ? "" : s).getBytes(StandardCharsets.UTF_8);
    }

    private static void requireChainId(String chainId) {
        if (chainId == null) {
            throw new IllegalArgumentException("chainId is required for v2 sign-bytes");
        }
    }
}
