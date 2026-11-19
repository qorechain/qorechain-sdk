package io.github.qorechain.subscribe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * WebSocket subscription client for the consensus RPC {@code /websocket}
 * endpoint, built on {@link java.net.http.WebSocket}.
 *
 * <p>{@link #subscribeNewBlocks} subscribes to {@code tm.event='NewBlock'} and
 * {@link #subscribeTx} to {@code tm.event='Tx'} (optionally ANDed with event
 * filters). Each delivered JSON-RPC message is parsed and handed to the consumer.
 */
public final class SubscriptionClient implements AutoCloseable {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** How long opening the socket (connect + handshake) may take before it fails. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

    private final String wsUrl;
    private final HttpClient httpClient =
            HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
    private final AtomicLong nextId = new AtomicLong(1);
    private WebSocket webSocket;

    /**
     * @param rpcUrl the consensus RPC base (e.g. {@code http://localhost:26657});
     *     {@code /websocket} is appended and {@code http(s)} upgraded to
     *     {@code ws(s)}.
     */
    public SubscriptionClient(String rpcUrl) {
        String base = rpcUrl.replaceAll("/+$", "");
        if (base.startsWith("https://")) {
            base = "wss://" + base.substring("https://".length());
        } else if (base.startsWith("http://")) {
            base = "ws://" + base.substring("http://".length());
        }
        this.wsUrl = base + "/websocket";
    }

    /** The {@code tm.event='Tx'} query, ANDed with optional {@code key='value'} filters. */
    public static String buildTxQuery(Map<String, Object> filters) {
        StringBuilder sb = new StringBuilder("tm.event='Tx'");
        if (filters != null) {
            for (Map.Entry<String, Object> e : filters.entrySet()) {
                sb.append(" AND ").append(e.getKey()).append('=');
                Object v = e.getValue();
                if (v instanceof Number) {
                    sb.append(v);
                } else {
                    sb.append('\'').append(v).append('\'');
                }
            }
        }
        return sb.toString();
    }

    /** Subscribe to new blocks ({@code tm.event='NewBlock'}). */
    public void subscribeNewBlocks(Consumer<JsonNode> handler, Consumer<Throwable> onError) {
        subscribe("tm.event='NewBlock'", handler, onError);
    }

    /** Subscribe to transactions matching {@code query} (use {@link #buildTxQuery}). */
    public void subscribeTx(String query, Consumer<JsonNode> handler, Consumer<Throwable> onError) {
        subscribe(query, handler, onError);
    }

    /** Subscribe to transactions matching the given event filters. */
    public void subscribeTx(
            Map<String, Object> filters, Consumer<JsonNode> handler, Consumer<Throwable> onError) {
        subscribe(buildTxQuery(filters), handler, onError);
    }

    private synchronized void subscribe(
            String query, Consumer<JsonNode> handler, Consumer<Throwable> onError) {
        connect();
        long id = nextId.getAndIncrement();
        handlers.put(id, new Handlers(handler, onError));
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("query", query);
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("jsonrpc", "2.0");
        req.put("id", id);
        req.put("method", "subscribe");
        req.put("params", params);
        try {
            webSocket.sendText(MAPPER.writeValueAsString(req), true);
        } catch (Exception e) {
            handlers.remove(id);
            if (onError != null) {
                onError.accept(e);
            }
        }
    }

    /** A subscription's consumers, keyed by its JSON-RPC request id. */
    private record Handlers(Consumer<JsonNode> onEvent, Consumer<Throwable> onError) {}

    private final Map<Long, Handlers> handlers = new java.util.concurrent.ConcurrentHashMap<>();

    private void connect() {
        if (webSocket != null) {
            return;
        }
        StringBuilder buffer = new StringBuilder();
        WebSocket.Listener listener =
                new WebSocket.Listener() {
                    @Override
                    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                        buffer.append(data);
                        if (last) {
                            String full = buffer.toString();
                            buffer.setLength(0);
                            dispatch(full);
                        }
                        ws.request(1);
                        return null;
                    }

                    @Override
                    public void onError(WebSocket ws, Throwable error) {
                        for (Handlers h : handlers.values()) {
                            if (h.onError() != null) {
                                h.onError().accept(error);
                            }
                        }
                    }
                };
        this.webSocket =
                httpClient
                        .newWebSocketBuilder()
                        .connectTimeout(CONNECT_TIMEOUT)
                        .buildAsync(URI.create(wsUrl), listener)
                        .join();
    }

    /** Route one JSON-RPC frame to the subscription whose request id it carries. */
    void dispatch(String frame) {
        JsonNode node;
        try {
            node = MAPPER.readTree(frame);
        } catch (Exception e) {
            for (Handlers h : handlers.values()) {
                if (h.onError() != null) {
                    h.onError().accept(e);
                }
            }
            return;
        }
        JsonNode idNode = node.get("id");
        if (idNode == null || !idNode.canConvertToLong()) {
            return;
        }
        Handlers h = handlers.get(idNode.asLong());
        if (h == null) {
            return;
        }
        JsonNode result = node.get("result");
        try {
            h.onEvent().accept(result != null ? result : node);
        } catch (RuntimeException e) {
            if (h.onError() != null) {
                h.onError().accept(e);
            }
        }
    }

    /** Package-private for tests: register a handler as a subscription with {@code id} would. */
    void registerForTest(long id, Consumer<JsonNode> handler) {
        handlers.put(id, new Handlers(handler, null));
    }

    /**
     * Close the socket: send a close frame, then abort the connection so it is
     * released even if the node does not answer the close.
     */
    @Override
    public synchronized void close() {
        handlers.clear();
        if (webSocket != null) {
            WebSocket ws = webSocket;
            webSocket = null;
            try {
                ws.sendClose(WebSocket.NORMAL_CLOSURE, "client close")
                        .orTimeout(2, java.util.concurrent.TimeUnit.SECONDS)
                        .exceptionally(e -> ws)
                        .join();
            } finally {
                ws.abort();
            }
        }
    }
}
