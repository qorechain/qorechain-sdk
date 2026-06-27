package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Message;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.query.BridgeQueryClient;
import io.github.qorechain.query.MultilayerQueryClient;
import io.github.qorechain.query.RdkQueryClient;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Typed module query clients (rdk, multilayer, bridge) against an in-process mock
 * consensus RPC that answers {@code abci_query}. Verifies the ABCI path/service
 * dispatch and the request/response protobuf round-trip.
 */
class ModuleQueryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private final List<String> abciPaths = new ArrayList<>();
    private String baseUrl;

    /** The protobuf message the mock echoes back (base64) as the abci_query value. */
    private Message responseMessage;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    byte[] body = ex.getRequestBody().readAllBytes();
                    JsonNode req = MAPPER.readTree(body);
                    // params: [path, data, height, prove]
                    abciPaths.add(req.path("params").path(0).asText());
                    String valueB64 =
                            Base64.getEncoder()
                                    .encodeToString(
                                            responseMessage == null
                                                    ? new byte[0]
                                                    : responseMessage.toByteArray());
                    String resp =
                            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"response\":{\"code\":0,"
                                    + "\"value\":\""
                                    + valueB64
                                    + "\"}}}";
                    respond(ex, resp);
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
    void rdkQueryClientPathsAndDecode() {
        RdkQueryClient rdk = new RdkQueryClient(baseUrl);

        responseMessage =
                qorechain.rdk.v1.QueryOuterClass.QueryParamsResponse.newBuilder()
                        .setParams(
                                qorechain.rdk.v1.QueryOuterClass.ParamsView.newBuilder()
                                        .setMaxRollups(42))
                        .build();
        assertEquals(42, rdk.params().getParams().getMaxRollups());

        responseMessage =
                qorechain.rdk.v1.QueryOuterClass.QueryRollupResponse.newBuilder()
                        .setRollup(
                                qorechain.rdk.v1.QueryOuterClass.RollupView.newBuilder()
                                        .setRollupId("rollup-1")
                                        .setStatus("active"))
                        .build();
        assertEquals("rollup-1", rdk.rollup("rollup-1").getRollup().getRollupId());

        responseMessage =
                qorechain.rdk.v1.QueryOuterClass.QueryRollupsResponse.newBuilder()
                        .addRollups(
                                qorechain.rdk.v1.QueryOuterClass.RollupView.newBuilder()
                                        .setRollupId("r1"))
                        .build();
        assertEquals(1, rdk.rollups().getRollupsCount());

        responseMessage =
                qorechain.rdk.v1.QueryOuterClass.QueryBatchResponse.newBuilder()
                        .setBatch(
                                qorechain.rdk.v1.QueryOuterClass.BatchView.newBuilder()
                                        .setBatchIndex(5)
                                        .setWithdrawalsRoot("0xroot"))
                        .build();
        var batch = rdk.batch("rollup-1", 5).getBatch();
        assertEquals(5, batch.getBatchIndex());
        assertEquals("0xroot", batch.getWithdrawalsRoot());

        responseMessage =
                qorechain.rdk.v1.QueryOuterClass.QueryLatestBatchResponse.newBuilder()
                        .setBatch(
                                qorechain.rdk.v1.QueryOuterClass.BatchView.newBuilder()
                                        .setBatchIndex(9))
                        .build();
        assertEquals(9, rdk.latestBatch("rollup-1").getBatch().getBatchIndex());

        assertEquals(
                List.of(
                        "/qorechain.rdk.v1.Query/Params",
                        "/qorechain.rdk.v1.Query/Rollup",
                        "/qorechain.rdk.v1.Query/Rollups",
                        "/qorechain.rdk.v1.Query/Batch",
                        "/qorechain.rdk.v1.Query/LatestBatch"),
                abciPaths);
    }

    @Test
    void multilayerQueryClientPathsAndDecode() {
        MultilayerQueryClient ml = new MultilayerQueryClient(baseUrl);

        responseMessage =
                qorechain.multilayer.v1.QueryOuterClass.QueryParamsResponse.newBuilder()
                        .setParams(
                                qorechain.multilayer.v1.QueryOuterClass.ParamsView.newBuilder()
                                        .setMaxSidechains(8))
                        .build();
        assertEquals(8, ml.params().getParams().getMaxSidechains());

        responseMessage =
                qorechain.multilayer.v1.QueryOuterClass.QueryLayerResponse.newBuilder()
                        .setLayer(
                                qorechain.multilayer.v1.QueryOuterClass.LayerView.newBuilder()
                                        .setLayerId("L1")
                                        .setStatus("active"))
                        .build();
        assertEquals("L1", ml.layer("L1").getLayer().getLayerId());

        responseMessage =
                qorechain.multilayer.v1.QueryOuterClass.QueryLayersResponse.newBuilder()
                        .addLayers(
                                qorechain.multilayer.v1.QueryOuterClass.LayerView.newBuilder()
                                        .setLayerId("L1"))
                        .build();
        assertEquals(1, ml.layers().getLayersCount());

        responseMessage =
                qorechain.multilayer.v1.QueryOuterClass.QueryRoutingStatsView.newBuilder()
                        .setStats(
                                qorechain.multilayer.v1.QueryOuterClass.RoutingStatsView.newBuilder()
                                        .setTotalRouted(123))
                        .build();
        assertEquals(123, ml.routingStats().getStats().getTotalRouted());

        assertEquals(
                List.of(
                        "/qorechain.multilayer.v1.Query/Params",
                        "/qorechain.multilayer.v1.Query/Layer",
                        "/qorechain.multilayer.v1.Query/Layers",
                        "/qorechain.multilayer.v1.Query/RoutingStats"),
                abciPaths);
    }

    @Test
    void bridgeQueryClientPathsAndDecode() {
        BridgeQueryClient bridge = new BridgeQueryClient(baseUrl);

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryConfigResponse.newBuilder()
                        .setConfig(
                                qorechain.bridge.v1.QueryOuterClass.BridgeConfigView.newBuilder()
                                        .setEnabled(true))
                        .build();
        assertTrue(bridge.config().getConfig().getEnabled());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryChainConfigResponse.newBuilder()
                        .setChain(
                                qorechain.bridge.v1.QueryOuterClass.ChainConfigView.newBuilder()
                                        .setChainId("eth"))
                        .build();
        assertEquals("eth", bridge.chainConfig("eth").getChain().getChainId());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryChainConfigsResponse.newBuilder()
                        .addChains(
                                qorechain.bridge.v1.QueryOuterClass.ChainConfigView.newBuilder()
                                        .setChainId("eth"))
                        .build();
        assertEquals(1, bridge.chainConfigs().getChainsCount());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryValidatorResponse.newBuilder()
                        .setValidator(
                                qorechain.bridge.v1.QueryOuterClass.BridgeValidatorView.newBuilder()
                                        .setAddress("qorvaloper1"))
                        .build();
        assertEquals("qorvaloper1", bridge.validator("qorvaloper1").getValidator().getAddress());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryValidatorsResponse.newBuilder()
                        .addValidators(
                                qorechain.bridge.v1.QueryOuterClass.BridgeValidatorView.newBuilder()
                                        .setAddress("qorvaloper1"))
                        .build();
        assertEquals(1, bridge.validators().getValidatorsCount());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryOperationResponse.newBuilder()
                        .setOperation(
                                qorechain.bridge.v1.QueryOuterClass.BridgeOperationView.newBuilder()
                                        .setId("op-1"))
                        .build();
        assertEquals("op-1", bridge.operation("op-1").getOperation().getId());

        responseMessage =
                qorechain.bridge.v1.QueryOuterClass.QueryOperationsResponse.newBuilder()
                        .addOperations(
                                qorechain.bridge.v1.QueryOuterClass.BridgeOperationView.newBuilder()
                                        .setId("op-1"))
                        .build();
        assertEquals(1, bridge.operations().getOperationsCount());

        assertEquals(
                List.of(
                        "/qorechain.bridge.v1.Query/Config",
                        "/qorechain.bridge.v1.Query/ChainConfig",
                        "/qorechain.bridge.v1.Query/ChainConfigs",
                        "/qorechain.bridge.v1.Query/Validator",
                        "/qorechain.bridge.v1.Query/Validators",
                        "/qorechain.bridge.v1.Query/Operation",
                        "/qorechain.bridge.v1.Query/Operations"),
                abciPaths);
    }
}
