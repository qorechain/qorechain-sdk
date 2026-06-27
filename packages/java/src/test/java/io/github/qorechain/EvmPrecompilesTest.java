package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.evm.EvmPrecompiles;
import io.github.qorechain.query.JsonRpcClient;
import io.github.qorechain.utils.Hex;
import java.io.IOException;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** AI EVM precompiles: hand-rolled ABI encode/decode against an in-process eth_call mock. */
class EvmPrecompilesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private String baseUrl;
    /** Recorded (method, to, data) per request. */
    private final List<String[]> calls = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    byte[] body = ex.getRequestBody().readAllBytes();
                    JsonNode req = MAPPER.readTree(body);
                    String method = req.path("method").asText();
                    JsonNode params = req.path("params");
                    String to = params.path(0).path("to").asText("");
                    String data = params.path(0).path("data").asText("");
                    calls.add(new String[] {method, to, data});

                    String result;
                    if ("eth_estimateGas".equals(method)) {
                        result = "0x5208"; // 21000
                    } else if ("eth_call".equals(method)) {
                        // Decide by target precompile address.
                        if (to.equalsIgnoreCase(EvmPrecompiles.AI_RISK_SCORE_ADDRESS)) {
                            // score=42, level=2
                            result = "0x" + word(42) + word(2);
                        } else {
                            // anomalyScore=7, flagged=true(1)
                            result = "0x" + word(7) + word(1);
                        }
                    } else {
                        result = "0x0";
                    }
                    respond(
                            ex,
                            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"" + result + "\"}");
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static String word(long v) {
        return String.format("%064x", v);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange ex, String body)
            throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void riskScoreEncodingIsSelectorPlusDynamicBytes() {
        byte[] enc = EvmPrecompiles.encodeRiskScoreCall(new byte[] {1, 2, 3});
        // 4-byte selector + 32-aligned args.
        assertEquals(0, (enc.length - 4) % 32);
        // selector == keccak256("aiRiskScore(bytes)")[0..4]
        String sel = Hex.encode(EvmPrecompiles.selector("aiRiskScore(bytes)"));
        assertEquals(8, sel.length());
        assertTrue(Hex.encode(enc).startsWith(sel));
        // args after the selector: offset word == 0x20, length word == 3
        byte[] args = java.util.Arrays.copyOfRange(enc, 4, enc.length);
        assertEquals(BigInteger.valueOf(0x20), EvmPrecompiles.word(args, 0));
        assertEquals(BigInteger.valueOf(3), EvmPrecompiles.word(args, 1));
    }

    @Test
    void anomalyEncodingPadsAddressAndUint() {
        String sender = "0x000000000000000000000000000000000000dEaD";
        byte[] enc = EvmPrecompiles.encodeAnomalyCheckCall(sender, BigInteger.valueOf(1000));
        // selector(4) + address word(32) + uint word(32)
        assertEquals(4 + 32 + 32, enc.length);
        byte[] args = java.util.Arrays.copyOfRange(enc, 4, enc.length);
        byte[] addrWord = java.util.Arrays.copyOfRange(args, 0, 32);
        // first 12 bytes zero, last 20 are the address.
        for (int i = 0; i < 12; i++) {
            assertEquals(0, addrWord[i]);
        }
        assertArrayEquals(Hex.decode(sender), java.util.Arrays.copyOfRange(addrWord, 12, 32));
        // uint word
        assertEquals(BigInteger.valueOf(1000), EvmPrecompiles.word(args, 1));
    }

    @Test
    void aiRiskScoreCallsB01AndDecodes() {
        JsonRpcClient client = new JsonRpcClient(baseUrl);
        EvmPrecompiles.RiskScore rs = EvmPrecompiles.aiRiskScore(client, new byte[] {0x11, 0x22});
        assertEquals(BigInteger.valueOf(42), rs.score);
        assertEquals(2, rs.level);
        assertEquals("eth_call", calls.get(0)[0]);
        assertEquals(
                EvmPrecompiles.AI_RISK_SCORE_ADDRESS.toLowerCase(),
                calls.get(0)[1].toLowerCase());
        // data starts with selector of aiRiskScore(bytes)
        String expectedSelector = Hex.encode(EvmPrecompiles.selector("aiRiskScore(bytes)"));
        assertTrue(Hex.strip0x(calls.get(0)[2]).startsWith(expectedSelector));
    }

    @Test
    void aiAnomalyCheckCallsB02AndDecodes() {
        JsonRpcClient client = new JsonRpcClient(baseUrl);
        EvmPrecompiles.Anomaly a =
                EvmPrecompiles.aiAnomalyCheck(
                        client, "0x000000000000000000000000000000000000dEaD", BigInteger.valueOf(5));
        assertEquals(BigInteger.valueOf(7), a.anomalyScore);
        assertTrue(a.flagged);
        assertEquals(
                EvmPrecompiles.AI_ANOMALY_CHECK_ADDRESS.toLowerCase(),
                calls.get(0)[1].toLowerCase());
        String expectedSelector = Hex.encode(EvmPrecompiles.selector("aiAnomalyCheck(address,uint256)"));
        assertTrue(Hex.strip0x(calls.get(0)[2]).startsWith(expectedSelector));
    }

    @Test
    void simulateWithRiskScoreCombinesGasAndAdvisory() {
        JsonRpcClient client = new JsonRpcClient(baseUrl);
        EvmPrecompiles.PreflightTx tx = new EvmPrecompiles.PreflightTx();
        tx.from = "0x000000000000000000000000000000000000dEaD";
        tx.to = "0x00000000000000000000000000000000000B0bb1";
        tx.data = "0xdeadbeef";
        tx.value = BigInteger.ZERO;

        EvmPrecompiles.Preflight p = EvmPrecompiles.simulateWithRiskScore(client, tx);
        assertEquals(21000L, p.gas);
        assertEquals(BigInteger.valueOf(42), p.risk.score);
        assertEquals(2, p.risk.level);
        assertTrue(p.anomaly.flagged);
        // safe = level<3 (2<3 true) && !flagged (flagged true) => false
        assertFalse(p.safe);

        // exactly one estimateGas + two eth_call (risk, anomaly)
        long estimates = calls.stream().filter(c -> c[0].equals("eth_estimateGas")).count();
        long ethCalls = calls.stream().filter(c -> c[0].equals("eth_call")).count();
        assertEquals(1, estimates);
        assertEquals(2, ethCalls);
    }
}
