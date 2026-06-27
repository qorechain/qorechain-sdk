package io.github.qorechain.query;

import com.fasterxml.jackson.databind.JsonNode;
import com.google.protobuf.ByteString;
import java.util.Base64;
import java.util.List;

/**
 * A protobuf RPC transport over the consensus RPC's {@code abci_query} method —
 * the Java analog of cosmjs's {@code ProtobufRpcClient}.
 *
 * <p>Module {@code Query} services are exposed by the chain over the ABCI query
 * path {@code /{package}.Query/{Method}} (e.g.
 * {@code /qorechain.rdk.v1.Query/Rollup}). Each typed module client below encodes
 * its request, calls {@link #request(String, String, ByteString)} with the
 * service + method name, and decodes the response bytes — so callers get fully
 * typed {@code Query*Request → Query*Response} calls without hand-rolling ABCI
 * paths.
 *
 * <p>Point this at the network's consensus RPC endpoint (the JSON-RPC server that
 * serves {@code abci_query}).
 */
public final class AbciQueryClient {

    /** Thrown when the chain reports a non-zero ABCI response code. */
    public static final class AbciQueryException extends RuntimeException {
        public final int code;
        public final String log;

        public AbciQueryException(int code, String log) {
            super("ABCI query failed (code " + code + "): " + log);
            this.code = code;
            this.log = log;
        }
    }

    private final JsonRpcClient rpc;

    public AbciQueryClient(String url) {
        this.rpc = new JsonRpcClient(url);
    }

    public AbciQueryClient(String url, Http.Options options) {
        this.rpc = new JsonRpcClient(url, options);
    }

    /**
     * Dispatch a unary protobuf request to a module query method via
     * {@code abci_query} and return the raw response bytes.
     *
     * @param service the proto service name, e.g. {@code qorechain.rdk.v1.Query}
     * @param method the rpc method name, e.g. {@code Rollup}
     * @param data the encoded request bytes
     * @return the encoded response bytes
     */
    public ByteString request(String service, String method, ByteString data) {
        String path = "/" + service + "/" + method;
        String b64Data = Base64.getEncoder().encodeToString(data.toByteArray());
        // abci_query params: [path, data(hex/base64), height, prove]. The
        // consensus RPC accepts positional params; data is base64-encoded.
        JsonNode result = rpc.call("abci_query", List.of(path, b64Data, "0", false));

        JsonNode response = result == null ? null : result.get("response");
        if (response == null || response.isNull()) {
            throw new AbciQueryException(-1, "missing abci_query response");
        }
        int code = response.path("code").asInt(0);
        if (code != 0) {
            throw new AbciQueryException(code, response.path("log").asText(""));
        }
        JsonNode value = response.get("value");
        if (value == null || value.isNull()) {
            return ByteString.EMPTY;
        }
        byte[] decoded = Base64.getDecoder().decode(value.asText());
        return ByteString.copyFrom(decoded);
    }
}
