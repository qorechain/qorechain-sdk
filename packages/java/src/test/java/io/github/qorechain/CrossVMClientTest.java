package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.crossvm.CrossVMClient;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.StdFee;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** CrossVMClient: message composition, cosmwasm JSON payloads, atomic batching, getMessage. */
class CrossVMClientTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private String baseUrl;
    /** Captured broadcast TxRaw bytes (base64-decoded) per broadcast call. */
    private final List<byte[]> broadcastTxs = new ArrayList<>();
    private final List<String> rpcMethods = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    byte[] body = ex.getRequestBody().readAllBytes();
                    JsonNode req = MAPPER.readTree(body);
                    String method = req.path("method").asText();
                    rpcMethods.add(method);
                    if (method.startsWith("broadcast_tx")) {
                        String txB64 = req.path("params").path(0).asText();
                        broadcastTxs.add(java.util.Base64.getDecoder().decode(txB64));
                        respond(
                                ex,
                                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"code\":0,\"hash\":\"ABCD\",\"log\":\"\"}}");
                    } else {
                        // qor_getCrossVMMessage etc.
                        respond(
                                ex,
                                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"id\":\"m1\",\"targetVm\":\"cosmwasm\"}}");
                    }
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static void respond(com.sun.net.httpserver.HttpExchange ex, String b) throws IOException {
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private CrossVMClient client() {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        CrossVMClient.Signer signer = new CrossVMClient.Signer();
        signer.sender = acct.address;
        signer.secp256k1PrivateKey = acct.privateKey;
        signer.secp256k1PublicKey = acct.publicKey;
        signer.fee = StdFee.of("uqor", "5000", "200000");
        signer.chainId = "qorechain-diana";
        signer.accountNumber = 7;
        signer.sequence = 3;
        return new CrossVMClient(signer, new Broadcaster(baseUrl), new QorClient(baseUrl));
    }

    @Test
    void buildCallSetsFieldsAndTypeUrl() {
        CrossVMClient.CallOptions o = new CrossVMClient.CallOptions();
        o.sender = "qor1sender";
        o.targetVm = CrossVMClient.VMType.COSMWASM;
        o.targetContract = "qor1contract";
        o.funds = List.of(new StdFee.Coin("uqor", "100"));
        o.payload = new byte[] {0x01, 0x02};

        TypedMessage tm = client().buildCall(o);
        assertEquals("/qorechain.crossvm.v1.MsgCrossVMCall", tm.typeUrl);

        qorechain.crossvm.v1.Tx.MsgCrossVMCall msg =
                (qorechain.crossvm.v1.Tx.MsgCrossVMCall) tm.message;
        assertEquals("qor1sender", msg.getSender());
        assertEquals("evm", msg.getSourceVm()); // default
        assertEquals("cosmwasm", msg.getTargetVm());
        assertEquals("qor1contract", msg.getTargetContract());
        assertEquals(1, msg.getFundsCount());
        assertEquals("uqor", msg.getFunds(0).getDenom());
        assertEquals("100", msg.getFunds(0).getAmount());
        assertEquals(2, msg.getPayload().size());
    }

    @Test
    void cosmwasmPayloadSerializedToUtf8Json() {
        CrossVMClient.CallOptions o = new CrossVMClient.CallOptions();
        o.targetVm = CrossVMClient.VMType.COSMWASM;
        o.targetContract = "qor1contract";
        Map<String, Object> exec = new LinkedHashMap<>();
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("recipient", "qor1xyz");
        exec.put("transfer", inner);
        o.cosmwasm = exec;

        TypedMessage tm = client().buildCall(o);
        qorechain.crossvm.v1.Tx.MsgCrossVMCall msg =
                (qorechain.crossvm.v1.Tx.MsgCrossVMCall) tm.message;
        String json = msg.getPayload().toStringUtf8();
        assertEquals("{\"transfer\":{\"recipient\":\"qor1xyz\"}}", json);
    }

    @Test
    void callBroadcastsOneTxWithOneMessage() throws Exception {
        CrossVMClient.CallOptions o = new CrossVMClient.CallOptions();
        o.targetVm = CrossVMClient.VMType.SVM;
        o.targetContract = "prog1";
        o.payload = new byte[] {0x09};

        Broadcaster.Result r = client().call(o);
        assertEquals("ABCD", r.transactionHash);
        assertEquals(1, broadcastTxs.size());
        assertEquals(1, countMessages(broadcastTxs.get(0)));
    }

    @Test
    void callAtomicPacksNMessagesInOneTx() throws Exception {
        List<CrossVMClient.CallOptions> batch = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            CrossVMClient.CallOptions o = new CrossVMClient.CallOptions();
            o.targetVm = CrossVMClient.VMType.EVM;
            o.targetContract = "0xc0ffee";
            o.payload = new byte[] {(byte) i};
            batch.add(o);
        }

        Broadcaster.Result r = client().callAtomic(batch);
        assertEquals(0, r.code);
        // exactly ONE broadcast carrying THREE messages.
        assertEquals(1, broadcastTxs.size());
        assertEquals(3, countMessages(broadcastTxs.get(0)));
    }

    @Test
    void getMessageUsesQorRpc() {
        JsonNode res = client().getMessage("m1");
        assertNotNull(res);
        assertEquals("m1", res.path("id").asText());
        assertTrue(rpcMethods.contains("qor_getCrossVMMessage"));
    }

    /** Decode a TxRaw, parse the TxBody, and count its messages (all MsgCrossVMCall). */
    private static int countMessages(byte[] txRawBytes) throws Exception {
        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(txRawBytes);
        cosmos.tx.v1beta1.TxOuterClass.TxBody body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(txRaw.getBodyBytes());
        for (Any any : body.getMessagesList()) {
            assertTrue(any.getTypeUrl().endsWith("MsgCrossVMCall"));
            // round-trip through the registry to confirm registration.
            Messages.unpack(any);
        }
        return body.getMessagesCount();
    }
}
