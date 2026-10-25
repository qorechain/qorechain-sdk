package io.github.qorechain.tx;

import java.util.HashMap;
import java.util.Map;

/**
 * ABCI transaction-error decoding, mirroring QoreChain Native's {@code sdk}
 * codespace error codes. {@link #decode} turns a {@code (code, codespace,
 * rawLog)} triple into a {@link QoreTxException} with a stable {@code kind} and a
 * human message.
 */
public final class TxError {

    private TxError() {}

    /** A decoded transaction failure. */
    public static final class QoreTxException extends RuntimeException {
        public final int code;
        public final String codespace;
        public final String kind;
        public final String rawLog;
        public final String txHash;

        public QoreTxException(
                int code, String codespace, String kind, String rawLog, String txHash, String message) {
            super(message);
            this.code = code;
            this.codespace = codespace;
            this.kind = kind;
            this.rawLog = rawLog;
            this.txHash = txHash;
        }
    }

    /** The kind when the account has no registered PQC key (pqc 8, or pqc 20 from a keyless account). */
    public static final String PQC_KEY_REQUIRED = "pqc_key_required";

    /** The kind when a keyed account sent no hybrid extension (pqc 20). */
    public static final String HYBRID_SIGNATURE_REQUIRED = "hybrid_signature_required";

    /**
     * Tells pqc 8 / pqc 20 apart. pqc 8 is always an account without a PQC key
     * (classical fallback disabled). pqc 20 is either a keyless account or a keyed
     * account that sent no hybrid extension; only the text tells them apart.
     */
    static String pqcKeyRequirement(String codespace, int code, String rawLog) {
        if (!"pqc".equals(codespace) || (code != 8 && code != 20)) {
            return null;
        }
        String lower = rawLog == null ? "" : rawLog.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("has a registered pqc key and must include")) {
            return HYBRID_SIGNATURE_REQUIRED;
        }
        if (code == 8
                || lower.contains("has no registered pqc key")
                || lower.contains("has no pqc key")
                || lower.contains("must include a pqc hybrid signature extension")) {
            return PQC_KEY_REQUIRED;
        }
        return null;
    }

    /** The kind of a refusal from the per-sender transaction rate limit. */
    public static final String RATE_LIMITED = "rate_limited";

    /**
     * The per-sender rate limit (both lanes' ante handler): codespace {@code ai},
     * code 3, text "sender &lt;addr&gt; has sent &lt;n&gt; transactions in the last 30
     * blocks, at the configured limit of &lt;limit&gt; per minute". Code 3 also
     * carries other AI-engine rejections, so the text decides; a transport that
     * drops the codespace (EVM JSON-RPC) is matched on the text alone.
     */
    static boolean isRateLimitLog(String codespace, int code, String rawLog) {
        if (rawLog == null) {
            return false;
        }
        String lower = rawLog.toLowerCase(java.util.Locale.ROOT);
        if (!lower.contains("transactions in the last") || !lower.contains("per minute")) {
            return false;
        }
        return codespace == null || codespace.isEmpty() || ("ai".equals(codespace) && code == 3);
    }

    private static final Map<Integer, String[]> SDK_CODES = new HashMap<>();

    /** Per-codespace maps for QoreChain module errors (codespace → code → [kind, msg]). */
    private static final Map<String, Map<Integer, String[]>> MODULE_CODES = new HashMap<>();

    static {
        // ---- abstractaccount (v3.1.85 authenticator lanes) ----
        Map<Integer, String[]> aa = new HashMap<>();
        aa.put(5, new String[] {"spending_limit_exceeded", "authenticator spending limit exceeded"});
        aa.put(6, new String[] {"session_expired", "authenticator session expired"});
        aa.put(10, new String[] {"permission_denied", "authenticator permission denied"});
        // 11: the nonce is not the linked key's authenticator sequence (a per-key
        // counter, not the account's EVM nonce).
        aa.put(11, new String[] {"replay_detected", "authenticator nonce replay detected"});
        MODULE_CODES.put("abstractaccount", aa);

        // ---- pqc ----
        Map<Integer, String[]> pqc = new HashMap<>();
        pqc.put(21, new String[] {"pqc_signature_invalid", "invalid PQC signature"});
        // The EVM authorisation window (chain v3.2.0). Code 28 carries two states —
        // an unusable window and an account with no registered post-quantum key;
        // EvmWindowIssue.classify separates them on the message text.
        pqc.put(26, new String[] {"evm_window_missing", "no open EVM authorisation window"});
        pqc.put(27, new String[] {"evm_window_exhausted", "EVM authorisation window exhausted"});
        pqc.put(
                28,
                new String[] {
                    "evm_window_invalid",
                    "invalid EVM authorisation window, or no registered post-quantum key"
                });
        // EIP-7702 delegation consent (chain v3.2.2).
        pqc.put(
                60,
                new String[] {
                    "evm_delegation_no_consent", "no post-quantum consent for this EIP-7702 delegation"
                });
        pqc.put(61, new String[] {"evm_delegation_invalid", "invalid EIP-7702 delegation request"});
        // Registration integrity and key maintenance (chain v3.2.3).
        pqc.put(230, new String[] {"pqc_key_weak", "PQC public key gives no post-quantum protection"});
        pqc.put(231, new String[] {"pqc_proof_of_possession_invalid", "PQC proof of possession does not verify"});
        pqc.put(232, new String[] {"pqc_key_reused", "PQC key was used by this account before"});
        pqc.put(233, new String[] {"pqc_last_signature_algorithm", "no active PQC signature algorithm would remain"});
        pqc.put(
                234,
                new String[] {
                    "pqc_maintenance_needs_hybrid",
                    "PQC key maintenance from a keyed account needs the hybrid signature"
                        + " (PqcDx.migratePqcKeyHybrid)"
                });
        MODULE_CODES.put("pqc", pqc);

        // ---- stakingtier (chain v3.2.4) ----
        Map<Integer, String[]> st = new HashMap<>();
        st.put(2, new String[] {"stakingtier_invalid_params", "invalid staking-tier parameters"});
        st.put(3, new String[] {"stakingtier_not_active", "staking tiers are not active on this network yet"});
        st.put(4, new String[] {"stakingtier_disabled", "staking tiers are switched off by governance"});
        st.put(
                5,
                new String[] {
                    "stakingtier_invalid_term", "this lock term is not offered (see the module parameters)"
                });
        st.put(
                6,
                new String[] {
                    "stakingtier_invalid_amount", "invalid lock amount (below the minimum, or not positive)"
                });
        st.put(
                7,
                new String[] {
                    "stakingtier_insufficient_unlocked",
                    "not enough unlocked delegation to this validator to lock that amount"
                });
        st.put(8, new String[] {"stakingtier_lock_not_found", "lock not found"});
        st.put(9, new String[] {"stakingtier_not_lock_owner", "the lock belongs to another delegator"});
        st.put(
                10,
                new String[] {
                    "stakingtier_lock_expired", "the lock has already expired; nothing to unlock early"
                });
        st.put(11, new String[] {"stakingtier_too_many_locks", "too many open locks for this delegator"});
        st.put(12, new String[] {"stakingtier_nothing_to_claim", "no bonus to claim"});
        st.put(
                13,
                new String[] {
                    "stakingtier_stake_locked",
                    "this stake is locked; undelegating or redelegating it waits for the lock to end"
                });
        MODULE_CODES.put("stakingtier", st);
    }

    static {
        put(2, "tx_decode_error", "tx parse error");
        put(3, "invalid_sequence", "invalid sequence");
        put(4, "unauthorized", "unauthorized");
        put(5, "insufficient_funds", "insufficient funds");
        put(6, "unknown_request", "unknown request");
        put(7, "invalid_address", "invalid address");
        put(8, "invalid_pubkey", "invalid pubkey");
        put(9, "unknown_address", "unknown address");
        put(10, "invalid_coins", "invalid coins");
        put(11, "out_of_gas", "out of gas");
        put(12, "memo_too_large", "memo too large");
        put(13, "insufficient_fee", "insufficient fee");
        put(14, "maximum_signatures_exceeded", "maximum number of signatures exceeded");
        put(15, "no_signatures", "no signatures supplied");
        put(16, "json_marshal_error", "failed to marshal JSON bytes");
        put(17, "json_unmarshal_error", "failed to unmarshal JSON bytes");
        put(18, "invalid_request", "invalid request");
        put(19, "tx_in_mempool_cache", "tx already in mempool");
        put(20, "mempool_is_full", "mempool is full");
        put(21, "tx_too_large", "tx too large");
        put(25, "invalid_gas_limit", "invalid gas limit");
        put(30, "tx_timeout_height", "tx timeout height");
    }

    private static void put(int code, String kind, String msg) {
        SDK_CODES.put(code, new String[] {kind, msg});
    }

    /** One of the chain's registered error descriptions. */
    public record RegisteredError(String codespace, int code, String description) {}

    /**
     * The chain's registered error descriptions, for refusals that arrive as text
     * only: a failed simulation reports the module's message but no code. Kept to
     * the codespaces this class decodes; the same table as the TypeScript SDK.
     */
    public static final java.util.List<RegisteredError> REGISTERED_ERRORS = java.util.List.of(
            new RegisteredError("sdk", 4, "unauthorized"),
            new RegisteredError("sdk", 5, "insufficient funds"),
            new RegisteredError("sdk", 11, "out of gas"),
            new RegisteredError("sdk", 13, "insufficient fee"),
            new RegisteredError("sdk", 19, "tx already in mempool"),
            new RegisteredError("sdk", 32, "incorrect account sequence"),
            new RegisteredError("pqc", 2, "PQC signature verification failed"),
            new RegisteredError("pqc", 6, "PQC account not found"),
            new RegisteredError("pqc", 7, "PQC account already registered"),
            new RegisteredError("pqc", 8, "classical fallback not allowed"),
            new RegisteredError("pqc", 20, "hybrid PQC signature required"),
            new RegisteredError("pqc", 21, "hybrid PQC signature verification failed"),
            new RegisteredError("pqc", 26, "no open EVM authorisation window"),
            new RegisteredError("pqc", 27, "EVM authorisation window exhausted"),
            new RegisteredError("pqc", 28, "invalid EVM authorisation window"),
            new RegisteredError("pqc", 45, "ecdsa_pubkey is not the signer's compressed secp256k1 key"),
            new RegisteredError("pqc", 60, "no post-quantum consent for this EIP-7702 delegation"),
            new RegisteredError("pqc", 61, "invalid EIP-7702 delegation request"),
            new RegisteredError("pqc", 231, "PQC proof of possession does not verify"),
            new RegisteredError("abstractaccount", 2, "abstract account not found"),
            new RegisteredError("abstractaccount", 5, "spending limit exceeded"),
            new RegisteredError("abstractaccount", 6, "session key expired"),
            new RegisteredError("abstractaccount", 8, "invalid spending rule"),
            new RegisteredError("abstractaccount", 10, "authenticator not permitted for this action"),
            new RegisteredError("abstractaccount", 11, "authenticator signature replay binding mismatch"),
            new RegisteredError("stakingtier", 3, "staking tiers are not active on this chain yet"),
            new RegisteredError("stakingtier", 4, "staking tiers are disabled by governance"),
            new RegisteredError("stakingtier", 5, "lock term is not offered"),
            new RegisteredError("stakingtier", 6, "invalid lock amount"),
            new RegisteredError("stakingtier", 7, "not enough unlocked delegation"),
            new RegisteredError("stakingtier", 8, "lock not found"),
            new RegisteredError("stakingtier", 9, "lock belongs to another delegator"),
            new RegisteredError("stakingtier", 10, "lock has already expired"),
            new RegisteredError("stakingtier", 11, "too many open locks"),
            new RegisteredError("stakingtier", 12, "no bonus to claim"),
            new RegisteredError("stakingtier", 13, "stake is locked"));

    /**
     * The registered error a text-only refusal names: the longest description in
     * {@link #REGISTERED_ERRORS} that {@code text} contains (so "hybrid PQC
     * signature verification failed" is pqc 21, not pqc 2), or {@code null}.
     */
    public static RegisteredError errorFromText(String text) {
        if (text == null || text.isEmpty()) {
            return null;
        }
        RegisteredError best = null;
        for (RegisteredError e : REGISTERED_ERRORS) {
            if (text.contains(e.description())
                    && (best == null || e.description().length() > best.description().length())) {
                best = e;
            }
        }
        return best;
    }

    /**
     * Decode an ABCI error into a {@link QoreTxException}.
     *
     * <p>A refusal that arrives as text only (no positive {@code code}), such as a
     * failed simulation, is named from {@link #REGISTERED_ERRORS} (longest match
     * wins) and decoded as that codespace and code: pass {@code 0} and the text.
     */
    public static QoreTxException decode(int code, String codespace, String rawLog, String txHash) {
        // A refusal without a code (a failed simulation): name it from the text.
        if (code <= 0) {
            RegisteredError named = errorFromText(rawLog);
            if (named != null) {
                return decode(named.code(), named.codespace(), rawLog, txHash);
            }
        }
        String cs = (codespace == null || codespace.isEmpty()) ? "sdk" : codespace;
        String kind;
        String message;
        String[] known;
        String keyRequirement = pqcKeyRequirement(codespace, code, rawLog);
        if (keyRequirement != null) {
            known = new String[] {
                keyRequirement,
                PQC_KEY_REQUIRED.equals(keyRequirement)
                        ? "this account has no registered PQC key — register one (MsgRegisterPQCKeyV2) before sending"
                        : "this account has a registered PQC key — sign the transaction with the hybrid"
                                + " (ML-DSA-87) extension"
            };
        } else if (isRateLimitLog(codespace, code, rawLog)) {
            known = new String[] {RATE_LIMITED, "the network is limiting this sender's transaction rate"};
        } else if ("sdk".equals(cs)) {
            known = SDK_CODES.get(code);
        } else {
            Map<Integer, String[]> module = MODULE_CODES.get(cs);
            known = module != null ? module.get(code) : null;
        }
        if (known != null) {
            kind = known[0];
            message = known[1];
            if (rawLog != null && !rawLog.isEmpty()) {
                message = message + " (" + rawLog + ")";
            }
        } else {
            kind = cs + "_" + code;
            message =
                    "transaction failed in module \""
                            + cs
                            + "\" with code "
                            + code
                            + ": "
                            + (rawLog == null || rawLog.isEmpty() ? "(no log provided)" : rawLog);
        }
        String full = (txHash == null || txHash.isEmpty()) ? message : message + " (tx " + txHash + ")";
        return new QoreTxException(code, cs, kind, rawLog, txHash, full);
    }
}
