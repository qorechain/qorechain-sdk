package io.github.qorechain.tx;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.qorechain.query.Http;
import io.github.qorechain.query.JsonRpcClient;
import java.util.Base64;
import java.util.List;

/**
 * Broadcasts signed {@code TxRaw} bytes via the consensus RPC endpoint's
 * {@code broadcast_tx_*} JSON-RPC methods.
 *
 * <ul>
 *   <li>{@code sync} — submit and return after CheckTx (returns the tx hash).
 *   <li>{@code async} — submit and return immediately.
 *   <li>{@code commit} — submit and wait for the tx to land in a block; throws
 *       on a non-zero delivery code.
 * </ul>
 */
public final class Broadcaster {

    /** Broadcast mode. */
    public enum Mode {
        SYNC,
        ASYNC,
        COMMIT
    }

    /** The result of a broadcast. */
    public static final class Result {
        public final String transactionHash;
        public final int code;
        public Long height;
        public String rawLog;

        public Result(String transactionHash, int code) {
            this.transactionHash = transactionHash;
            this.code = code;
        }
    }

    private final JsonRpcClient rpc;

    /** @param rpcUrl the consensus RPC endpoint (e.g. {@code http://localhost:26657}). */
    public Broadcaster(String rpcUrl) {
        this.rpc = new JsonRpcClient(rpcUrl);
    }

    public Broadcaster(String rpcUrl, Http.Options options) {
        this.rpc = new JsonRpcClient(rpcUrl, options);
    }

    /** Broadcast {@code txRawBytes} in the given mode. */
    public Result broadcast(byte[] txRawBytes, Mode mode) {
        String txB64 = Base64.getEncoder().encodeToString(txRawBytes);
        switch (mode) {
            case ASYNC: {
                JsonNode res = rpc.call("broadcast_tx_async", List.of(txB64));
                return resultFromCheck(res);
            }
            case COMMIT: {
                JsonNode res = rpc.call("broadcast_tx_commit", List.of(txB64));
                return resultFromCommit(res);
            }
            case SYNC:
            default: {
                JsonNode res = rpc.call("broadcast_tx_sync", List.of(txB64));
                Result r = resultFromCheck(res);
                if (r.code != 0) {
                    throw TxError.decode(r.code, codespace(res), r.rawLog, r.transactionHash);
                }
                return r;
            }
        }
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = (n == null) ? null : n.get(field);
        return (v == null || v.isNull()) ? null : v.asText();
    }

    private static int intOf(JsonNode n, String field) {
        JsonNode v = (n == null) ? null : n.get(field);
        return (v == null || v.isNull()) ? 0 : v.asInt();
    }

    private Result resultFromCheck(JsonNode res) {
        Result r = new Result(text(res, "hash"), intOf(res, "code"));
        r.rawLog = text(res, "log");
        return r;
    }

    private String codespace(JsonNode res) {
        return text(res, "codespace");
    }

    private Result resultFromCommit(JsonNode res) {
        String hash = text(res, "hash");
        JsonNode checkTx = res == null ? null : res.get("check_tx");
        JsonNode deliverTx = res == null ? null : res.get("deliver_tx");
        int checkCode = intOf(checkTx, "code");
        if (checkCode != 0) {
            throw TxError.decode(checkCode, text(checkTx, "codespace"), text(checkTx, "log"), hash);
        }
        int deliverCode = intOf(deliverTx, "code");
        if (deliverCode != 0) {
            throw TxError.decode(
                    deliverCode, text(deliverTx, "codespace"), text(deliverTx, "log"), hash);
        }
        Result r = new Result(hash, 0);
        JsonNode height = res == null ? null : res.get("height");
        if (height != null && !height.isNull()) {
            r.height = height.asLong();
        }
        r.rawLog = text(deliverTx, "log");
        return r;
    }
}
