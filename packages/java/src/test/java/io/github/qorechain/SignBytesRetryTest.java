package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.tx.TxError;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The high-level hybrid send path ({@link PqcDx.HybridSendPath#send}) re-resolves
 * the sign-bytes version and retries ONCE when an AUTO-mode broadcast is refused
 * with {@code pqc} code 21, and never otherwise. A local HTTP server plays both the
 * REST endpoint (applied-plan query) and the consensus RPC (broadcast).
 */
class SignBytesRetryTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CHAIN_ID = "qorechain-diana";

    private static final String OK =
            "{\"code\":0,\"hash\":\"OKHASH\",\"log\":\"\",\"codespace\":\"\"}";
    private static final String PQC_21 =
            "{\"code\":21,\"hash\":\"BADHASH\",\"codespace\":\"pqc\","
                    + "\"log\":\"hybrid PQC signature verification failed\"}";
    private static final String SDK_21 =
            "{\"code\":21,\"hash\":\"BADHASH\",\"codespace\":\"sdk\",\"log\":\"tx too large\"}";

    private HttpServer server;
    private String baseUrl;
    private final List<byte[]> broadcastTxs = new ArrayList<>();
    private final Deque<String> broadcastReplies = new ArrayDeque<>();
    private final AtomicInteger planCalls = new AtomicInteger();
    /** The applied height the fake REST endpoint reports. */
    private volatile String appliedHeight = "0";
    /** When set, the first broadcast flips the network to v2 (simulating an upgrade). */
    private volatile boolean upgradeOnFirstBroadcast = false;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/cosmos/upgrade/v1beta1/applied_plan/",
                ex -> {
                    planCalls.incrementAndGet();
                    respond(ex, "{\"height\":\"" + appliedHeight + "\"}");
                });
        server.createContext(
                "/",
                ex -> {
                    JsonNode req = MAPPER.readTree(ex.getRequestBody().readAllBytes());
                    String txB64 = req.path("params").path(0).asText();
                    synchronized (broadcastTxs) {
                        broadcastTxs.add(java.util.Base64.getDecoder().decode(txB64));
                    }
                    if (upgradeOnFirstBroadcast) {
                        appliedHeight = "5746000";
                        upgradeOnFirstBroadcast = false;
                    }
                    String reply = broadcastReplies.isEmpty() ? OK : broadcastReplies.poll();
                    respond(ex, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + reply + "}");
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void respond(HttpExchange ex, String b) throws IOException {
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private PqcDx.HybridSendPath path(SignBytes.Mode mode) {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.pqcKeypair = Pqc.generatePqcKeypair(new byte[32]);
        s.fee = StdFee.of("uqor", "5000", "200000");
        s.chainId = CHAIN_ID;
        s.accountNumber = 7;
        s.sequence = 3;
        s.signBytesMode = mode;
        s.restUrl = baseUrl;
        s.signBytesResolver = new SignBytesResolver(60_000);
        PqcDx.EnsureOptions eo = new PqcDx.EnsureOptions();
        eo.status = new PqcDx.PqcStatus(true, 1, null); // already registered: no tx.
        return PqcDx.migrateToHybrid(s, new Broadcaster(baseUrl), null, eo);
    }

    private static List<TypedMessage> msgs() {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        return List.of(
                NativeTx.bankSend(acct.address, "qor1recipient", List.of(new StdFee.Coin("uqor", "10"))));
    }

    /** Which sign-bytes form the PQC signature in a broadcast tx verifies under. */
    private static SignBytes.Version signedForm(byte[] txRawBytes, PqcKeypair kp) throws Exception {
        cosmos.tx.v1beta1.TxOuterClass.TxRaw raw =
                cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(txRawBytes);
        cosmos.tx.v1beta1.TxOuterClass.TxBody body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(raw.getBodyBytes());
        Any ext = body.getExtensionOptions(0);
        byte[] sig =
                qorechain.pqc.v1.Hybrid.PQCHybridSignature.parseFrom(ext.getValue())
                        .getPqcSignature()
                        .toByteArray();
        byte[] b0 = body.toBuilder().clearExtensionOptions().build().toByteArray();
        byte[] a = raw.getAuthInfoBytes().toByteArray();
        if (Pqc.pqcVerify(kp.publicKey, SignBytes.hybridV2(CHAIN_ID, b0, a), sig)) {
            return SignBytes.Version.V2;
        }
        if (Pqc.pqcVerify(kp.publicKey, SignBytes.hybridV1(b0, a), sig)) {
            return SignBytes.Version.V1;
        }
        return null;
    }

    @Test
    void autoRetriesOnceAfterPqc21WithFreshVersion() throws Exception {
        appliedHeight = "0"; // resolver first answers v1 ...
        upgradeOnFirstBroadcast = true; // ... then the network is on v2.
        broadcastReplies.add(PQC_21);
        broadcastReplies.add(OK);

        PqcDx.HybridSendPath p = path(SignBytes.Mode.AUTO);
        Broadcaster.Result r = p.send(msgs());

        assertEquals("OKHASH", r.transactionHash);
        assertEquals(2, broadcastTxs.size());
        assertEquals(2, planCalls.get(), "the retry must force-refresh the resolver");
        assertEquals(SignBytes.Version.V1, signedForm(broadcastTxs.get(0), p.pqcKeypair));
        assertEquals(SignBytes.Version.V2, signedForm(broadcastTxs.get(1), p.pqcKeypair));
    }

    @Test
    void autoRetriesOnlyOnceThenSurfacesError() {
        appliedHeight = "5746000";
        broadcastReplies.add(PQC_21);
        broadcastReplies.add(PQC_21);

        PqcDx.HybridSendPath p = path(SignBytes.Mode.AUTO);
        TxError.QoreTxException e =
                assertThrows(TxError.QoreTxException.class, () -> p.send(msgs()));
        assertEquals(21, e.code);
        assertEquals("pqc", e.codespace);
        assertEquals(2, broadcastTxs.size());
    }

    @Test
    void explicitVersionNeverRetries() throws Exception {
        broadcastReplies.add(PQC_21);

        PqcDx.HybridSendPath p = path(SignBytes.Mode.V2);
        assertThrows(TxError.QoreTxException.class, () -> p.send(msgs()));
        assertEquals(1, broadcastTxs.size());
        assertEquals(0, planCalls.get(), "an explicit version needs no network lookup");
        assertEquals(SignBytes.Version.V2, signedForm(broadcastTxs.get(0), p.pqcKeypair));
    }

    @Test
    void code21FromAnotherCodespaceDoesNotRetry() {
        appliedHeight = "5746000";
        broadcastReplies.add(SDK_21);

        PqcDx.HybridSendPath p = path(SignBytes.Mode.AUTO);
        TxError.QoreTxException e =
                assertThrows(TxError.QoreTxException.class, () -> p.send(msgs()));
        assertEquals("sdk", e.codespace);
        assertEquals(1, broadcastTxs.size());
        assertEquals(1, planCalls.get());
    }

    @Test
    void autoResolvesAgainstLiveShapedEndpoint() throws Exception {
        appliedHeight = "5746000";
        PqcDx.HybridSendPath p = path(SignBytes.Mode.AUTO);
        assertEquals(SignBytes.Version.V2, p.resolveSignBytesVersion(false));
        assertEquals(SignBytes.Version.V2, p.buildHybridTx(msgs()).signBytesVersion);
        assertEquals(1, planCalls.get(), "second resolve is served from the cache");

        appliedHeight = "0";
        PqcDx.HybridSendPath fresh = path(SignBytes.Mode.AUTO);
        assertEquals(SignBytes.Version.V1, fresh.buildHybridTx(msgs()).signBytesVersion);
        assertTrue(planCalls.get() >= 2);
    }
}
