package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.SpendingRules;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.KemRegistry;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.query.ChainUpgrades;
import io.github.qorechain.tx.AutoGas;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.tx.TxError;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import qorechain.abstractaccount.v1.Tx.DenomLimit;
import qorechain.abstractaccount.v1.Tx.MsgUpdateSpendingRules;
import qorechain.abstractaccount.v1.Tx.SpendingRule;

/** Client support for chain v3.2.5. */
class V325Test {

    private static final String ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
    private static final String GOV = "qor10d07y265gmmuvt4z0w9aw880jnsr700jl49mzl";
    private static final String MNEMONIC =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    private static final String TOKEN = "0x" + "ab".repeat(20);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private HttpServer server;
    private String baseUrl;
    private final AtomicLong appliedHeight = new AtomicLong(0);
    private final AtomicLong simulatedGas = new AtomicLong(166_300);
    private volatile String simulateError;
    private final List<String> paths = new ArrayList<>();
    private final List<byte[]> broadcasts = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        ChainUpgrades.clearCache();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                ex -> {
                    String p = ex.getRequestURI().getRawPath();
                    byte[] in = ex.getRequestBody().readAllBytes();
                    synchronized (paths) {
                        paths.add(p);
                    }
                    if (p.equals("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5")) {
                        respond(ex, 200, "{\"height\":\"" + appliedHeight.get() + "\"}");
                    } else if (p.equals("/cosmos/tx/v1beta1/simulate")) {
                        if (simulateError != null) {
                            respond(ex, 400, "{\"code\":6,\"message\":\"" + simulateError + "\"}");
                        } else {
                            respond(ex, 200, "{\"gas_info\":{\"gas_wanted\":\"0\",\"gas_used\":\""
                                    + simulatedGas.get() + "\"}}");
                        }
                    } else if (p.startsWith("/qorechain/pqc/v1/kem/")) {
                        respond(ex, 200, "{\"found\":true,\"key\":{\"address\":\"" + ADDR
                                + "\",\"algorithm_id\":2,\"algorithm_name\":\"mlkem1024\",\"public_key\":\""
                                + Base64.getEncoder().encodeToString(validKemKey())
                                + "\",\"registered_height\":\"8979497\"}}");
                    } else if (p.equals("/") || p.isEmpty()) {
                        var req = MAPPER.readTree(in);
                        synchronized (broadcasts) {
                            broadcasts.add(Base64.getDecoder().decode(req.get("params").get(0).asText()));
                        }
                        respond(ex, 200, "{\"jsonrpc\":\"2.0\",\"id\":" + req.get("id")
                                + ",\"result\":{\"code\":0,\"hash\":\"ABCD\",\"log\":\"\"}}");
                    } else {
                        respond(ex, 404, "{\"code\":5,\"message\":\"not found\"}");
                    }
                });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
        ChainUpgrades.clearCache();
    }

    private static void respond(HttpExchange ex, int status, String b) throws IOException {
        byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("content-type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.close();
    }

    private long count(String path) {
        synchronized (paths) {
            return paths.stream().filter(path::equals).count();
        }
    }

    // ---- exact gas ----

    @Test
    void upgradeConstant() {
        assertEquals("v3.2.5", ChainUpgrades.V3_2_5);
    }

    @Test
    void exactHybridGasIsCeilOfTwoPercentPlus2000() {
        assertEquals(171_626L, AutoGas.exactHybridGas(166_300));
        assertEquals(2_000L, AutoGas.exactHybridGas(0));
        assertEquals(2_002L, AutoGas.exactHybridGas(1)); // ceil(1.02) = 2
        assertEquals(104_000L, AutoGas.exactHybridGas(100_000));
        assertThrows(IllegalArgumentException.class, () -> AutoGas.exactHybridGas(-1));
    }

    @Test
    void gasWantedPicksTheRule() {
        // v3.2.5, hybrid, default: the exact rule.
        assertEquals(171_626L, AutoGas.gasWanted(166_300, true, true, null));
        // An older network keeps ceil(simulated * 1.4).
        assertEquals(232_820L, AutoGas.gasWanted(166_300, true, false, null));
        // A classical tx keeps the old rule on v3.2.5 too.
        assertEquals(232_820L, AutoGas.gasWanted(166_300, false, true, null));
        // An explicit multiplier is honoured as given.
        assertEquals(199_560L, AutoGas.gasWanted(166_300, true, true, 1.2));
    }

    @Test
    void estimateUsesTheExactRuleOnceV325IsAppliedAndCachesTheLookup() {
        appliedHeight.set(3_906_833);
        AutoGas.Estimate e = AutoGas.estimate(baseUrl, new byte[] {1}, true, null, null);
        assertEquals(166_300L, e.simulatedGas);
        assertEquals(171_626L, e.gasWanted);
        assertTrue(e.exact);
        AutoGas.estimate(baseUrl + "/", new byte[] {1}, true, null, null);
        // An applied plan is cached per endpoint: asked once.
        assertEquals(1, count("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5"));
        assertEquals(2, count("/cosmos/tx/v1beta1/simulate"));
    }

    @Test
    void estimateKeepsTheOldRuleBelowV325() {
        appliedHeight.set(0);
        AutoGas.Estimate e = AutoGas.estimate(baseUrl, new byte[] {1}, true, null, null);
        assertFalse(e.exact);
        assertEquals(232_820L, e.gasWanted);
        // No plan lookup for a classical tx or an explicit multiplier.
        AutoGas.estimate(baseUrl, new byte[] {1}, false, null, null);
        AutoGas.estimate(baseUrl, new byte[] {1}, true, 1.5, null);
        assertEquals(1, count("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5"));
    }

    @Test
    void aFailedPlanLookupFallsBackToTheOldRule() {
        assertFalse(AutoGas.exactGasApplies("http://127.0.0.1:1"));
        assertFalse(AutoGas.exactGasApplies(null));
    }

    @Test
    void aSimulationRefusalIsNamed() {
        simulateError = "failed to execute message; message index: 0: no KEM key published for this account";
        TxError.QoreTxException e = assertThrows(
                TxError.QoreTxException.class, () -> AutoGas.simulate(baseUrl, new byte[] {1}, null));
        assertEquals("pqc", e.codespace);
        assertEquals(252, e.code);
        assertEquals("kem_key_not_found", e.kind);
    }

    @Test
    void sendAutoSignsTheExactGasLimitOnV325() throws Exception {
        appliedHeight.set(3_906_833);
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.pqcKeypair = Pqc.generatePqcKeypair(new byte[32]);
        s.chainId = "qorechain-diana";
        s.accountNumber = 7;
        s.sequence = 3;
        s.signBytesMode = SignBytes.Mode.V2;
        s.restUrl = baseUrl;
        PqcDx.EnsureOptions o = new PqcDx.EnsureOptions();
        o.status = new PqcDx.PqcStatus(true, 1, s.pqcKeypair.publicKey);
        PqcDx.HybridSendPath path = PqcDx.migrateToHybrid(s, new Broadcaster(baseUrl), null, o);

        TypedMessage send = NativeTx.bankSend(acct.address, acct.address, List.of(new StdFee.Coin("uqor", "1000")));
        PqcDx.HybridSendPath.AutoSendResult r = path.sendAuto(List.of(send), null, null);
        assertEquals(166_300L, r.estimate.simulatedGas);
        assertEquals(171_626L, r.estimate.gasWanted);
        assertEquals("171626", r.fee.gas);
        // 171626 * 0.15 = 25743.9 -> 25744
        assertEquals("25744", r.fee.amount.get(0).amount);
        assertEquals("ABCD", r.result.transactionHash);
        var raw = cosmos.tx.v1beta1.TxOuterClass.TxRaw.parseFrom(broadcasts.get(broadcasts.size() - 1));
        var auth = cosmos.tx.v1beta1.TxOuterClass.AuthInfo.parseFrom(raw.getAuthInfoBytes());
        assertEquals(171_626L, auth.getFee().getGasLimit());
    }

    // ---- KEM registry ----

    /** A key whose coefficients are all 1 (bytes 01 10 00 repeated), then a 32-byte seed. */
    private static byte[] validKemKey() {
        byte[] k = new byte[KemRegistry.ML_KEM_1024_PUBLIC_KEY_SIZE];
        for (int i = 0; i < 1536; i += 3) {
            k[i] = 0x01;
            k[i + 1] = 0x10;
            k[i + 2] = 0x00;
        }
        for (int i = 1536; i < k.length; i++) {
            k[i] = (byte) i;
        }
        return k;
    }

    @Test
    void registerKemKeyEncodesAndRoundTrips() throws Exception {
        TypedMessage m = KemRegistry.registerKemKey(ADDR, validKemKey());
        assertEquals("/qorechain.pqc.v1.MsgRegisterKEMKey", m.typeUrl);
        var back = (qorechain.pqc.v1.Tx.MsgRegisterKEMKey) Messages.unpack(Messages.pack(m));
        assertEquals(ADDR, back.getSender());
        assertEquals(2, back.getAlgorithmId());
        assertArrayEquals(validKemKey(), back.getPublicKey().toByteArray());

        TypedMessage rm = KemRegistry.removeKemKey(ADDR);
        assertEquals("/qorechain.pqc.v1.MsgRemoveKEMKey", rm.typeUrl);
        assertEquals(ADDR, ((qorechain.pqc.v1.Tx.MsgRemoveKEMKey) Messages.unpack(Messages.pack(rm))).getSender());
        assertEquals(2, KemRegistry.ALGORITHM_ML_KEM_1024);
        assertEquals(1568, KemRegistry.ML_KEM_1024_PUBLIC_KEY_SIZE);
    }

    @Test
    void registerKemKeyAppliesTheChainsKeyChecks() {
        IllegalArgumentException size = assertThrows(
                IllegalArgumentException.class, () -> KemRegistry.registerKemKey(ADDR, new byte[1567]));
        assertTrue(size.getMessage().contains("1568"));
        assertThrows(IllegalArgumentException.class, () -> KemRegistry.registerKemKey(ADDR, new byte[0]));

        // A coefficient of 3329 (0xD01): bytes 01 0D .. -> c0 = 0x01 | (0x0D << 8) = 3329.
        byte[] bad = validKemKey();
        bad[300] = 0x01;
        bad[301] = 0x1D;
        IllegalArgumentException mod = assertThrows(
                IllegalArgumentException.class, () -> KemRegistry.registerKemKey(ADDR, bad));
        assertTrue(mod.getMessage().contains("modulus"), mod.getMessage());
        // The high coefficient too: c1 = b1>>4 | b2<<4 = 0xFFF.
        byte[] bad2 = validKemKey();
        bad2[3] = 0x00;
        bad2[4] = (byte) 0xF0;
        bad2[5] = (byte) 0xFF;
        assertThrows(IllegalArgumentException.class, () -> KemRegistry.registerKemKey(ADDR, bad2));

        byte[] zero = new byte[1568];
        zero[1540] = 9; // the seed alone does not count
        IllegalArgumentException z = assertThrows(
                IllegalArgumentException.class, () -> KemRegistry.registerKemKey(ADDR, zero));
        assertTrue(z.getMessage().contains("all zero"));

        // Another algorithm id is left to the chain.
        assertEquals(7, ((qorechain.pqc.v1.Tx.MsgRegisterKEMKey) KemRegistry.registerKemKey(ADDR, new byte[5], 7).message)
                .getAlgorithmId());
    }

    @Test
    void fetchKemKeyDecodesTheAnswer() {
        KemRegistry.KemKeyResult r = KemRegistry.fetchKemKey(baseUrl, ADDR);
        assertTrue(r.found);
        assertEquals(ADDR, r.key.address);
        assertEquals(2, r.key.algorithmId);
        assertEquals("mlkem1024", r.key.algorithmName);
        assertArrayEquals(validKemKey(), r.key.publicKey);
        assertEquals(8_979_497L, r.key.registeredHeight);
        assertTrue(count("/qorechain/pqc/v1/kem/" + ADDR) >= 1);

        KemRegistry.KemKeyResult none = KemRegistry.parseKemKey(
                MAPPER.createObjectNode().put("found", false).putNull("key"));
        assertFalse(none.found);
        assertNull(none.key);
        assertThrows(IllegalStateException.class, () -> KemRegistry.parseKemKey(MAPPER.createObjectNode()));
    }

    @Test
    void decodesTheKemErrors() {
        String[] kinds = {
            "kem_registry_not_enabled", "kem_key_invalid", "kem_key_not_found", "kem_key_unchanged",
            "kem_needs_signature_key"
        };
        for (int c = 250; c <= 254; c++) {
            assertEquals(kinds[c - 250], TxError.decode(c, "pqc", "", null).kind);
        }
        TxError.QoreTxException text = TxError.decode(
                0, null, "publishing a KEM key needs a registered post-quantum signature key", null);
        assertEquals(254, text.code);
        assertEquals("invalid_spending_rule", TxError.decode(8, "abstractaccount", "", null).kind);
        assertEquals("abstractaccount_disabled", TxError.decode(9, "abstractaccount", "", null).kind);
    }

    // ---- spending rules ----

    private static SpendingRule ruleWithDenom(String denom) {
        return SpendingRule.newBuilder()
                .setEnabled(true)
                .addDenomLimits(DenomLimit.newBuilder().setDenom(denom).setPerTxLimit("5"))
                .build();
    }

    private static TypedMessage save(SpendingRule r) {
        return QorechainMessages.abstractaccount.updateSpendingRules(
                MsgUpdateSpendingRules.newBuilder().setOwner(ADDR).addRules(r).build());
    }

    @Test
    void evmDenomsMustCarryAContractAddress() {
        save(ruleWithDenom("erc20/" + TOKEN));
        save(ruleWithDenom("ERC20/0X" + "AB".repeat(20)));
        save(ruleWithDenom("erc721/" + TOKEN + "/7"));
        save(ruleWithDenom("erc1155/" + TOKEN + "/42"));
        save(ruleWithDenom("uqor"));

        for (String bad : List.of(
                "erc20/" + "ab".repeat(20), // no 0x
                "erc20/0x1234", // short
                "erc20/0x" + "zz".repeat(20), // not hex
                "erc20/" + TOKEN + "/1", // erc20 with a tail
                "erc721/notanaddress/1",
                "erc1155/")) {
            IllegalArgumentException e =
                    assertThrows(IllegalArgumentException.class, () -> save(ruleWithDenom(bad)), bad);
            assertTrue(e.getMessage().startsWith("spending rule 0: denom"), e.getMessage());
        }
        // allowed_denoms are checked too.
        SpendingRule allowed = SpendingRule.newBuilder()
                .setEnabled(true)
                .addAllowedDenoms("erc721/0x12")
                .build();
        assertThrows(IllegalArgumentException.class, () -> save(allowed));
        SpendingRules.validateEvmDenom("ibc/ABCDEF");
    }

    @Test
    void updateConfigChecksTheLimits() throws Exception {
        TypedMessage m = QorechainMessages.abstractaccount.updateConfig(GOV, true, 10, 5, 86_400);
        assertEquals("/qorechain.abstractaccount.v1.MsgUpdateConfig", m.typeUrl);
        var back = (qorechain.abstractaccount.v1.Tx.MsgUpdateConfig) Messages.unpack(Messages.pack(m));
        assertEquals(GOV, back.getAuthority());
        assertTrue(back.getEnabled());
        assertEquals(86_400L, back.getDefaultSessionTtl());
        assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.abstractaccount.updateConfig(GOV, true, 0, 5, 86_400));
        assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.abstractaccount.updateConfig(GOV, true, 10, 0, 86_400));
        assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.abstractaccount.updateConfig(GOV, true, 10, 5, 0));
        assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.abstractaccount.updateConfig("", true, 10, 5, 1));
    }

    // ---- governance params ----

    @Test
    void crossvmUpdateParams() throws Exception {
        var ok = qorechain.crossvm.v1.Tx.MsgUpdateParams.newBuilder()
                .setAuthority(GOV)
                .setMaxMessageSize(65_536)
                .setMaxQueueSize(1000)
                .setQueueTimeoutBlocks(100)
                .setEnabled(true)
                .addBridgeAllowedTargets("cosmwasm:" + ADDR)
                .build();
        TypedMessage m = QorechainMessages.crossvm.updateParams(ok);
        assertEquals("/qorechain.crossvm.v1.MsgUpdateParams", m.typeUrl);
        assertEquals(List.of("cosmwasm:" + ADDR),
                ((qorechain.crossvm.v1.Tx.MsgUpdateParams) Messages.unpack(Messages.pack(m)))
                        .getBridgeAllowedTargetsList());
        assertThrows(IllegalArgumentException.class, () -> QorechainMessages.crossvm.updateParams(
                ok.toBuilder().clearBridgeAllowedTargets().addBridgeAllowedTargets("cosmwasm").build()));
        assertThrows(IllegalArgumentException.class, () -> QorechainMessages.crossvm.updateParams(
                ok.toBuilder().setMaxQueueSize(0).build()));
        assertThrows(IllegalArgumentException.class, () -> QorechainMessages.crossvm.updateParams(
                ok.toBuilder().setAuthority("").build()));
    }

    @Test
    void rdkUpdateParams() throws Exception {
        var ok = qorechain.rdk.v1.Tx.MsgUpdateParams.newBuilder()
                .setAuthority(GOV)
                .setMaxRollups(100)
                .setMinStakeForRollup(10_000_000)
                .setRollupCreationBurnRate("0.01")
                .setDefaultChallengeWindow(604_800)
                .setMaxDaBlobSize(2_097_152)
                .setBlobRetentionBlocks(100_000)
                .setMaxBatchesPerBlock(10)
                .build();
        TypedMessage m = QorechainMessages.rdk.updateParams(ok);
        assertEquals("/qorechain.rdk.v1.MsgUpdateParams", m.typeUrl);
        assertEquals("0.01", ((qorechain.rdk.v1.Tx.MsgUpdateParams) Messages.unpack(Messages.pack(m)))
                .getRollupCreationBurnRate());
        for (String bad : List.of("1", "1.0", "-0.1", "x", "")) {
            assertThrows(IllegalArgumentException.class, () -> QorechainMessages.rdk.updateParams(
                    ok.toBuilder().setRollupCreationBurnRate(bad).build()), bad);
        }
        QorechainMessages.rdk.updateParams(ok.toBuilder().setRollupCreationBurnRate("0").build());
    }
}
