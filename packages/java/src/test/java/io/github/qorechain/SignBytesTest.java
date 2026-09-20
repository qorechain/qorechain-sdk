package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.accounts.UnifiedAccounts;
import io.github.qorechain.accounts.UnifiedAccounts.UnifiedAccount;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytes.Version;
import io.github.qorechain.tx.SignBytesResolver;
import io.github.qorechain.tx.SignEth;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.tx.TxError;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * Per-network hybrid sign-bytes v1/v2: known-answer vectors generated from the
 * chain code (v3.1.98), the legacy layouts, version selection, the resolver and its
 * cache, rejection detection, and end-to-end signing in each form.
 */
class SignBytesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String MNEMONIC =
            "test test test test test test test test test test test junk";

    // ---- helpers ----

    private static JsonNode kat() throws Exception {
        try (InputStream in =
                SignBytesTest.class.getResourceAsStream("/signbytes-kat-v3.1.98.json")) {
            assertTrue(in != null, "KAT fixture must be on the test classpath");
            return MAPPER.readTree(in);
        }
    }

    private static byte[] hex(String s) {
        if (s.isEmpty()) {
            return new byte[0];
        }
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            out.writeBytes(p);
        }
        return out.toByteArray();
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    // ---- KAT: all 11 vectors byte-exact ----

    @Test
    void katHybridV2() throws Exception {
        JsonNode vectors = kat().get("hybrid_v2");
        assertEquals(5, vectors.size());
        for (JsonNode v : vectors) {
            byte[] got =
                    SignBytes.hybridV2(
                            v.get("chain_id").asText(),
                            hex(v.get("body_without_pqc_ext_hex").asText()),
                            hex(v.get("auth_info_hex").asText()));
            assertArrayEquals(hex(v.get("sign_bytes_hex").asText()), got, v.get("name").asText());
            // The dispatcher and the HybridTx frame agree with the direct builder.
            assertArrayEquals(
                    got,
                    HybridTx.frame(
                            Version.V2,
                            v.get("chain_id").asText(),
                            hex(v.get("body_without_pqc_ext_hex").asText()),
                            hex(v.get("auth_info_hex").asText())));
        }
    }

    @Test
    void katMigrationV2() throws Exception {
        JsonNode vectors = kat().get("migration_v2");
        assertEquals(3, vectors.size());
        for (JsonNode v : vectors) {
            byte[] got =
                    SignBytes.migration(
                            Version.V2,
                            v.get("chain_id").asText(),
                            v.get("account").asText(),
                            v.get("from_algorithm_id").asInt(),
                            v.get("to_algorithm_id").asInt(),
                            v.get("execution_height").asLong(),
                            hex(v.get("old_public_key_hex").asText()),
                            hex(v.get("new_public_key_hex").asText()));
            assertArrayEquals(hex(v.get("sign_bytes_hex").asText()), got, v.get("name").asText());
        }
    }

    @Test
    void katBridgeAttestationV2() throws Exception {
        JsonNode vectors = kat().get("bridge_attestation_v2");
        assertEquals(3, vectors.size());
        for (JsonNode v : vectors) {
            byte[] got =
                    SignBytes.bridge(
                            Version.V2,
                            v.get("chain_id").asText(),
                            v.get("chain").asText(),
                            v.get("event_type").asText(),
                            v.get("operation_id").asText(),
                            v.get("tx_hash").asText(),
                            v.get("amount").asText(),
                            v.get("asset").asText());
            assertArrayEquals(hex(v.get("sign_bytes_hex").asText()), got, v.get("name").asText());
        }
    }

    @Test
    void katDomainsMatchConstants() throws Exception {
        JsonNode k = kat();
        assertEquals(k.get("hybrid_domain").asText(), SignBytes.HYBRID_DOMAIN);
        assertEquals(k.get("migration_domain").asText(), SignBytes.MIGRATION_DOMAIN);
    }

    // ---- v1 / legacy layouts ----

    @Test
    void hybridV1KnownLayout() {
        byte[] b0 = {0x0a, 0x01, 0x02};
        byte[] a = {0x12, 0x03, 0x04, 0x05};
        byte[] expected = {0, 0, 0, 3, 0x0a, 0x01, 0x02, 0, 0, 0, 4, 0x12, 0x03, 0x04, 0x05};
        assertArrayEquals(expected, SignBytes.hybridV1(b0, a));
        assertArrayEquals(expected, SignBytes.hybrid(Version.V1, "qorechain-vladi", b0, a));
        assertArrayEquals(new byte[8], SignBytes.hybridV1(new byte[0], new byte[0]));
    }

    @Test
    void hybridV2LayoutByHand() {
        byte[] b0 = {1, 2};
        byte[] a = {3};
        String chainId = "qorechain-diana";
        byte[] expected =
                concat(
                        utf8("qorechain-pqc-hybrid-v2"),
                        SignBytes.be64(chainId.length()),
                        utf8(chainId),
                        SignBytes.be32(2),
                        b0,
                        SignBytes.be32(1),
                        a);
        assertArrayEquals(expected, SignBytes.hybridV2(chainId, b0, a));
    }

    @Test
    void migrationV1LegacyString() {
        assertEquals(
                "qorechain-key-migration:chain=qorechain-vladi:from=1:to=3:account=qor1account:height=4200",
                new String(
                        SignBytes.migrationV1("qorechain-vladi", "qor1account", 1, 3, 4200L),
                        StandardCharsets.UTF_8));
        // The dispatcher's v1 ignores the public keys.
        assertArrayEquals(
                SignBytes.migrationV1("qorechain-vladi", "qor1account", 1, 3, 4200L),
                SignBytes.migration(
                        Version.V1, "qorechain-vladi", "qor1account", 1, 3, 4200L, new byte[] {1},
                        new byte[] {2}));
    }

    @Test
    void bridgeV1LegacyString() {
        assertEquals(
                "ethereum|deposit|op-0001|0xabc123|1000000|uqor",
                new String(
                        SignBytes.bridgeV1("ethereum", "deposit", "op-0001", "0xabc123", "1000000", "uqor"),
                        StandardCharsets.UTF_8));
        // v1 binds no chain id: the same bytes for any chain.
        assertArrayEquals(
                SignBytes.bridge(Version.V1, "qorechain-vladi", "a", "b", "c", "d", "1", "e"),
                SignBytes.bridge(Version.V1, "qorechain-diana", "a", "b", "c", "d", "1", "e"));
    }

    // ---- version selection ----

    @Test
    void versionForTruthTable() {
        assertEquals(Version.V1, SignBytes.versionFor("qorechain-vladi", 0));
        assertEquals(Version.V2, SignBytes.versionFor("qorechain-vladi", 5746000));
        assertEquals(Version.V1, SignBytes.versionFor("qorechain-diana", 0));
        assertEquals(Version.V2, SignBytes.versionFor("qorechain-diana", 5746000));
        assertEquals(Version.V2, SignBytes.versionFor("some-new-chain", 0));
        assertEquals(Version.V2, SignBytes.versionFor("some-new-chain", 5746000));
    }

    @Test
    void modeParse() {
        assertEquals(SignBytes.Mode.AUTO, SignBytes.Mode.parse(null));
        assertEquals(SignBytes.Mode.AUTO, SignBytes.Mode.parse("auto"));
        assertEquals(SignBytes.Mode.V1, SignBytes.Mode.parse("v1"));
        assertEquals(SignBytes.Mode.V2, SignBytes.Mode.parse("V2"));
        assertThrows(IllegalArgumentException.class, () -> SignBytes.Mode.parse("v3"));
    }

    // ---- resolver ----

    /**
     * A fake applied-plan endpoint that answers per PLAN NAME and records every call. A
     * name with no body configured answers {@code {}} — the plan was never applied on
     * this network, which is what each real network answers for the name it did not
     * take.
     */
    private static final class FakeFetcher implements SignBytesResolver.PlanFetcher {
        final Map<String, String> plans = new ConcurrentHashMap<>();
        volatile boolean fail = false;
        /** When set, only this plan name fails; null fails every name. */
        volatile String failFor = null;

        final List<String> calls = new ArrayList<>();

        /** diana today: the record lives under the name the testnet actually took. */
        static FakeFetcher legacyName(String body) {
            FakeFetcher f = new FakeFetcher();
            f.plans.put(LEGACY_NAME, body);
            return f;
        }

        @Override
        public JsonNode get(String restUrl, String path) throws Exception {
            calls.add(restUrl + path);
            String name = path.substring(path.lastIndexOf('/') + 1);
            if (fail && (failFor == null || failFor.equals(name))) {
                throw new java.io.IOException("connection refused");
            }
            return MAPPER.readTree(plans.getOrDefault(name, "{}"));
        }

        /** How many resolve rounds happened (one request for the first name each). */
        int rounds() {
            int n = 0;
            for (String c : calls) {
                if (c.endsWith("/" + PRIMARY_NAME)) {
                    n++;
                }
            }
            return n;
        }
    }

    private static final String PRIMARY_NAME = "v3.2.0";
    private static final String LEGACY_NAME = "v3.1.98";

    /**
     * The names the resolver walks must match the chain's own
     * {@code x/pqc/types.SignBytesV2Upgrades}: the mainnet name first, and the singular
     * constant pointing at it.
     */
    @Test
    void upgradePlanNames() {
        assertEquals(List.of(PRIMARY_NAME, LEGACY_NAME), SignBytes.SIGN_BYTES_V2_UPGRADES);
        assertEquals(PRIMARY_NAME, SignBytes.SIGN_BYTES_V2_UPGRADE);
        assertEquals(
                SignBytes.SIGN_BYTES_V2_UPGRADES.get(0), SignBytes.SIGN_BYTES_V2_UPGRADE);
        assertEquals(
                "/cosmos/upgrade/v1beta1/applied_plan/" + PRIMARY_NAME,
                SignBytesResolver.APPLIED_PLAN_PATH);
        assertEquals(
                "/cosmos/upgrade/v1beta1/applied_plan/" + LEGACY_NAME,
                SignBytesResolver.appliedPlanPath(LEGACY_NAME));
    }

    /**
     * Mainnet after its own upgrade: the FIRST name answers a positive height, so the
     * resolver answers v2 after exactly ONE request and never asks the second.
     */
    @Test
    void resolverFirstNameAppliedCostsOneRequest() {
        FakeFetcher f = new FakeFetcher();
        f.plans.put(PRIMARY_NAME, "{\"height\":\"7000000\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(
                Version.V2, r.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest"));
        assertEquals(
                List.of("http://rest/cosmos/upgrade/v1beta1/applied_plan/" + PRIMARY_NAME),
                f.calls);
    }

    /**
     * Diana today: the first name is not applied, the second is — v2 after two requests.
     * Asking only the first name (what published clients up to 0.8.0 did) would resolve
     * v1 here and every hybrid transaction would be refused with pqc code 21.
     */
    @Test
    void resolverSecondNameAppliedCostsTwoRequests() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"5746000\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(
                Version.V2, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        assertEquals(
                List.of(
                        "http://rest/cosmos/upgrade/v1beta1/applied_plan/" + PRIMARY_NAME,
                        "http://rest/cosmos/upgrade/v1beta1/applied_plan/" + LEGACY_NAME),
                f.calls);
    }

    /** Mainnet before its upgrade: every name answers zero, so and only so, v1. */
    @Test
    void resolverNoNameAppliedIsV1() {
        FakeFetcher zeros = new FakeFetcher();
        zeros.plans.put(PRIMARY_NAME, "{\"height\":\"0\"}");
        zeros.plans.put(LEGACY_NAME, "{\"height\":\"0\"}");
        SignBytesResolver r1 = new SignBytesResolver(zeros, 60_000, () -> 0L);
        assertEquals(
                Version.V1, r1.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest"));
        assertEquals(2, zeros.calls.size(), "every name is asked before answering v1");

        // Empty objects (the gRPC/CLI rendering of "not applied") count as zero too.
        FakeFetcher empties = new FakeFetcher();
        empties.plans.put(PRIMARY_NAME, "{}");
        empties.plans.put(LEGACY_NAME, "{}");
        SignBytesResolver r2 = new SignBytesResolver(empties, 60_000, () -> 0L);
        assertEquals(
                Version.V1, r2.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest"));
        assertEquals(2, empties.calls.size());
    }

    @Test
    void resolverAppliedHeightPositiveIsV2() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"5746000\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(
                Version.V2, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        assertEquals(2, f.calls.size());
        assertEquals(1, f.rounds());
    }

    @Test
    void resolverHeightZeroIsV1() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"0\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest"));
    }

    @Test
    void resolverEmptyObjectIsV1() {
        FakeFetcher f = FakeFetcher.legacyName("{}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest"));
    }

    /** A numeric (not string) height is accepted, on either name. */
    @Test
    void resolverNumericHeightIsV2() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":5746000}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
    }

    @Test
    void resolverNonLegacyIsV2WithoutHttp() {
        FakeFetcher f = new FakeFetcher();
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.AUTO, "some-new-chain", null));
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.AUTO, "some-new-chain", "http://rest"));
        assertTrue(f.calls.isEmpty());
    }

    @Test
    void resolverExplicitVersionNeedsNoHttp() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"5746000\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.V1, "qorechain-diana", null));
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.V2, "qorechain-vladi", null));
        // Explicit still skips the network even when a REST URL is at hand.
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.V1, "qorechain-diana", "http://rest"));
        assertTrue(f.calls.isEmpty());
    }

    @Test
    void resolverLegacyWithoutRestUrlThrows() {
        SignBytesResolver r = new SignBytesResolver(new FakeFetcher(), 60_000, () -> 0L);
        SignBytesResolver.SignBytesResolutionException e =
                assertThrows(
                        SignBytesResolver.SignBytesResolutionException.class,
                        () -> r.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", null));
        assertTrue(e.getMessage().contains("restUrl"));
        for (String name : SignBytes.SIGN_BYTES_V2_UPGRADES) {
            assertTrue(e.getMessage().contains(name), "message must name " + name);
        }
    }

    @Test
    void resolverHttpFailureThrows() {
        FakeFetcher f = new FakeFetcher();
        f.fail = true;
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        SignBytesResolver.SignBytesResolutionException e =
                assertThrows(
                        SignBytesResolver.SignBytesResolutionException.class,
                        () -> r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        for (String name : SignBytes.SIGN_BYTES_V2_UPGRADES) {
            assertTrue(e.getMessage().contains(name), "message must name " + name);
        }
    }

    /**
     * A failure on the SECOND name is a failure too: the first answering zero must never
     * be read as "not applied anywhere".
     */
    @Test
    void resolverFailureOnSecondNameThrows() {
        FakeFetcher f = new FakeFetcher();
        f.plans.put(PRIMARY_NAME, "{\"height\":\"0\"}");
        f.fail = true;
        f.failFor = LEGACY_NAME;
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        SignBytesResolver.SignBytesResolutionException e =
                assertThrows(
                        SignBytesResolver.SignBytesResolutionException.class,
                        () -> r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        assertTrue(e.getMessage().contains(LEGACY_NAME), "message must say which plan failed");
        assertEquals(2, f.calls.size());
    }

    /** An unparsable height is a failure, never a guess. */
    @Test
    void resolverUnparsableHeightThrows() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"not-a-number\"}");
        SignBytesResolver r = new SignBytesResolver(f, 60_000, () -> 0L);
        assertThrows(
                SignBytesResolver.SignBytesResolutionException.class,
                () -> r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
    }

    @Test
    void resolverCachesWithinTtlAndRefreshes() {
        FakeFetcher f = FakeFetcher.legacyName("{\"height\":\"0\"}");
        AtomicLong now = new AtomicLong(1_000);
        SignBytesResolver r = new SignBytesResolver(f, 60_000, now::get);

        assertEquals(Version.V1, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        // The network upgrades; within the TTL the cached answer is served.
        f.plans.put(LEGACY_NAME, "{\"height\":\"5746000\"}");
        now.addAndGet(30_000);
        assertEquals(Version.V1, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        assertEquals(1, f.rounds());
        // One cached answer covers BOTH names, not one cache entry per name.
        assertEquals(2, f.calls.size());

        // A forced refresh bypasses the cache and replaces it.
        assertEquals(
                Version.V2,
                r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest", true));
        assertEquals(2, f.rounds());
        assertEquals(Version.V2, r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest"));
        assertEquals(2, f.rounds());

        // Past the TTL the network is asked again.
        now.addAndGet(60_001);
        r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest");
        assertEquals(3, f.rounds());

        // The cache is keyed per (restUrl, chainId).
        r.resolve(SignBytes.Mode.AUTO, "qorechain-vladi", "http://rest");
        r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://other");
        assertEquals(5, f.rounds());

        // clearCache drops everything.
        r.clearCache();
        r.resolve(SignBytes.Mode.AUTO, "qorechain-diana", "http://rest");
        assertEquals(6, f.rounds());
    }

    // ---- rejection detection ----

    @Test
    void rejectionDetector() {
        assertTrue(SignBytes.isHybridVerifyRejection(21, "pqc", ""));
        assertTrue(
                SignBytes.isHybridVerifyRejection(
                        1, "", "failed to execute message; hybrid PQC signature verification failed"));
        assertFalse(SignBytes.isHybridVerifyRejection(21, "sdk", "tx too large"));
        assertFalse(SignBytes.isHybridVerifyRejection(20, "pqc", "other"));
        assertTrue(
                SignBytes.isHybridVerifyRejection(
                        TxError.decode(21, "pqc", "hybrid PQC signature verification failed", "H")));
        assertFalse(
                SignBytes.isHybridVerifyRejection(TxError.decode(21, "sdk", "tx too large", "H")));
    }

    // ---- builders: version is required on legacy chains ----

    private static HybridTx.Options hybridOptions(String chainId, Version version) {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        byte[] seed = new byte[32];
        Arrays.fill(seed, (byte) 9);
        PqcKeypair pqc = Pqc.generatePqcKeypair(seed);
        TypedMessage send =
                NativeTx.bankSend(
                        acct.address,
                        Accounts.deriveNativeAccount(MNEMONIC, 1).address,
                        List.of(new StdFee.Coin("uqor", "1")));
        HybridTx.Options opts = new HybridTx.Options();
        opts.messages = List.of(send);
        opts.secp256k1PrivateKey = acct.privateKey;
        opts.secp256k1PublicKey = acct.publicKey;
        opts.pqcKeypair = pqc;
        opts.fee = StdFee.of("uqor", "5000", "200000");
        opts.chainId = chainId;
        opts.accountNumber = 7;
        opts.sequence = 3;
        opts.signBytesVersion = version;
        return opts;
    }

    @Test
    void hybridTxWithoutVersionOnLegacyChainFailsLoudly() {
        assertThrows(
                IllegalStateException.class,
                () -> HybridTx.buildHybridTx(hybridOptions("qorechain-vladi", null)));
        assertThrows(
                IllegalStateException.class,
                () -> HybridTx.buildHybridTx(hybridOptions("qorechain-diana", null)));
    }

    @Test
    void hybridTxWithoutVersionOnNewChainIsV2() {
        HybridTx.Built built = HybridTx.buildHybridTx(hybridOptions("some-new-chain", null));
        assertEquals(Version.V2, built.signBytesVersion);
        assertArrayEquals(
                SignBytes.hybridV2("some-new-chain", built.b0Bytes, built.authInfoBytes),
                built.pqcSignedMessage);
    }

    @Test
    void hybridTxV2SignatureVerifiesOverV2NotV1() {
        HybridTx.Options opts = hybridOptions("qorechain-diana", Version.V2);
        HybridTx.Built built = HybridTx.buildHybridTx(opts);
        assertEquals(Version.V2, built.signBytesVersion);
        byte[] v2 = SignBytes.hybridV2("qorechain-diana", built.b0Bytes, built.authInfoBytes);
        byte[] v1 = SignBytes.hybridV1(built.b0Bytes, built.authInfoBytes);
        assertArrayEquals(v2, built.pqcSignedMessage);
        assertTrue(Pqc.pqcVerify(opts.pqcKeypair.publicKey, v2, built.pqcSignature));
        assertFalse(Pqc.pqcVerify(opts.pqcKeypair.publicKey, v1, built.pqcSignature));
        // Bound to the chain id: does not verify as another network's v2 bytes either.
        byte[] otherChain =
                SignBytes.hybridV2("qorechain-vladi", built.b0Bytes, built.authInfoBytes);
        assertFalse(Pqc.pqcVerify(opts.pqcKeypair.publicKey, otherChain, built.pqcSignature));
    }

    @Test
    void hybridTxV1SignatureVerifiesOverV1() {
        HybridTx.Options opts = hybridOptions("qorechain-vladi", Version.V1);
        HybridTx.Built built = HybridTx.buildHybridTx(opts);
        assertEquals(Version.V1, built.signBytesVersion);
        byte[] v1 = SignBytes.hybridV1(built.b0Bytes, built.authInfoBytes);
        assertArrayEquals(v1, built.pqcSignedMessage);
        assertTrue(Pqc.pqcVerify(opts.pqcKeypair.publicKey, v1, built.pqcSignature));
    }

    @Test
    void signEthHybridHonoursVersion() {
        UnifiedAccount acct = UnifiedAccounts.deriveUnifiedAccount(MNEMONIC, 0);
        SignEth.Options opts = new SignEth.Options();
        opts.messages =
                List.of(NativeTx.bankSend(acct.cosmos, acct.cosmos, List.of(new StdFee.Coin("uqor", "1"))));
        opts.secp256k1PrivateKey = acct.privateKey;
        opts.secp256k1PublicKey = acct.publicKey;
        opts.pqcKeypair = acct.pqc;
        opts.fee = StdFee.of("uqor", "5000", "200000");
        opts.chainId = "qorechain-diana";
        opts.accountNumber = 7;
        opts.sequence = 3;

        assertThrows(IllegalStateException.class, () -> SignEth.signHybridEth(opts));

        opts.signBytesVersion = Version.V2;
        SignEth.Built v2 = SignEth.signHybridEth(opts);
        assertEquals(Version.V2, v2.signBytesVersion);
        assertArrayEquals(
                SignBytes.hybridV2(opts.chainId, v2.b0Bytes, v2.authInfoBytes), v2.pqcSignedMessage);
        assertTrue(Pqc.pqcVerify(acct.pqc.publicKey, v2.pqcSignedMessage, v2.pqcSignature));
        assertFalse(
                Pqc.pqcVerify(
                        acct.pqc.publicKey,
                        SignBytes.hybridV1(v2.b0Bytes, v2.authInfoBytes),
                        v2.pqcSignature));

        opts.signBytesVersion = Version.V1;
        SignEth.Built v1 = SignEth.signHybridEth(opts);
        assertEquals(Version.V1, v1.signBytesVersion);
        assertArrayEquals(SignBytes.hybridV1(v1.b0Bytes, v1.authInfoBytes), v1.pqcSignedMessage);

        // Classical-only signing carries no version.
        opts.signBytesVersion = null;
        assertEquals(null, SignEth.signClassicalEth(opts).signBytesVersion);
    }
}
