package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A JSON-RPC 2.0 client.
 *
 * <p>Builds {@code {jsonrpc:"2.0", id, method, params}} request bodies with an
 * auto-incrementing id starting at 1, POSTs them, and returns the {@code result}
 * node (throwing {@link JsonRpcException} when the response carries an
 * {@code error}). Also exposes the EVM {@code eth_*} / {@code net_*} /
 * {@code web3_*} methods with their exact wire method strings.
 */
public class JsonRpcClient {

    /** Thrown when a JSON-RPC response carries an {@code error} object. */
    public static final class JsonRpcException extends RuntimeException {
        public final int code;
        public final JsonNode data;

        public JsonRpcException(int code, String message, JsonNode data) {
            super(message);
            this.code = code;
            this.data = data;
        }
    }

    protected final String url;
    protected final Http.Options options;
    private final AtomicLong nextId = new AtomicLong(1);

    public JsonRpcClient(String url) {
        this(url, new Http.Options());
    }

    public JsonRpcClient(String url, Http.Options options) {
        this.url = url;
        this.options = options;
    }

    /** Invoke a JSON-RPC method and return the raw {@code result} node. */
    public JsonNode call(String method, List<Object> params) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jsonrpc", "2.0");
        body.put("id", nextId.getAndIncrement());
        body.put("method", method);
        body.put("params", params == null ? List.of() : params);
        JsonNode res = Http.postJson(url, body, options);
        JsonNode error = res.get("error");
        if (error != null && !error.isNull()) {
            int code = error.has("code") ? error.get("code").asInt() : 0;
            String message = error.has("message") ? error.get("message").asText() : "JSON-RPC error";
            throw new JsonRpcException(code, message, error.get("data"));
        }
        return res.get("result");
    }

    // ---- EVM JSON-RPC methods (exact wire strings) ----

    /** {@code eth_chainId}. */
    public JsonNode ethChainId() {
        return call("eth_chainId", List.of());
    }

    /** {@code eth_blockNumber}. */
    public JsonNode ethBlockNumber() {
        return call("eth_blockNumber", List.of());
    }

    /** {@code eth_getBalance} at the given block tag (default {@code "latest"}). */
    public JsonNode ethGetBalance(String address, String block) {
        return call("eth_getBalance", List.of(address, block == null ? "latest" : block));
    }

    public JsonNode ethGetBalance(String address) {
        return ethGetBalance(address, "latest");
    }

    /** {@code net_version}. */
    public JsonNode netVersion() {
        return call("net_version", List.of());
    }

    /** {@code web3_clientVersion}. */
    public JsonNode web3ClientVersion() {
        return call("web3_clientVersion", List.of());
    }
}
