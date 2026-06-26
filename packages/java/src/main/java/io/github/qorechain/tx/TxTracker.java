package io.github.qorechain.tx;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.RestClient;

/**
 * Polls for a broadcast transaction's inclusion in a block, with a timeout, and a
 * small generic retry helper.
 */
public final class TxTracker {

    private TxTracker() {}

    /** An included transaction. */
    public static final class IncludedTx {
        public final String txHash;
        public final long height;
        public final int code;
        public final String rawLog;

        public IncludedTx(String txHash, long height, int code, String rawLog) {
            this.txHash = txHash;
            this.height = height;
            this.code = code;
            this.rawLog = rawLog;
        }
    }

    /** Options for {@link #waitForTx}. */
    public static final class WaitOptions {
        public long timeoutMs = 60000;
        public long pollIntervalMs = 2000;
    }

    /**
     * Poll {@code GET /cosmos/tx/v1beta1/txs/{hash}} until the tx is found (and
     * has a delivery code), throwing on timeout or a non-zero code.
     */
    public static IncludedTx waitForTx(RestClient rest, String txHash, WaitOptions opts) {
        long deadline = System.currentTimeMillis() + opts.timeoutMs;
        while (true) {
            JsonNode found = null;
            try {
                JsonNode res = rest.getTx(txHash);
                found = (res == null) ? null : res.get("tx_response");
            } catch (RuntimeException e) {
                // 404 / not-found: tx not in a block yet. Keep polling.
                if (!isNotFound(e)) {
                    throw e;
                }
            }
            if (found != null && !found.isNull()) {
                int code = found.has("code") ? found.get("code").asInt() : 0;
                String rawLog = found.has("raw_log") ? found.get("raw_log").asText() : null;
                long height = found.has("height") ? found.get("height").asLong() : 0L;
                if (code != 0) {
                    throw TxError.decode(code, found.path("codespace").asText(""), rawLog, txHash);
                }
                return new IncludedTx(txHash, height, code, rawLog);
            }
            if (System.currentTimeMillis() + opts.pollIntervalMs > deadline) {
                throw new IllegalStateException(
                        "timed out waiting for tx " + txHash + " after " + opts.timeoutMs + "ms");
            }
            sleep(opts.pollIntervalMs);
        }
    }

    private static boolean isNotFound(RuntimeException e) {
        String msg = e.getMessage();
        if (msg == null) {
            return false;
        }
        String l = msg.toLowerCase();
        return l.contains("404") || l.contains("not found") || l.contains("tx not found");
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Run {@code action} with exponential-backoff retries. */
    public static <T> T withRetry(java.util.function.Supplier<T> action, int retries, long backoffMs) {
        RuntimeException last = null;
        for (int attempt = 0; attempt <= retries; attempt++) {
            try {
                return action.get();
            } catch (RuntimeException e) {
                last = e;
                if (attempt < retries) {
                    sleep(Math.min(backoffMs * (1L << attempt), 5000));
                }
            }
        }
        throw last;
    }
}
