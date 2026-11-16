package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.pqc.KeyIntegrity;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.query.ChainUpgrades;
import io.github.qorechain.query.Http;
import io.github.qorechain.query.ProtocolFeatures;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytes.Version;
import io.github.qorechain.tx.SignBytesResolver;
import io.github.qorechain.tx.StdFee;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The upgrade-dependent "auto" choices read the chain's protocol feature switches
 * first: the hybrid sign-bytes version ({@code pqc-sign-bytes-v2}) and whether a PQC
 * key registration carries a proof of possession ({@code pqc-possession-flag}). They
 * fall back to the applied upgrade plans only when the node definitively does not
 * serve the switch, and fail loudly when the node could not be asked. A local HTTP
 * server plays the REST endpoint and the consensus RPC.
 */
class ProtocolFeaturesFirstTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CHAIN_ID = "qorechain-diana";
    private static final String OK =
            "{\"code\":0,\"hash\":\"OKHASH\",\"log\":\"\",\"codespace\":\"\"}";
    private static final String NOT_IMPLEMENTED =
            "{\"code\":12,\"message\":\"Not Implemented\",\"details\":[]}";

    private HttpServer server;
    private String baseUrl;

    /** What the protocol features route answers. */
    private volatile int featuresStatus = 200;
    private volatile String featuresBody = "{\"features\":[],\"height\":\"1\"}";
    /** The height every applied_plan query answers. */
    private volatile String planHeight = "0";

    private final AtomicInteger featureRequests = new AtomicInteger();
    private final AtomicInteger planRequests = new AtomicInteger();
    private final List<byte[]> broadcastTxs = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        PqcDx.clearProofOfPossessionCache();
        Authenticator.clearEvmAuthDigestCache();
        ChainUpgrades.clearCache();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                ProtocolFeatures.PATH,
                ex -> {
                    featureRequests.incrementAndGet();
                    respond(ex, featuresStatus, featuresBody);
                });
        server.createContext(
                "/cosmos/upgrade/v1beta1/applied_plan/",
                ex -> {
                    planRequests.incrementAndGet();
                    respond(ex, 200, "{\"height\":\"" + planHeight + "\"}");
                });
        server.createContext(
                "/",
                ex -> {
                    JsonNode req = MAPPER.readTree(ex.getRequestBody().readAllBytes());
                    synchronized (broadcastTxs) {
                        broadcastTxs.add(
                                java.util.Base64.getDecoder().decode(req.path("params").path(0).asText()));
                    }
                    respond(ex, 200, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + OK + "}");
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
        PqcDx.clearProofOfPossessionCache();
        Authenticator.clearEvmAuthDigestCache();
        ChainUpgrades.clearCache();
    }

    private static void respond(HttpExchange ex, int status, String b) throws IOException {
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private static String feature(String name, boolean enabled) {
        return "{\"name\":\"" + name + "\",\"enabled\":" + enabled + ",\"known\":true,\"staged\":false}";
    }

    private static String features(String... items) {
        return "{\"features\":[" + String.join(",", items) + "],\"height\":\"120\"}";
    }

    private static final String OTHER = feature("evm-locked-balance-scaling", true);

    private void serve(int status, String body) {
        featuresStatus = status;
        featuresBody = body;
    }

    /** A dead endpoint: a port that was just released. */
    private static String deadUrl() throws IOException {
        int port;
        try (java.net.ServerSocket s = new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            port = s.getLocalPort();
        }
        return "http://127.0.0.1:" + port;
    }

    // ---- shared classification ----

    @Test
    void classifyBodies() throws Exception {
        String n = SignBytesResolver.PQC_SIGN_BYTES_V2_FEATURE;
        assertEquals(
                ProtocolFeatures.State.ENABLED,
                ProtocolFeatures.classify(n, MAPPER.readTree(features(OTHER, feature(n, true)))).state);
        assertEquals(
                ProtocolFeatures.State.DISABLED,
                ProtocolFeatures.classify(n, MAPPER.readTree(features(feature(n, false)))).state);
        assertEquals(
                ProtocolFeatures.State.NOT_SERVED,
                ProtocolFeatures.classify(n, MAPPER.readTree(features(OTHER))).state);
        assertEquals(
                ProtocolFeatures.State.NOT_SERVED,
                ProtocolFeatures.classify(n, MAPPER.readTree(features())).state);
        assertEquals(
                ProtocolFeatures.State.NOT_SERVED, ProtocolFeatures.classify(n, MAPPER.readTree("{}")).state);
        assertEquals(ProtocolFeatures.State.ERROR, ProtocolFeatures.classify(n, MAPPER.readTree("[]")).state);
        assertEquals(ProtocolFeatures.State.ERROR, ProtocolFeatures.classify(n, null).state);
    }

    @Test
    void classifyFailures() {
        for (int status : new int[] {404, 501}) {
            assertEquals(
                    ProtocolFeatures.State.NOT_SERVED,
                    ProtocolFeatures.classifyFailure("x", new Http.QoreHttpException(status, "u", "")).state);
        }
        for (int status : new int[] {400, 403, 429, 500, 502, 503}) {
            assertEquals(
                    ProtocolFeatures.State.ERROR,
                    ProtocolFeatures.classifyFailure("x", new Http.QoreHttpException(status, "u", "")).state,
                    "HTTP " + status);
        }
        assertEquals(
                ProtocolFeatures.State.ERROR,
                ProtocolFeatures.classifyFailure("x", new IOException("connection refused")).state);
    }

    // ---- (A) hybrid sign-bytes version ----

    private static SignBytesResolver resolver() {
        Http.Options o = new Http.Options();
        o.retries = 0;
        o.timeoutMs = 5000;
        return new SignBytesResolver(SignBytesResolver.defaultFetcher(o), 60_000, System::currentTimeMillis);
    }

    private Version auto(SignBytesResolver r, String rest) {
        return r.resolve(SignBytes.Mode.AUTO, CHAIN_ID, rest);
    }

    @Test
    void signBytesFeatureEnabledIsV2WithoutPlans() {
        serve(200, features(OTHER, feature(SignBytesResolver.PQC_SIGN_BYTES_V2_FEATURE, true)));
        assertEquals(Version.V2, auto(resolver(), baseUrl));
        assertEquals(1, featureRequests.get());
        assertEquals(0, planRequests.get());
    }

    @Test
    void signBytesFeatureDisabledIsV1WithoutPlans() {
        serve(200, features(feature(SignBytesResolver.PQC_SIGN_BYTES_V2_FEATURE, false)));
        planHeight = "5746000";
        assertEquals(Version.V1, auto(resolver(), baseUrl));
        assertEquals(0, planRequests.get());
    }

    @Test
    void signBytesFeatureAbsentFallsBackToPlans() {
        serve(200, features(OTHER));
        planHeight = "5746000";
        assertEquals(Version.V2, auto(resolver(), baseUrl));
        assertEquals(1, planRequests.get());
    }

    @Test
    void signBytesEmptyListFallsBackToPlans() {
        serve(200, features());
        planHeight = "0";
        assertEquals(Version.V1, auto(resolver(), baseUrl));
        assertEquals(SignBytes.SIGN_BYTES_V2_UPGRADES.size(), planRequests.get());
    }

    @Test
    void signBytes404FallsBackToPlans() {
        serve(404, NOT_IMPLEMENTED);
        planHeight = "5746000";
        assertEquals(Version.V2, auto(resolver(), baseUrl));
        assertEquals(1, planRequests.get());
    }

    @Test
    void signBytes501FallsBackToPlans() {
        serve(501, NOT_IMPLEMENTED);
        planHeight = "5746000";
        assertEquals(Version.V2, auto(resolver(), baseUrl));
        assertEquals(1, planRequests.get());
    }

    @Test
    void signBytesServerErrorThrowsWithoutPlans() {
        for (int status : new int[] {500, 503, 429}) {
            serve(status, "{\"message\":\"busy\"}");
            planHeight = "5746000";
            SignBytesResolver.SignBytesResolutionException e =
                    assertThrows(
                            SignBytesResolver.SignBytesResolutionException.class,
                            () -> auto(resolver(), baseUrl),
                            "HTTP " + status);
            assertTrue(e.getMessage().contains("could not be asked"), e.getMessage());
            assertTrue(e.getMessage().contains("explicit sign-bytes version"), e.getMessage());
            assertEquals(0, planRequests.get(), "no plan asked on HTTP " + status);
        }
    }

    @Test
    void signBytesUnparsableBodyThrows() {
        serve(200, "not json");
        assertThrows(SignBytesResolver.SignBytesResolutionException.class, () -> auto(resolver(), baseUrl));
        assertEquals(0, planRequests.get());
    }

    @Test
    void signBytesConnectionRefusedThrows() throws IOException {
        String dead = deadUrl();
        SignBytesResolver.SignBytesResolutionException e =
                assertThrows(SignBytesResolver.SignBytesResolutionException.class, () -> auto(resolver(), dead));
        assertTrue(e.getMessage().contains("explicit sign-bytes version"));
    }

    @Test
    void signBytesExplicitVersionMakesNoRequest() {
        SignBytesResolver r = resolver();
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.V1, CHAIN_ID, baseUrl));
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.V2, CHAIN_ID, baseUrl));
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.AUTO, "some-new-chain", baseUrl));
        assertEquals(0, featureRequests.get());
        assertEquals(0, planRequests.get());
    }

    @Test
    void signBytesAnswerCachedWithinTtlErrorsNot() {
        AtomicLong now = new AtomicLong(1_000);
        Http.Options o = new Http.Options();
        o.retries = 0;
        SignBytesResolver r = new SignBytesResolver(SignBytesResolver.defaultFetcher(o), 60_000, now::get);

        // A failure is not cached: the next call asks again.
        serve(500, "{}");
        assertThrows(SignBytesResolver.SignBytesResolutionException.class, () -> auto(r, baseUrl));
        serve(200, features(feature(SignBytesResolver.PQC_SIGN_BYTES_V2_FEATURE, true)));
        assertEquals(Version.V2, auto(r, baseUrl));
        assertEquals(2, featureRequests.get());

        // Within the TTL the answer is reused, even through a hiccup.
        serve(500, "{}");
        now.addAndGet(30_000);
        assertEquals(Version.V2, auto(r, baseUrl));
        assertEquals(2, featureRequests.get());

        // Past it the node is asked again.
        now.addAndGet(31_000);
        assertThrows(SignBytesResolver.SignBytesResolutionException.class, () -> auto(r, baseUrl));
        assertEquals(3, featureRequests.get());
    }

    // ---- (B) proof of possession on PQC key registration ----

    private static final String POP = KeyIntegrity.POSSESSION_FLAG_FEATURE;

    @Test
    void possessionFeatureNameMatchesTheChain() {
        assertEquals("pqc-possession-flag", POP);
    }

    @Test
    void possessionFeatureEnabledAttaches() {
        serve(200, features(OTHER, feature(POP, true)));
        assertTrue(PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID));
        assertEquals(0, planRequests.get());
    }

    @Test
    void possessionFeatureDisabledDoesNotAttach() {
        serve(200, features(feature(POP, false)));
        planHeight = "6000000";
        assertFalse(PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID));
        assertEquals(0, planRequests.get());
    }

    @Test
    void possessionNotServedFallsBackToPlan() {
        String[][] cases = {
            {"200", features(OTHER)}, {"200", features()}, {"404", NOT_IMPLEMENTED}, {"501", NOT_IMPLEMENTED}
        };
        for (String[] c : cases) {
            for (String height : new String[] {"6000000", "0"}) {
                PqcDx.clearProofOfPossessionCache();
                ChainUpgrades.clearCache();
                planRequests.set(0);
                serve(Integer.parseInt(c[0]), c[1]);
                planHeight = height;
                assertEquals(
                        !height.equals("0"),
                        PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID),
                        "HTTP " + c[0] + " " + c[1] + ", plan " + height);
                assertEquals(1, planRequests.get());
            }
        }
    }

    @Test
    void possessionServerErrorThrowsWithoutPlan() {
        serve(500, "{\"message\":\"busy\"}");
        planHeight = "6000000";
        ProtocolFeatures.FeatureQueryException e =
                assertThrows(
                        ProtocolFeatures.FeatureQueryException.class,
                        () -> PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID));
        assertTrue(e.getMessage().contains("could not be asked"));
        assertTrue(e.getMessage().contains("attachProofOfPossession"));
        assertEquals(0, planRequests.get());
    }

    @Test
    void possessionConnectionRefusedThrows() throws IOException {
        String dead = deadUrl();
        assertThrows(
                ProtocolFeatures.FeatureQueryException.class,
                () -> PqcDx.proofOfPossessionAccepted(dead, CHAIN_ID));
    }

    @Test
    void possessionAnswerCachedWithinTtl() {
        serve(200, features(feature(POP, true)));
        assertTrue(PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID));
        serve(500, "{}");
        assertTrue(PqcDx.proofOfPossessionAccepted(baseUrl, CHAIN_ID));
        assertTrue(PqcDx.proofOfPossessionAccepted(baseUrl + "/", CHAIN_ID));
        assertEquals(1, featureRequests.get());
        // Keyed per chain id too.
        assertThrows(
                ProtocolFeatures.FeatureQueryException.class,
                () -> PqcDx.proofOfPossessionAccepted(baseUrl, "qorechain-vladi"));
    }

    private PqcDx.Signer signer() {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.pqcKeypair = Pqc.generatePqcKeypair(new byte[32]);
        s.fee = StdFee.of("uqor", "5000", "200000");
        s.chainId = CHAIN_ID;
        s.accountNumber = 7;
        s.sequence = 0;
        s.restUrl = baseUrl;
        return s;
    }

    private PqcDx.EnsureOptions unregistered() {
        PqcDx.EnsureOptions eo = new PqcDx.EnsureOptions();
        eo.status = new PqcDx.PqcStatus(false, 0, null);
        return eo;
    }

    private byte[] registeredProof() throws Exception {
        byte[] raw;
        synchronized (broadcastTxs) {
            assertEquals(1, broadcastTxs.size());
            raw = broadcastTxs.get(0);
        }
        cosmos.tx.v1beta1.TxOuterClass.TxBody body =
                cosmos.tx.v1beta1.TxOuterClass.TxBody.parseFrom(
                        cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(raw).getBodyBytes());
        return qorechain.pqc.v1.Tx.MsgRegisterPQCKeyV2.parseFrom(body.getMessages(0).getValue())
                .getProofOfPossession()
                .toByteArray();
    }

    @Test
    void ensureRegisteredAttachesProofWhenFeatureEnabled() throws Exception {
        serve(200, features(feature(POP, true)));
        PqcDx.Signer s = signer();
        PqcDx.ensurePqcRegistered(s, new Broadcaster(baseUrl), null, unregistered());
        byte[] proof = registeredProof();
        assertTrue(proof.length > 0);
        assertTrue(KeyIntegrity.verifyProofOfPossession(CHAIN_ID, s.sender, s.pqcKeypair.publicKey, proof));
        assertEquals(0, planRequests.get());
    }

    @Test
    void ensureRegisteredOmitsProofWhenFeatureDisabled() throws Exception {
        serve(200, features(feature(POP, false)));
        PqcDx.ensurePqcRegistered(signer(), new Broadcaster(baseUrl), null, unregistered());
        assertEquals(0, registeredProof().length);
    }

    @Test
    void ensureRegisteredFailsLoudlyWhenNodeCannotBeAsked() {
        serve(503, "{}");
        assertThrows(
                ProtocolFeatures.FeatureQueryException.class,
                () -> PqcDx.ensurePqcRegistered(signer(), new Broadcaster(baseUrl), null, unregistered()));
        assertTrue(broadcastTxs.isEmpty(), "nothing broadcast");
        assertEquals(0, planRequests.get());
    }

    @Test
    void ensureRegisteredExplicitChoiceMakesNoRequest() throws Exception {
        serve(500, "{}"); // would fail if asked

        PqcDx.EnsureOptions skip = unregistered();
        skip.attachProofOfPossession = Boolean.FALSE;
        PqcDx.ensurePqcRegistered(signer(), new Broadcaster(baseUrl), null, skip);
        assertEquals(0, registeredProof().length);
        broadcastTxs.clear();

        PqcDx.EnsureOptions attach = unregistered();
        attach.attachProofOfPossession = Boolean.TRUE;
        PqcDx.ensurePqcRegistered(signer(), new Broadcaster(baseUrl), null, attach);
        assertTrue(registeredProof().length > 0);
        broadcastTxs.clear();

        PqcDx.EnsureOptions given = unregistered();
        given.proofOfPossession = new byte[] {1, 2, 3};
        PqcDx.ensurePqcRegistered(signer(), new Broadcaster(baseUrl), null, given);
        assertEquals(3, registeredProof().length);

        assertEquals(0, featureRequests.get());
        assertEquals(0, planRequests.get());
    }

    // ---- (C) MsgExecuteEVM digest version ----

    private static final String HARDENING = Authenticator.ABSTRACTACCOUNT_HARDENING_FEATURE;

    private String digest(String rest) {
        return Authenticator.evmAuthDigestVersion(new RestClient(rest), rest);
    }

    @Test
    void hardeningFeatureNameMatchesTheChain() {
        assertEquals("abstractaccount-hardening", HARDENING);
    }

    @Test
    void evmDigestFeatureEnabledIsV2WithoutPlan() {
        serve(200, features(OTHER, feature(HARDENING, true)));
        assertEquals("v2", digest(baseUrl));
        assertEquals(0, planRequests.get());
    }

    @Test
    void evmDigestFeatureDisabledIsV1WithoutPlan() {
        serve(200, features(feature(HARDENING, false)));
        planHeight = "6000000";
        assertEquals("v1", digest(baseUrl));
        assertEquals(0, planRequests.get());
    }

    @Test
    void evmDigestNotServedFallsBackToPlan() {
        String[][] cases = {
            {"200", features(OTHER)}, {"200", features()}, {"200", "{}"},
            {"404", NOT_IMPLEMENTED}, {"501", NOT_IMPLEMENTED}
        };
        for (String[] c : cases) {
            for (String height : new String[] {"6000000", "0"}) {
                Authenticator.clearEvmAuthDigestCache();
                ChainUpgrades.clearCache();
                planRequests.set(0);
                serve(Integer.parseInt(c[0]), c[1]);
                planHeight = height;
                assertEquals(
                        height.equals("0") ? "v1" : "v2",
                        digest(baseUrl),
                        "HTTP " + c[0] + " " + c[1] + ", plan " + height);
                assertEquals(1, planRequests.get());
            }
        }
    }

    @Test
    void evmDigestServerErrorThrowsWithoutPlan() {
        serve(500, "{\"message\":\"busy\"}");
        planHeight = "6000000";
        ProtocolFeatures.FeatureQueryException e =
                assertThrows(ProtocolFeatures.FeatureQueryException.class, () -> digest(baseUrl));
        assertTrue(e.getMessage().contains("could not be asked"));
        assertTrue(e.getMessage().contains("evmAuthSignBytesV2"));
        assertEquals(0, planRequests.get());
    }

    @Test
    void evmDigestConnectionRefusedThrows() throws IOException {
        String dead = deadUrl();
        assertThrows(ProtocolFeatures.FeatureQueryException.class, () -> digest(dead));
    }

    @Test
    void evmDigestAnswerCachedWithinTtlErrorsNot() {
        // A failure is not cached.
        serve(500, "{}");
        assertThrows(ProtocolFeatures.FeatureQueryException.class, () -> digest(baseUrl));
        int afterError = featureRequests.get();
        serve(200, features(feature(HARDENING, true)));
        assertEquals("v2", digest(baseUrl));
        assertEquals(afterError + 1, featureRequests.get());
        // Within the TTL the answer is reused, even through a hiccup.
        serve(500, "{}");
        assertEquals("v2", digest(baseUrl));
        assertEquals(afterError + 1, featureRequests.get());
        // No cache key: asked every time.
        assertThrows(
                ProtocolFeatures.FeatureQueryException.class,
                () -> Authenticator.evmAuthDigestVersion(new RestClient(baseUrl), null));
    }
}
