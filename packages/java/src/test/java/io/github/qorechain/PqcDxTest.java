package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcAlgorithm;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.StdFee;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** PqcDx: status reads via qor_getPQCKeyStatus, idempotent ensurePqcRegistered, migrate. */
class PqcDxTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private String baseUrl;
    private final List<byte[]> broadcastTxs = new ArrayList<>();
    private final List<String> rpcMethods = new ArrayList<>();

    /** Controls what qor_getPQCKeyStatus returns; set per-test. */
    private volatile String statusResultJson = "{\"registered\":false}";

    @BeforeEach
    void start() throws IOException {
        broadcastTxs.clear();
        rpcMethods.clear();
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
                                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"code\":0,\"hash\":\"DEADBEEF\",\"log\":\"\"}}");
                    } else {
                        // qor_getPQCKeyStatus
                        respond(
                                ex,
                                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + statusResultJson + "}");
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

    private QorClient qor() {
        return new QorClient(baseUrl);
    }

    private PqcDx.Signer signer(PqcKeypair pqc) {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.pqcKeypair = pqc;
        s.fee = StdFee.of("uqor", "5000", "200000");
        s.chainId = "qorechain-diana";
        s.accountNumber = 7;
        s.sequence = 3;
        return s;
    }

    // ---- Reads ----

    @Test
    void isPqcRegisteredFalseWhenNotRegistered() {
        statusResultJson = "{\"registered\":false}";
        assertFalse(PqcDx.isPqcRegistered(qor(), "qor1addr"));
        assertTrue(rpcMethods.contains("qor_getPQCKeyStatus"));
    }

    @Test
    void isPqcRegisteredTrueWhenRegistered() {
        statusResultJson = "{\"registered\":true}";
        assertTrue(PqcDx.isPqcRegistered(qor(), "qor1addr"));
    }

    @Test
    void getPqcStatusNormalizesSnakeCaseAndHexPubkey() {
        statusResultJson =
                "{\"registered\":\"true\",\"algorithm_id\":\"1\",\"public_key\":\"0x0a0b0c\"}";
        PqcDx.PqcStatus st = PqcDx.getPqcStatus(qor(), "qor1addr");
        assertTrue(st.registered);
        assertEquals(PqcAlgorithm.ALGORITHM_DILITHIUM5, st.algorithmId);
        assertArrayEquals(new byte[] {0x0a, 0x0b, 0x0c}, st.pubkey);
    }

    @Test
    void getPqcStatusDegradesGracefullyOnEmptyResult() {
        statusResultJson = "{}";
        PqcDx.PqcStatus st = PqcDx.getPqcStatus(qor(), "qor1addr");
        assertFalse(st.registered);
        assertEquals(PqcAlgorithm.ALGORITHM_UNSPECIFIED, st.algorithmId);
        assertNull(st.pubkey);
    }

    // ---- ensurePqcRegistered ----

    @Test
    void ensureSkipsBroadcastWhenAlreadyRegistered() {
        statusResultJson = "{\"registered\":true,\"algorithm_id\":1}";
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        PqcDx.EnsureResult r =
                PqcDx.ensurePqcRegistered(signer(kp), new Broadcaster(baseUrl), qor(), null);
        assertTrue(r.alreadyRegistered);
        assertNull(r.txHash);
        assertEquals(0, broadcastTxs.size());
        assertTrue(rpcMethods.contains("qor_getPQCKeyStatus"));
        assertFalse(rpcMethods.stream().anyMatch(m -> m.startsWith("broadcast_tx")));
    }

    @Test
    void ensureBroadcastsRegisterMsgWhenMissing() throws Exception {
        statusResultJson = "{\"registered\":false}";
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);

        PqcDx.EnsureResult r =
                PqcDx.ensurePqcRegistered(signer(kp), new Broadcaster(baseUrl), qor(), null);

        assertFalse(r.alreadyRegistered);
        assertEquals("DEADBEEF", r.txHash);
        assertEquals(1, broadcastTxs.size());

        // Decode the broadcast tx and verify the single MsgRegisterPQCKey + fields.
        qorechain.pqc.v1.Tx.MsgRegisterPQCKey msg = soleRegisterMsg(broadcastTxs.get(0));
        assertEquals(acct.address, msg.getSender());
        assertArrayEquals(kp.publicKey, msg.getDilithiumPubkey().toByteArray());
        assertArrayEquals(acct.publicKey, msg.getEcdsaPubkey().toByteArray());
        assertEquals("hybrid", msg.getKeyType());
    }

    @Test
    void ensureBroadcastsUnconditionallyWhenNoStatusSource() throws Exception {
        // No QorClient passed => no pre-flight read; relies on chain idempotency.
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        PqcDx.EnsureResult r =
                PqcDx.ensurePqcRegistered(signer(kp), new Broadcaster(baseUrl), null, null);
        assertFalse(r.alreadyRegistered);
        assertEquals(1, broadcastTxs.size());
        assertFalse(rpcMethods.contains("qor_getPQCKeyStatus"));
    }

    @Test
    void ensureHonorsExplicitEcdsaPubkeyAndKeyType() throws Exception {
        statusResultJson = "{\"registered\":false}";
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        PqcDx.EnsureOptions opts = new PqcDx.EnsureOptions();
        opts.ecdsaPubkey = new byte[] {0x11, 0x22};
        opts.keyType = "pqc-only";

        PqcDx.ensurePqcRegistered(signer(kp), new Broadcaster(baseUrl), qor(), opts);

        qorechain.pqc.v1.Tx.MsgRegisterPQCKey msg = soleRegisterMsg(broadcastTxs.get(0));
        assertArrayEquals(new byte[] {0x11, 0x22}, msg.getEcdsaPubkey().toByteArray());
        assertEquals("pqc-only", msg.getKeyType());
    }

    @Test
    void ensureUsesPreReadStatusWithoutRpc() {
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        PqcDx.EnsureOptions opts = new PqcDx.EnsureOptions();
        opts.status = new PqcDx.PqcStatus(true, PqcAlgorithm.ALGORITHM_DILITHIUM5, null);

        PqcDx.EnsureResult r =
                PqcDx.ensurePqcRegistered(signer(kp), new Broadcaster(baseUrl), qor(), opts);
        assertTrue(r.alreadyRegistered);
        assertEquals(0, broadcastTxs.size());
        assertFalse(rpcMethods.contains("qor_getPQCKeyStatus"));
    }

    // ---- migratePqcKey ----

    @Test
    void migratePqcKeyBroadcastsMigrateMsg() throws Exception {
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);
        PqcDx.MigrateOptions opts = new PqcDx.MigrateOptions();
        opts.oldPublicKey = new byte[] {0x01};
        opts.newPublicKey = new byte[] {0x02};
        opts.oldSignature = new byte[] {0x03};
        opts.newSignature = new byte[] {0x04};

        Broadcaster.Result r = PqcDx.migratePqcKey(signer(kp), new Broadcaster(baseUrl), opts);
        assertEquals("DEADBEEF", r.transactionHash);
        assertEquals(1, broadcastTxs.size());

        Any only = soleMessage(broadcastTxs.get(0));
        assertTrue(only.getTypeUrl().endsWith("MsgMigratePQCKey"));
        qorechain.pqc.v1.Tx.MsgMigratePQCKey msg =
                (qorechain.pqc.v1.Tx.MsgMigratePQCKey) Messages.unpack(only);
        assertArrayEquals(new byte[] {0x01}, msg.getOldPublicKey().toByteArray());
        assertArrayEquals(new byte[] {0x02}, msg.getNewPublicKey().toByteArray());
        assertEquals(PqcAlgorithm.ALGORITHM_DILITHIUM5, msg.getNewAlgorithmId());
    }

    // ---- migrateToHybrid ----

    @Test
    void migrateToHybridEnsuresThenSendsHybridTx() throws Exception {
        statusResultJson = "{\"registered\":false}";
        PqcKeypair kp = Pqc.generatePqcKeypair(new byte[32]);

        PqcDx.HybridSendPath path =
                PqcDx.migrateToHybrid(signer(kp), new Broadcaster(baseUrl), qor(), null);
        assertFalse(path.alreadyRegistered);
        assertEquals("DEADBEEF", path.registrationTxHash);
        // 1 broadcast so far: the registration tx.
        assertEquals(1, broadcastTxs.size());

        // Now send a hybrid bank tx; verify it carries the PQC extension.
        TypedMessage send =
                io.github.qorechain.tx.NativeTx.bankSend(
                        signer(kp).sender,
                        "qor1recipient",
                        List.of(new StdFee.Coin("uqor", "10")));
        Broadcaster.Result r = path.send(List.of(send));
        assertEquals("DEADBEEF", r.transactionHash);
        assertEquals(2, broadcastTxs.size());
        assertTrue(hasPqcExtension(broadcastTxs.get(1)));
    }

    // ---- decode helpers ----

    private static Any soleMessage(byte[] txRawBytes) throws Exception {
        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(txRawBytes);
        cosmos.tx.v1beta1.TxOuterClass.TxBody bodyMsg =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(txRaw.getBodyBytes());
        assertEquals(1, bodyMsg.getMessagesCount());
        return bodyMsg.getMessages(0);
    }

    private static qorechain.pqc.v1.Tx.MsgRegisterPQCKey soleRegisterMsg(byte[] txRawBytes)
            throws Exception {
        Any only = soleMessage(txRawBytes);
        assertTrue(only.getTypeUrl().endsWith("MsgRegisterPQCKey"));
        return (qorechain.pqc.v1.Tx.MsgRegisterPQCKey) Messages.unpack(only);
    }

    private static boolean hasPqcExtension(byte[] txRawBytes) throws Exception {
        cosmos.tx.v1beta1.TxOuterClass.TxRaw txRaw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(txRawBytes);
        cosmos.tx.v1beta1.TxOuterClass.TxBody bodyMsg =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(txRaw.getBodyBytes());
        for (Any ext : bodyMsg.getExtensionOptionsList()) {
            if (ext.getTypeUrl().equals(Pqc.HYBRID_SIG_TYPE_URL)) {
                return true;
            }
        }
        return false;
    }
}
