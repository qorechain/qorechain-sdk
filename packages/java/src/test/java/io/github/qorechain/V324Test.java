package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.messages.CosmosMessages;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.query.ChainUpgrades;
import io.github.qorechain.query.ProtocolFeatures;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.stakingtier.StakingTier;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.TxError;
import java.io.IOException;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import qorechain.stakingtier.v1.Tx.MsgClaimBonus;
import qorechain.stakingtier.v1.Tx.MsgLockDelegation;
import qorechain.stakingtier.v1.Tx.MsgUnlockEarly;

/** Client support for chain v3.2.4. */
class V324Test {

    private static final String ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
    private static final String VAL = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk";

    private HttpServer server;
    private String baseUrl;
    /** Canned bodies by exact request path. */
    private final Map<String, String> bodies = new ConcurrentHashMap<>();
    private final List<String> paths = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        PqcDx.clearPqcStatusCache();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    String p = ex.getRequestURI().getRawPath();
                    synchronized (paths) {
                        paths.add(p);
                    }
                    String b = bodies.get(p);
                    if (b == null) {
                        respond(ex, 404, "{\"code\":5,\"message\":\"not found\"}");
                    } else {
                        respond(ex, 200, b);
                    }
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void respond(HttpExchange ex, int status, String b) throws IOException {
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private RestClient rest() {
        return new RestClient(baseUrl + "/");
    }

    private static MsgLockDelegation lock(String validator, String amount, int months) {
        return MsgLockDelegation.newBuilder()
                .setDelegator(ADDR)
                .setValidator(validator)
                .setAmount(amount)
                .setMonths(months)
                .build();
    }

    // ---- staking tiers ----

    @Test
    void lockDelegationEncodesAndRoundTripsThroughTheRegistry() throws Exception {
        MsgLockDelegation back =
                (MsgLockDelegation)
                        Messages.unpack(Messages.pack(QorechainMessages.stakingtier.lockDelegation(lock(VAL, "10000000", 6))));
        assertEquals("/qorechain.stakingtier.v1.MsgLockDelegation",
                QorechainMessages.stakingtier.lockDelegation(lock(VAL, "10000000", 6)).typeUrl);
        assertEquals(ADDR, back.getDelegator());
        assertEquals(VAL, back.getValidator());
        assertEquals("10000000", back.getAmount());
        assertEquals(6, back.getMonths());
    }

    @Test
    void lockDelegationAppliesTheChainsChecks() {
        assertEquals(List.of(3, 6, 12), StakingTier.STAKING_LOCK_MONTHS);
        IllegalArgumentException e =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> QorechainMessages.stakingtier.lockDelegation(lock(VAL, "10000000", 4)));
        assertTrue(e.getMessage().contains("months must be one of 3, 6, 12"));
        assertTrue(
                assertThrows(
                                IllegalArgumentException.class,
                                () -> QorechainMessages.stakingtier.lockDelegation(lock(VAL, "0", 3)))
                        .getMessage()
                        .contains("positive integer"));
        assertTrue(
                assertThrows(
                                IllegalArgumentException.class,
                                () -> QorechainMessages.stakingtier.lockDelegation(lock(VAL, "1.5", 3)))
                        .getMessage()
                        .contains("positive integer"));
        assertTrue(
                assertThrows(
                                IllegalArgumentException.class,
                                () -> QorechainMessages.stakingtier.lockDelegation(lock("", "10000000", 3)))
                        .getMessage()
                        .contains("validator"));
    }

    @Test
    void unlockEarlyAndClaimBonusAreRegistered() throws Exception {
        MsgUnlockEarly u = MsgUnlockEarly.newBuilder().setDelegator(ADDR).setLockId(7).build();
        assertEquals(
                "/qorechain.stakingtier.v1.MsgUnlockEarly",
                Messages.pack(QorechainMessages.stakingtier.unlockEarly(u)).getTypeUrl());
        assertEquals(7, ((MsgUnlockEarly) Messages.unpack(Messages.pack(QorechainMessages.stakingtier.unlockEarly(u)))).getLockId());
        assertEquals(
                "/qorechain.stakingtier.v1.MsgClaimBonus",
                Messages.pack(QorechainMessages.stakingtier.claimBonus(MsgClaimBonus.newBuilder().setHolder(ADDR).build()))
                        .getTypeUrl());
        assertTrue(Messages.isRegistered("/qorechain.stakingtier.v1.MsgUpdateParams"));
    }

    @Test
    void readsParamsLocksAndPool() {
        bodies.put(
                "/qorechain/stakingtier/v1/params",
                "{\"lock_tiers\":[{\"months\":3,\"bonus_bps\":150},{\"months\":12,\"bonus_bps\":500}],"
                        + "\"light_node_bonus_bps\":200,\"validator_bonus_bps\":300,\"max_total_apy_bps\":2500,"
                        + "\"early_unlock_penalty_bps\":500,\"enabled\":true,\"min_lock_amount\":\"10000000\"}");
        StakingTier.Params params = StakingTier.fetchParams(rest());
        assertEquals(2, params.lockTiers.size());
        assertEquals(3, params.lockTiers.get(0).months);
        assertEquals(150, params.lockTiers.get(0).bonusBps);
        assertEquals(12, params.lockTiers.get(1).months);
        assertEquals(500, params.lockTiers.get(1).bonusBps);
        assertEquals(BigInteger.valueOf(10_000_000), params.minLockAmount);
        assertTrue(params.enabled);
        assertEquals(2500, params.maxTotalApyBps);

        bodies.put(
                "/qorechain/stakingtier/v1/locks/" + ADDR,
                "{\"locks\":[{\"id\":\"1\",\"validator\":\"" + VAL + "\",\"locked_amount\":\"20000000\",\"months\":6,"
                        + "\"end_time\":\"1800000000\",\"accrued_bonus\":\"5\",\"released\":false}],"
                        + "\"claimable\":\"5\",\"total_claimable\":\"5\"}");
        StakingTier.Locks locks = StakingTier.fetchLocks(rest(), ADDR);
        assertEquals("/qorechain/stakingtier/v1/locks/" + ADDR, paths.get(paths.size() - 1));
        StakingTier.Lock l = locks.locks.get(0);
        assertEquals(1L, l.id);
        assertEquals(BigInteger.valueOf(20_000_000), l.lockedAmount);
        assertEquals(6, l.months);
        assertEquals(1_800_000_000L, l.endTime);
        assertFalse(l.released);
        assertEquals(BigInteger.valueOf(5), locks.claimable);

        bodies.put(
                "/qorechain/stakingtier/v1/pool",
                "{\"balance\":\"0\",\"lock_count\":\"3\",\"last_base_apy_bps\":\"4510.47\"}");
        StakingTier.Pool pool = StakingTier.fetchPool(rest());
        assertEquals(3L, pool.lockCount);
        assertEquals("4510.47", pool.lastBaseApyBps);
        assertEquals(BigInteger.ZERO, pool.balance);
    }

    @Test
    void decodesTheModulesErrors() {
        assertEquals("stakingtier_invalid_term", TxError.decode(5, "stakingtier", "", "").kind);
        assertEquals("stakingtier_stake_locked", TxError.decode(13, "stakingtier", "", "").kind);
    }

    // ---- chain v3.2.4 reads ----

    @Test
    void protocolFeatures() {
        bodies.put(
                "/qorechain/pqc/v1/protocol_features",
                "{\"features\":[{\"name\":\"pqc-sign-bytes-v2\",\"enabled\":true,\"known\":true,\"staged\":false},"
                        + "{\"name\":\"x\",\"enabled\":false,\"known\":true,\"staged\":true}],\"height\":\"3758400\"}");
        ProtocolFeatures r = ProtocolFeatures.fetch(rest());
        assertEquals(3_758_400L, r.height);
        ProtocolFeatures.Feature x = r.features.get(1);
        assertEquals("x", x.name);
        assertFalse(x.enabled);
        assertTrue(x.known);
        assertTrue(x.staged);
        assertTrue(ProtocolFeatures.isEnabled(rest(), "pqc-sign-bytes-v2"));
        assertFalse(ProtocolFeatures.isEnabled(rest(), "x"));
        assertFalse(ProtocolFeatures.isEnabled(rest(), "absent"));
    }

    @Test
    void authNonceBytesOrHexKeyTheKeysOwnCounter() {
        bodies.put("/qorechain/abstractaccount/v1/auth_nonce/" + ADDR + "/ab01", "{\"nonce\":\"7\",\"linked\":true}");
        bodies.put("/qorechain/abstractaccount/v1/auth_nonce/" + ADDR + "/AB01", "{\"nonce\":\"7\",\"linked\":true}");
        Authenticator.AuthNonce r = Authenticator.fetchAuthNonce(rest(), ADDR, new byte[] {(byte) 0xab, 0x01});
        assertEquals(7L, r.nonce);
        assertTrue(r.linked);
        assertEquals("/qorechain/abstractaccount/v1/auth_nonce/" + ADDR + "/ab01", paths.get(0));
        Authenticator.fetchAuthNonce(rest(), ADDR, "0xAB01");
        assertTrue(paths.get(1).endsWith("/AB01"));
        int before = paths.size();
        for (String bad : new String[] {"zz", "", "0x", "abc"}) {
            assertTrue(
                    assertThrows(IllegalArgumentException.class, () -> Authenticator.fetchAuthNonce(rest(), ADDR, bad))
                            .getMessage()
                            .contains("hex"));
        }
        assertEquals(before, paths.size());
    }

    @Test
    void pqcStatusCarriesPossessionProven() {
        bodies.put(
                "/qorechain/pqc/v1/account/" + ADDR,
                "{\"found\":true,\"account\":{\"public_key\":\"AQID\",\"possession_proven\":true}}");
        PqcDx.PqcStatus s = PqcDx.fetchPqcStatus(baseUrl, ADDR);
        assertEquals(Boolean.TRUE, s.possessionProven);
        // Cached with the rest of the status.
        assertEquals(Boolean.TRUE, PqcDx.fetchPqcStatus(baseUrl, ADDR).possessionProven);
        assertEquals(1, paths.size());

        PqcDx.clearPqcStatusCache();
        bodies.put("/qorechain/pqc/v1/account/" + ADDR, "{\"found\":true,\"account\":{\"public_key\":\"AQID\"}}");
        assertNull(PqcDx.fetchPqcStatus(baseUrl, ADDR).possessionProven);
    }

    @Test
    void ibcTimeoutTimestampIsAnAbsoluteUnixTimeInNanoseconds() {
        Instant now = Instant.parse("2026-10-25T00:00:00Z");
        assertEquals((now.toEpochMilli() + 600_000L) * 1_000_000L, CosmosMessages.ibcTimeoutTimestamp(600, now));
        assertTrue(
                assertThrows(IllegalArgumentException.class, () -> CosmosMessages.ibcTimeoutTimestamp(0))
                        .getMessage()
                        .contains("positive"));
        assertThrows(IllegalArgumentException.class, () -> CosmosMessages.ibcTimeoutTimestamp(-1, now));
    }

    @Test
    void upgradeConstant() {
        assertEquals("v3.2.4", ChainUpgrades.V3_2_4);
    }
}
