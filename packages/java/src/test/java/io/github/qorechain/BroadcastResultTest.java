package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.TxError;
import io.github.qorechain.tx.TxTracker;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Reading the node's broadcast and tx answers. */
class BroadcastResultTest {

    private HttpServer server;
    private String baseUrl;
    /** The JSON-RPC {@code result} every broadcast gets. */
    private volatile String rpcResult = "{}";

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/cosmos/tx/v1beta1/txs/",
                ex -> respond(ex, "{\"tx_response\":{\"txhash\":\"AB\",\"code\":0,\"height\":\"42\"}}"));
        server.createContext(
                "/", ex -> respond(ex, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + rpcResult + "}"));
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void respond(HttpExchange ex, String b) throws IOException {
        ex.getRequestBody().readAllBytes();
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private Broadcaster.Result commit() {
        return new Broadcaster(baseUrl).broadcast(new byte[] {1, 2, 3}, Broadcaster.Mode.COMMIT);
    }

    @Test
    void commitReadsAFailureFromTxResult() {
        // Recorded shape of a current node's broadcast_tx_commit answer.
        rpcResult =
                "{\"check_tx\":{\"code\":0,\"log\":\"\"},"
                        + "\"tx_result\":{\"code\":5,\"codespace\":\"sdk\",\"log\":\"spendable balance 1uqor is smaller than 5uqor\",\"data\":null},"
                        + "\"hash\":\"C0FFEE\",\"height\":\"8123\"}";
        TxError.QoreTxException e = assertThrows(TxError.QoreTxException.class, this::commit);
        assertEquals(5, e.code);
        assertEquals("sdk", e.codespace);
        assertEquals("insufficient_funds", e.kind);
        assertEquals("spendable balance 1uqor is smaller than 5uqor", e.rawLog);
        assertEquals("C0FFEE", e.txHash);
    }

    @Test
    void commitReadsASuccessFromTxResult() {
        rpcResult =
                "{\"check_tx\":{\"code\":0},\"tx_result\":{\"code\":0,\"log\":\"ok\",\"data\":\"AQI=\"},"
                        + "\"hash\":\"C0FFEE\",\"height\":\"8123\"}";
        Broadcaster.Result r = commit();
        assertEquals(0, r.code);
        assertEquals("ok", r.rawLog);
        assertEquals(8123L, r.height);
        assertArrayEquals(new byte[] {1, 2}, r.data);
    }

    @Test
    void commitStillReadsTheOlderDeliverTxName() {
        rpcResult =
                "{\"check_tx\":{\"code\":0},\"deliver_tx\":{\"code\":5,\"codespace\":\"sdk\",\"log\":\"low\"},"
                        + "\"hash\":\"OLD\",\"height\":\"7\"}";
        TxError.QoreTxException e = assertThrows(TxError.QoreTxException.class, this::commit);
        assertEquals(5, e.code);
        assertEquals("low", e.rawLog);

        rpcResult =
                "{\"check_tx\":{\"code\":0},\"deliver_tx\":{\"code\":0,\"log\":\"fine\"},"
                        + "\"hash\":\"OLD\",\"height\":\"7\"}";
        Broadcaster.Result r = commit();
        assertEquals("fine", r.rawLog);
        assertEquals(7L, r.height);
    }

    @Test
    void waitForTxTakesNullOptionsAsTheDefaults() {
        TxTracker.IncludedTx tx = TxTracker.waitForTx(new RestClient(baseUrl), "AB", null);
        assertEquals(42L, tx.height);
        assertEquals(0, tx.code);
    }
}
