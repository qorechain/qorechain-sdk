package io.github.qorechain.evm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import qorechain.pqc.v1.QueryOuterClass;

/**
 * The decoded answer of {@code GET {rest}/qorechain/pqc/v1/evm_window/{address}}
 * — one account's EVM authorisation window (chain v3.2.0).
 *
 * <p>The route answers 200 with {@code found:false} when the account has no
 * window, so it is safe to poll. A stored window may still be expired or
 * exhausted: {@link #live} reports whether it admits at least one more
 * zero-value transaction at the current height.
 *
 * <p>All numbers arrive as JSON strings. The counters are {@code long} and the
 * three value fields are {@link BigInteger} uqor amounts ({@code cosmos.Int}) —
 * never {@code double}, which silently truncates above 2^53. When a field is
 * absent (the {@code found:false} shape) the value fields decode to zero.
 */
public final class EvmWindowStatus {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Whether a window is stored for the account. */
    public final boolean found;
    /** Whether the stored window still admits a transaction now. */
    public final boolean live;
    /** The height the window was opened at. */
    public final long openedHeight;
    /** The height the window stops admitting transactions at. */
    public final long expiryHeight;
    /** The transaction count the window was opened with. */
    public final long maxTxs;
    /** How many transactions it has admitted. */
    public final long usedTxs;
    /** The uqor bound (value + maximum fee of every admitted transaction). */
    public final BigInteger maxValue;
    /** The uqor already consumed against {@link #maxValue}. */
    public final BigInteger usedValue;
    /** Blocks left before expiry. */
    public final long remainingBlocks;
    /** Transactions left. */
    public final long remainingTxs;
    /** uqor left. */
    public final BigInteger remainingValue;

    public EvmWindowStatus(
            boolean found,
            boolean live,
            long openedHeight,
            long expiryHeight,
            long maxTxs,
            long usedTxs,
            BigInteger maxValue,
            BigInteger usedValue,
            long remainingBlocks,
            long remainingTxs,
            BigInteger remainingValue) {
        this.found = found;
        this.live = live;
        this.openedHeight = openedHeight;
        this.expiryHeight = expiryHeight;
        this.maxTxs = maxTxs;
        this.usedTxs = usedTxs;
        this.maxValue = maxValue;
        this.usedValue = usedValue;
        this.remainingBlocks = remainingBlocks;
        this.remainingTxs = remainingTxs;
        this.remainingValue = remainingValue;
    }

    /**
     * Whether a found window has run out of transactions, value or blocks. False
     * when no window is stored at all — that is "no window", a different state
     * with a different remedy (open one).
     */
    public boolean exhausted() {
        return found && !live;
    }

    /** Decode the REST body, in either shape, with the numbers kept exact. */
    public static EvmWindowStatus of(JsonNode node) {
        if (node == null || node.isNull()) {
            throw new IllegalArgumentException("evm_window: empty response");
        }
        return new EvmWindowStatus(
                bool(node, "found"),
                bool(node, "live"),
                number(node, "opened_height"),
                number(node, "expiry_height"),
                number(node, "max_txs"),
                number(node, "used_txs"),
                amount(node, "max_value"),
                amount(node, "used_value"),
                number(node, "remaining_blocks"),
                number(node, "remaining_txs"),
                amount(node, "remaining_value"));
    }

    /** Decode a REST body supplied as a JSON string. */
    public static EvmWindowStatus parse(String json) {
        try {
            return of(MAPPER.readTree(json));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalArgumentException("evm_window: decoding response: " + e.getMessage(), e);
        }
    }

    /** Adapt the protobuf answer of {@code Query/EVMWindow} (gRPC / ABCI lane). */
    public static EvmWindowStatus of(QueryOuterClass.QueryEVMWindowResponse res) {
        return new EvmWindowStatus(
                res.getFound(),
                res.getLive(),
                res.getOpenedHeight(),
                res.getExpiryHeight(),
                res.getMaxTxs(),
                res.getUsedTxs(),
                bigInteger("max_value", res.getMaxValue()),
                bigInteger("used_value", res.getUsedValue()),
                res.getRemainingBlocks(),
                res.getRemainingTxs(),
                bigInteger("remaining_value", res.getRemainingValue()));
    }

    /** Reads a field spelled as a JSON string or as a bare token. */
    private static String scalar(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            return "";
        }
        return v.asText().trim();
    }

    private static boolean bool(JsonNode node, String field) {
        String s = scalar(node, field);
        switch (s) {
            case "":
            case "false":
                return false;
            case "true":
                return true;
            default:
                throw new IllegalArgumentException(
                        "evm_window: field " + field + " is not a boolean: \"" + s + "\"");
        }
    }

    private static long number(JsonNode node, String field) {
        String s = scalar(node, field);
        if (s.isEmpty()) {
            return 0L;
        }
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "evm_window: field " + field + " is not an integer: \"" + s + "\"");
        }
    }

    private static BigInteger amount(JsonNode node, String field) {
        String s = scalar(node, field);
        if (s.isEmpty()) {
            return BigInteger.ZERO;
        }
        return bigInteger(field, s);
    }

    private static BigInteger bigInteger(String field, String s) {
        if (s == null || s.isEmpty()) {
            return BigInteger.ZERO;
        }
        try {
            return new BigInteger(s.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "evm_window: field "
                            + field
                            + " is not an integer amount of uqor: \""
                            + s
                            + "\"");
        }
    }

    @Override
    public String toString() {
        if (!found) {
            return "EvmWindowStatus{found=false}";
        }
        return "EvmWindowStatus{found=true, live="
                + live
                + ", expiryHeight="
                + expiryHeight
                + ", remainingBlocks="
                + remainingBlocks
                + ", remainingTxs="
                + remainingTxs
                + ", remainingValue="
                + remainingValue
                + "uqor}";
    }
}
