package io.github.qorechain.subscribe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
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

    private final String wsUrl;
    private final HttpClient httpClient = HttpClient.newHttpClient();
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
        connect(handler, onError);
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("query", query);
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("jsonrpc", "2.0");
        req.put("id", nextId.getAndIncrement());
        req.put("method", "subscribe");
        req.put("params", params);
        try {
            webSocket.sendText(MAPPER.writeValueAsString(req), true);
        } catch (Exception e) {
            if (onError != null) {
                onError.accept(e);
            }
        }
    }

    private void connect(Consumer<JsonNode> handler, Consumer<Throwable> onError) {
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
                            try {
                                JsonNode node = MAPPER.readTree(full);
                                JsonNode result = node.get("result");
                                handler.accept(result != null ? result : node);
                            } catch (Exception e) {
                                if (onError != null) {
                                    onError.accept(e);
                                }
                            }
                        }
                        ws.request(1);
                        return null;
                    }

                    @Override
                    public void onError(WebSocket ws, Throwable error) {
                        if (onError != null) {
                            onError.accept(error);
                        }
                    }
                };
        this.webSocket =
                httpClient
                        .newWebSocketBuilder()
                        .buildAsync(URI.create(wsUrl), listener)
                        .join();
    }

    @Override
    public synchronized void close() {
        if (webSocket != null) {
            webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "client close");
            webSocket = null;
        }
    }
}
