package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.query.RestClient;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** REST path templates and qor_* JSON-RPC wire strings against an in-process mock server. */
class QueryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private final List<String> restPaths = new ArrayList<>();
    private final List<String> rpcMethods = new ArrayList<>();
    private String baseUrl;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);

        // REST: record path + query, return empty JSON object.
        server.createContext(
                "/",
                ex -> {
                    String uri = ex.getRequestURI().toString();
                    if ("POST".equals(ex.getRequestMethod())) {
                        // JSON-RPC: record method, return {result:{}} (or error for one method).
                        byte[] body = ex.getRequestBody().readAllBytes();
                        JsonNode req = MAPPER.readTree(body);
                        String method = req.path("method").asText();
                        rpcMethods.add(method);
                        String resp =
                                "qor_makeError".equals(method)
                                        ? "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"not found\"}}"
                                        : "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}";
                        respond(ex, resp);
                    } else {
                        restPaths.add(uri);
                        respond(ex, "{}");
                    }
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
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
    void restPathTemplates() {
        RestClient rest = new RestClient(baseUrl);
        rest.getAllBalances("qor1abc");
        rest.getBalance("qor1abc", "uqor");
        rest.getAiStats();
        rest.getFeeEstimate("normal");
        rest.getBridgeChains();
        rest.getPqcAccount("qor1abc");
        rest.getReputation("qorvaloper1xyz");
        rest.getBurnStats();
        rest.getXqorePosition("qor1abc");
        rest.getInflationRate();

        assertTrue(restPaths.contains("/cosmos/bank/v1beta1/balances/qor1abc"));
        assertTrue(restPaths.contains("/cosmos/bank/v1beta1/balances/qor1abc/by_denom?denom=uqor"));
        assertTrue(restPaths.contains("/qorechain/ai/v1/stats"));
        assertTrue(restPaths.contains("/qorechain/ai/v1/fee-estimate?urgency=normal"));
        assertTrue(restPaths.contains("/qorechain/bridge/v1/chains"));
        assertTrue(restPaths.contains("/qorechain/pqc/v1/accounts/qor1abc"));
        assertTrue(restPaths.contains("/qorechain/reputation/v1/validators/qorvaloper1xyz"));
        assertTrue(restPaths.contains("/qorechain/burn/v1/stats"));
        assertTrue(restPaths.contains("/qorechain/xqore/v1/position/qor1abc"));
        assertTrue(restPaths.contains("/qorechain/inflation/v1/rate"));
    }

    @Test
    void qorWireMethodStrings() {
        QorClient qor = new QorClient(baseUrl);
        qor.getPqcKeyStatus("qor1abc");
        qor.getHybridSignatureMode();
        qor.getAiStats();
        qor.getCrossVmMessage("m1");
        qor.getReputationScore("qorvaloper1");
        qor.getLayerInfo("L1");
        qor.getBridgeStatus("eth");
        qor.getRlAgentStatus();
        qor.getRlObservation();
        qor.getRlReward();
        qor.getPoolClassification("qorvaloper1");
        qor.getBurnStats();
        qor.getXqorePosition("qor1abc");
        qor.getInflationRate();
        qor.getTokenomicsOverview();
        qor.getRollupStatus("r1");
        qor.listRollups();
        qor.getSettlementBatch("r1", 0);
        qor.suggestRollupProfile("gaming");
        qor.getDaBlobStatus("r1", 2);
        qor.getBtcStakingPosition("qor1abc");
        qor.getAbstractAccount("qor1abc");
        qor.getFairBlockStatus();
        qor.getGasAbstractionConfig();
        qor.getLaneConfiguration();

        List<String> expected =
                List.of(
                        "qor_getPQCKeyStatus",
                        "qor_getHybridSignatureMode",
                        "qor_getAIStats",
                        "qor_getCrossVMMessage",
                        "qor_getReputationScore",
                        "qor_getLayerInfo",
                        "qor_getBridgeStatus",
                        "qor_getRLAgentStatus",
                        "qor_getRLObservation",
                        "qor_getRLReward",
                        "qor_getPoolClassification",
                        "qor_getBurnStats",
                        "qor_getXQOREPosition",
                        "qor_getInflationRate",
                        "qor_getTokenomicsOverview",
                        "qor_getRollupStatus",
                        "qor_listRollups",
                        "qor_getSettlementBatch",
                        "qor_suggestRollupProfile",
                        "qor_getDABlobStatus",
                        "qor_getBTCStakingPosition",
                        "qor_getAbstractAccount",
                        "qor_getFairBlockStatus",
                        "qor_getGasAbstractionConfig",
                        "qor_getLaneConfiguration");
        assertEquals(25, expected.size());
        assertEquals(expected, rpcMethods);
    }

    @Test
    void evmJsonRpcMethods() {
        QorClient client = new QorClient(baseUrl);
        client.ethChainId();
        client.ethBlockNumber();
        client.ethGetBalance("0xabc");
        client.netVersion();
        client.web3ClientVersion();
        assertEquals(
                List.of(
                        "eth_chainId",
                        "eth_blockNumber",
                        "eth_getBalance",
                        "net_version",
                        "web3_clientVersion"),
                rpcMethods);
    }
}
