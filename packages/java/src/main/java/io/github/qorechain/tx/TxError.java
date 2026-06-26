package io.github.qorechain.tx;

import java.util.HashMap;
import java.util.Map;

/**
 * ABCI transaction-error decoding, mirroring the Cosmos SDK's {@code sdk}
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

    private static final Map<Integer, String[]> SDK_CODES = new HashMap<>();

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

    /** Decode an ABCI error into a {@link QoreTxException}. */
    public static QoreTxException decode(int code, String codespace, String rawLog, String txHash) {
        String cs = (codespace == null || codespace.isEmpty()) ? "sdk" : codespace;
        String kind;
        String message;
        String[] known = "sdk".equals(cs) ? SDK_CODES.get(code) : null;
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
