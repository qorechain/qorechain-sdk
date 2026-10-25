package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcAlgorithm;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.query.QorClient;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.tx.TxError;
import io.github.qorechain.utils.Hex;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** ensurePqcRegistered compares the registered key with the signer's. */
class PqcKeyMismatchTest {

    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";
    private static final PqcKeypair MINE = Pqc.generatePqcKeypair(fill(2));
    private static final PqcKeypair OTHER = Pqc.generatePqcKeypair(fill(3));

    private HttpServer server;
    private String baseUrl;
    /** The keys the REST route reports, one per read (the last repeats); null = not found. */
    private volatile List<byte[]> restKeys = List.of();
    private volatile boolean restUrlSafe;
    private final List<String> restPaths = new ArrayList<>();
    private final List<String> broadcasts = new ArrayList<>();
    private volatile String broadcastResult = "{\"code\":0,\"hash\":\"DEADBEEF\",\"log\":\"\"}";
    private volatile String qorStatusJson = "{\"registered\":false}";

    private static byte[] fill(int b) {
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) b);
        return seed;
    }

    @BeforeEach
    void start() throws IOException {
        PqcDx.clearPqcStatusCache();
        io.github.qorechain.query.ChainUpgrades.clearCache();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/cosmos/upgrade/v1beta1/applied_plan/", ex -> respond(ex, "{\"height\":\"0\"}"));
        server.createContext(
                "/qorechain/pqc/v1/account/",
                ex -> {
                    int i;
                    synchronized (restPaths) {
                        i = restPaths.size();
                        restPaths.add(ex.getRequestURI().getPath());
                    }
                    List<byte[]> keys = restKeys;
                    byte[] k = keys.isEmpty() ? null : keys.get(Math.min(i, keys.size() - 1));
                    if (k == null) {
                        respond(ex, "{\"found\":false,\"account\":null}");
                    } else {
                        Base64.Encoder enc = restUrlSafe ? Base64.getUrlEncoder() : Base64.getEncoder();
                        respond(ex, "{\"found\":true,\"account\":{\"public_key\":\"" + enc.encodeToString(k) + "\"}}");
                    }
                });
        server.createContext(
                "/",
                ex -> {
                    String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    if (body.contains("broadcast_tx")) {
                        broadcasts.add(body);
                        respond(ex, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + broadcastResult + "}");
                    } else {
                        respond(ex, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + qorStatusJson + "}");
                    }
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

    private PqcDx.Signer signer(boolean withRest) {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.pqcKeypair = MINE;
        s.fee = StdFee.of("uqor", "5000", "200000");
        s.chainId = "qorechain-diana";
        s.accountNumber = 7;
        s.sequence = 3;
        s.signBytesMode = io.github.qorechain.tx.SignBytes.Mode.V2;
        if (withRest) {
            s.restUrl = baseUrl;
        }
        return s;
    }

    private Broadcaster bc() {
        return new Broadcaster(baseUrl);
    }

    private static PqcDx.EnsureOptions withStatus(PqcDx.PqcStatus st) {
        PqcDx.EnsureOptions o = new PqcDx.EnsureOptions();
        o.status = st;
        return o;
    }

    @Test
    void throwsAndSendsNothingWhenAnotherKeyIsRegistered() {
        restKeys = List.of(OTHER.publicKey);
        PqcDx.Signer s = signer(true);
        PqcDx.PqcKeyMismatchException e =
                assertThrows(
                        PqcDx.PqcKeyMismatchException.class,
                        () -> PqcDx.ensurePqcRegistered(s, bc(), null, null));
        assertEquals("pqc_key_mismatch", e.kind);
        assertEquals(s.sender, e.address);
        assertArrayEquals(OTHER.publicKey, e.registeredPublicKey);
        assertArrayEquals(MINE.publicKey, e.publicKey);
        assertTrue(e.getMessage().contains("different PQC key"));
        assertTrue(e.getMessage().contains("Nothing was sent"));
        assertEquals(0, broadcasts.size());
        // The mismatch is confirmed with a fresh (uncached) read before throwing.
        assertEquals(2, restPaths.size());
    }

    @Test
    void reReadsBeforeThrowingSoACachedKeyFromBeforeARotationIsNoFalseAlarm() {
        PqcDx.Signer s = signer(true);
        restKeys = List.of(OTHER.publicKey);
        PqcDx.fetchPqcStatus(baseUrl, s.sender); // cached: the old key
        restKeys = List.of(MINE.publicKey, MINE.publicKey);
        assertTrue(PqcDx.ensurePqcRegistered(s, bc(), null, null).alreadyRegistered);
        assertEquals(0, broadcasts.size());
    }

    @Test
    void migrateToHybridRefusesToBindAKeypairTheChainDoesNotHold() {
        restKeys = List.of(OTHER.publicKey);
        assertThrows(
                PqcDx.PqcKeyMismatchException.class,
                () -> PqcDx.migrateToHybrid(signer(true), bc(), null, null));
        assertEquals(0, broadcasts.size());
    }

    @Test
    void checksAPreReadStatusAndAHexStatusFromQor() {
        PqcDx.Signer s = signer(false);
        assertThrows(
                PqcDx.PqcKeyMismatchException.class,
                () ->
                        PqcDx.ensurePqcRegistered(
                                s, bc(), null,
                                withStatus(new PqcDx.PqcStatus(true, PqcAlgorithm.ALGORITHM_DILITHIUM5, OTHER.publicKey))));
        PqcDx.EnsureResult ok =
                PqcDx.ensurePqcRegistered(
                        s, bc(), null,
                        withStatus(new PqcDx.PqcStatus(true, PqcAlgorithm.ALGORITHM_DILITHIUM5, MINE.publicKey)));
        assertTrue(ok.alreadyRegistered);
        assertEquals(Boolean.TRUE, ok.keyVerified);
        // qor_getPQCKeyStatus reports the key hex.
        qorStatusJson = "{\"registered\":true,\"public_key\":\"0x" + Hex.encode(OTHER.publicKey) + "\"}";
        assertThrows(
                PqcDx.PqcKeyMismatchException.class,
                () -> PqcDx.ensurePqcRegistered(s, bc(), new QorClient(baseUrl), null));
        qorStatusJson = "{\"registered\":true,\"public_key\":\"" + Hex.encode(MINE.publicKey) + "\"}";
        assertTrue(PqcDx.ensurePqcRegistered(s, bc(), new QorClient(baseUrl), null).alreadyRegistered);
        assertEquals(0, broadcasts.size());
        assertEquals(0, restPaths.size());
    }

    @Test
    void doesNotCountAStatusWithoutAKeyAsAMatch() {
        PqcDx.PqcStatus keyless = new PqcDx.PqcStatus(true, PqcAlgorithm.ALGORITHM_DILITHIUM5, null);
        // Nothing to read the key from: registered, but not verified as the signer's.
        PqcDx.EnsureResult r = PqcDx.ensurePqcRegistered(signer(false), bc(), null, withStatus(keyless));
        assertTrue(r.alreadyRegistered);
        assertEquals(Boolean.FALSE, r.keyVerified);
        // A qor_* answer without the key, and no REST URL: the same.
        qorStatusJson = "{\"registered\":true}";
        r = PqcDx.ensurePqcRegistered(signer(false), bc(), new QorClient(baseUrl), null);
        assertTrue(r.alreadyRegistered);
        assertEquals(Boolean.FALSE, r.keyVerified);
        assertEquals(0, restPaths.size());
        // With a REST URL, the key is read and compared.
        restKeys = List.of(MINE.publicKey);
        r = PqcDx.ensurePqcRegistered(signer(true), bc(), null, withStatus(keyless));
        assertTrue(r.alreadyRegistered);
        assertEquals(Boolean.TRUE, r.keyVerified);
        assertEquals(1, restPaths.size());
        PqcDx.clearPqcStatusCache();
        restKeys = List.of(OTHER.publicKey);
        assertThrows(
                PqcDx.PqcKeyMismatchException.class,
                () -> PqcDx.ensurePqcRegistered(signer(true), bc(), null, withStatus(keyless)));
        assertEquals(0, broadcasts.size());
    }

    @Test
    void onTheAlreadyRegisteredRefusalReadsTheKeyAndThrowsIfItIsNotTheSigners() {
        broadcastResult =
                "{\"code\":7,\"codespace\":\"pqc\",\"hash\":\"AB\",\"log\":\"PQC account already registered\"}";
        // First read: not registered. Then someone registers OTHER before the tx lands.
        restKeys = Arrays.asList(null, OTHER.publicKey);
        assertThrows(
                PqcDx.PqcKeyMismatchException.class,
                () -> PqcDx.ensurePqcRegistered(signer(true), bc(), null, null));
        assertEquals(1, broadcasts.size());

        PqcDx.clearPqcStatusCache();
        synchronized (restPaths) {
            restPaths.clear();
        }
        restKeys = Arrays.asList(null, MINE.publicKey);
        PqcDx.EnsureResult r = PqcDx.ensurePqcRegistered(signer(true), bc(), null, null);
        assertTrue(r.alreadyRegistered);
        assertEquals(Boolean.TRUE, r.keyVerified);

        // No REST URL to read the key back from: registered, not verified.
        PqcDx.EnsureOptions force = new PqcDx.EnsureOptions();
        force.force = true;
        r = PqcDx.ensurePqcRegistered(signer(false), bc(), null, force);
        assertTrue(r.alreadyRegistered);
        assertEquals(Boolean.FALSE, r.keyVerified);
    }

    @Test
    void anyOtherCheckTxRefusalIsATxErrorNotARegistration() {
        broadcastResult =
                "{\"code\":13,\"codespace\":\"sdk\",\"hash\":\"FEE13\",\"log\":\"insufficient fee\"}";
        restKeys = Arrays.asList((byte[]) null);
        TxError.QoreTxException e =
                assertThrows(
                        TxError.QoreTxException.class,
                        () -> PqcDx.ensurePqcRegistered(signer(true), bc(), null, null));
        assertEquals(13, e.code);
        assertEquals("sdk", e.codespace);
        assertEquals("insufficient fee", e.rawLog);
        assertEquals("FEE13", e.txHash);
        assertEquals(1, broadcasts.size());
        // migrateToHybrid stops there too.
        assertThrows(
                TxError.QoreTxException.class,
                () -> PqcDx.migrateToHybrid(signer(true), bc(), null, null));
    }

    @Test
    void checkTxCodeZeroReturnsTheHash() {
        restKeys = Arrays.asList((byte[]) null);
        PqcDx.EnsureResult r = PqcDx.ensurePqcRegistered(signer(true), bc(), null, null);
        assertFalse(r.alreadyRegistered);
        assertEquals("DEADBEEF", r.txHash);
    }

    @Test
    void thePositiveCacheKeepsTheKey() {
        restKeys = List.of(MINE.publicKey);
        restUrlSafe = true;
        String addr = signer(false).sender;
        PqcDx.fetchPqcStatus(baseUrl, addr);
        PqcDx.PqcStatus again = PqcDx.fetchPqcStatus(baseUrl, addr);
        assertEquals(1, restPaths.size());
        assertArrayEquals(MINE.publicKey, PqcDx.pqcStatusPublicKey(again));
        assertEquals(Boolean.TRUE, PqcDx.isRegisteredPqcKey(again, MINE.publicKey));
        assertEquals(Boolean.FALSE, PqcDx.isRegisteredPqcKey(again, OTHER.publicKey));
        assertNull(
                PqcDx.isRegisteredPqcKey(
                        new PqcDx.PqcStatus(true, PqcAlgorithm.ALGORITHM_UNSPECIFIED, null), MINE.publicKey));
    }
}
