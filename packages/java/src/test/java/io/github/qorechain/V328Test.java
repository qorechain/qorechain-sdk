package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Any;
import com.google.protobuf.ByteString;
import com.google.protobuf.CodedOutputStream;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.github.qorechain.accounts.Account;
import io.github.qorechain.accounts.Accounts;
import io.github.qorechain.accounts.Secp256k1;
import io.github.qorechain.address.Address;
import io.github.qorechain.crossvm.CrossVMClient;
import io.github.qorechain.evm.EvmLimits;
import io.github.qorechain.evm.EvmWindow;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.SpendingRules;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.query.RestClient;
import io.github.qorechain.tx.AutoGas;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.Broadcaster;
import io.github.qorechain.tx.GasLimits;
import io.github.qorechain.tx.GasPrice;
import io.github.qorechain.tx.NativeTx;
import io.github.qorechain.tx.StdFee;
import io.github.qorechain.utils.Hashing;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.bouncycastle.asn1.sec.SECNamedCurves;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.math.ec.rfc8032.Ed25519;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import qorechain.abstractaccount.v1.Tx.DenomLimit;
import qorechain.abstractaccount.v1.Tx.SpendingRule;

/** Chain v3.2.8 client changes. */
class V328Test {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CHAIN = "qorechain-diana";
    private static final String ACCOUNT = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
    private static final String MNEMONIC = "test test test test test test test test test test test junk";
    private static final String GOV = Address.bytesToBech32(new byte[20]);

    private HttpServer server;
    private String baseUrl;
    /** path -> response body; a value may be a function of the raw query. */
    private final Map<String, java.util.function.Function<String, String>> routes = new ConcurrentHashMap<>();
    private final List<String> queries = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            String path = ex.getRequestURI().getPath();
            String q = ex.getRequestURI().getRawQuery();
            queries.add(path + "?" + (q == null ? "" : q));
            var h = routes.get(path);
            if (h == null) {
                respond(ex, 404, "{}");
            } else {
                respond(ex, 200, h.apply(q == null ? "" : java.net.URLDecoder.decode(q, StandardCharsets.UTF_8)));
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

    // ---- 1. link message + possession proofs ----

    @Test
    void linkMessageKnownAnswer() {
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 7);
        assertEquals(
                "QoreChain authenticator link v1\nchain: qorechain-diana\naccount: qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj\nscheme: ed25519\nkey: 0707070707070707070707070707070707070707070707070707070707070707",
                Authenticator.authenticatorLinkMessage(CHAIN, ACCOUNT, "ed25519", key));
    }

    @Test
    void ed25519ProofVerifies() {
        byte[] seed = Hashing.sha256("ed seed");
        Authenticator.PossessionProof p = Authenticator.ed25519PossessionProof(seed, CHAIN, ACCOUNT);
        assertEquals(32, p.pubkey.length);
        assertEquals(64, p.proof.length);
        byte[] msg = Authenticator.authenticatorLinkMessageBytes(CHAIN, ACCOUNT, "ed25519", p.pubkey);
        assertTrue(Ed25519.verify(p.proof, 0, p.pubkey, 0, msg, 0, msg.length));
        byte[] other = Authenticator.authenticatorLinkMessageBytes("other-chain", ACCOUNT, "ed25519", p.pubkey);
        assertFalse(Ed25519.verify(p.proof, 0, p.pubkey, 0, other, 0, other.length));
    }

    @Test
    void secp256k1ProofVerifies() {
        Account a = Accounts.deriveNativeAccount(MNEMONIC, 0);
        Authenticator.PossessionProof p = Authenticator.secp256k1PossessionProof(a.privateKey, CHAIN, ACCOUNT);
        assertArrayEquals(a.publicKey, p.pubkey);
        assertEquals(64, p.proof.length);
        X9ECParameters c = SECNamedCurves.getByName("secp256k1");
        ECDomainParameters dom = new ECDomainParameters(c.getCurve(), c.getG(), c.getN(), c.getH());
        ECDSASigner v = new ECDSASigner();
        v.init(false, new ECPublicKeyParameters(c.getCurve().decodePoint(p.pubkey), dom));
        BigInteger r = new BigInteger(1, Arrays.copyOfRange(p.proof, 0, 32));
        BigInteger s = new BigInteger(1, Arrays.copyOfRange(p.proof, 32, 64));
        assertTrue(s.compareTo(c.getN().shiftRight(1)) <= 0, "low-S");
        byte[] msg = Authenticator.authenticatorLinkMessageBytes(CHAIN, ACCOUNT, "secp256k1", p.pubkey);
        assertTrue(v.verifySignature(Hashing.sha256(msg), r, s));
    }

    @Test
    void eip191ProofRecoversTheAddress() {
        Account a = Accounts.deriveEvmAccount(MNEMONIC, 0);
        Authenticator.PossessionProof p = Authenticator.eip191PossessionProof(a.privateKey, CHAIN, ACCOUNT);
        assertEquals(20, p.pubkey.length);
        assertEquals(a.address.toLowerCase(), "0x" + io.github.qorechain.utils.Hex.encode(p.pubkey));
        assertEquals(65, p.proof.length);
        int vByte = p.proof[64] & 0xff;
        assertTrue(vByte == 27 || vByte == 28);
        byte[] text = Authenticator.authenticatorLinkMessageBytes(CHAIN, ACCOUNT, "secp256k1", p.pubkey);
        byte[] prefixed = ("\u0019Ethereum Signed Message:\n" + text.length + new String(text, StandardCharsets.UTF_8))
                .getBytes(StandardCharsets.UTF_8);
        byte[] hash = Hashing.keccak256(prefixed);
        assertArrayEquals(hash, Authenticator.eip191Hash(text));
        byte[] pub = Secp256k1.recoverPublicKey(vByte - 27,
                new BigInteger(1, Arrays.copyOfRange(p.proof, 0, 32)),
                new BigInteger(1, Arrays.copyOfRange(p.proof, 32, 64)), hash);
        byte[] addr = Arrays.copyOfRange(Hashing.keccak256(Arrays.copyOfRange(pub, 1, 65)), 12, 32);
        assertArrayEquals(p.pubkey, addr);
    }

    @Test
    void registerAuthenticatorNeedsProof() {
        var m = qorechain.abstractaccount.v1.Tx.MsgRegisterAuthenticator.newBuilder()
                .setOwner(ACCOUNT).setAccountAddress(ACCOUNT).setScheme("ed25519")
                .setPubkey(ByteString.copyFrom(new byte[32])).addPermissions("svm").setExpiryUnix(1).build();
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.abstractaccount.registerAuthenticator(m));
        assertTrue(e.getMessage().contains("authenticatorLinkMessage"), e.getMessage());
        assertThrows(IllegalArgumentException.class, () -> QorechainMessages.abstractaccount.registerAuthenticator(
                m.toBuilder().setScheme("secp256k1").setPubkey(ByteString.copyFrom(new byte[65]))
                        .setPossessionProof(ByteString.copyFrom(new byte[64])).build()));
        assertEquals("/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
                QorechainMessages.abstractaccount.registerAuthenticator(
                        m.toBuilder().setPossessionProof(ByteString.copyFrom(new byte[64])).build()).typeUrl);
    }

    private static Authenticator.LinkOptions link(List<String> perms, List<SpendingRule> rules) {
        Authenticator.PossessionProof p =
                Authenticator.ed25519PossessionProof(Hashing.sha256("k"), CHAIN, ACCOUNT);
        Authenticator.LinkOptions o = new Authenticator.LinkOptions();
        o.owner = ACCOUNT;
        o.scheme = p.scheme;
        o.pubkey = p.pubkey;
        o.permissions = perms;
        o.expiryUnix = 1_900_000_000L;
        o.label = "phantom";
        o.possessionProof = p.proof;
        o.spendingRules = rules;
        return o;
    }

    @Test
    void linkAuthenticatorMsgsBuildsThePair() {
        SpendingRule perTx = SpendingRule.newBuilder().setId("r").setEnabled(true).setPerTxLimit(1000).build();
        List<TypedMessage> msgs = Authenticator.linkAuthenticatorMsgs(link(List.of("send"), List.of(perTx)));
        assertEquals(2, msgs.size());
        assertEquals("/qorechain.abstractaccount.v1.MsgUpdateSpendingRules", msgs.get(0).typeUrl);
        assertEquals("/qorechain.abstractaccount.v1.MsgRegisterAuthenticator", msgs.get(1).typeUrl);
        var reg = (qorechain.abstractaccount.v1.Tx.MsgRegisterAuthenticator) msgs.get(1).message;
        assertEquals(ACCOUNT, reg.getAccountAddress());
        assertEquals(64, reg.getPossessionProof().size());

        // value permission without a rule
        assertThrows(IllegalArgumentException.class,
                () -> Authenticator.linkAuthenticatorMsgs(link(List.of("evm"), null)));
        // no value permission, no rules: only the register message
        assertEquals(1, Authenticator.linkAuthenticatorMsgs(link(List.of("stake"), null)).size());
        // empty proof refused
        Authenticator.LinkOptions noProof = link(List.of("send"), List.of(perTx));
        noProof.possessionProof = null;
        assertThrows(IllegalArgumentException.class, () -> Authenticator.linkAuthenticatorMsgs(noProof));
    }

    @Test
    void valueBoundFollowsTheFirstEnabledRule() {
        SpendingRule denoms = SpendingRule.newBuilder().setId("d").setEnabled(true)
                .addAllowedDenoms("UQOR")
                .addDenomLimits(DenomLimit.newBuilder().setDenom("uqor").setDailyLimit("500")).build();
        SpendingRules.requireValueBound(List.of(denoms), List.of("all"));
        SpendingRule unlimitedDenom = denoms.toBuilder().addAllowedDenoms("uatom").build();
        assertFalse(SpendingRules.boundsValue(unlimitedDenom));
        SpendingRule onlyCalls = SpendingRule.newBuilder().setId("c").setEnabled(true)
                .addAllowedEvmCalls("0x" + "11".repeat(20)).build();
        SpendingRule bounded = SpendingRule.newBuilder().setId("b").setEnabled(true).setDailyLimit(5).build();
        SpendingRule disabled = bounded.toBuilder().setEnabled(false).build();
        // the chain applies the first enabled rule only
        assertThrows(IllegalArgumentException.class,
                () -> SpendingRules.requireValueBound(List.of(onlyCalls, bounded), List.of("evm")));
        SpendingRules.requireValueBound(List.of(disabled, bounded, onlyCalls), List.of("evm"));
        assertThrows(IllegalArgumentException.class,
                () -> SpendingRules.requireValueBound(List.of(disabled), List.of("deploy")));
        SpendingRules.requireValueBound(List.of(), List.of("stake"));
    }

    // ---- 2. execution results ----

    private static byte[] txMsgData(Any... responses) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        CodedOutputStream out = CodedOutputStream.newInstance(bos);
        for (Any a : responses) {
            out.writeBytes(2, a.toByteString());
        }
        out.flush();
        return bos.toByteArray();
    }

    @Test
    void executionResultsReportFailuresInsideCodeZero() throws Exception {
        Any evmOk = Any.newBuilder().setTypeUrl("/qorechain.abstractaccount.v1.MsgExecuteEVMResponse")
                .setValue(qorechain.abstractaccount.v1.Tx.MsgExecuteEVMResponse.newBuilder()
                        .setSuccess(true).setRet(ByteString.copyFrom(new byte[] {1})).setGasUsed(21000)
                        .build().toByteString()).build();
        Any evmFail = Any.newBuilder().setTypeUrl("/qorechain.abstractaccount.v1.MsgExecuteEVMResponse")
                .setValue(qorechain.abstractaccount.v1.Tx.MsgExecuteEVMResponse.newBuilder()
                        .setSuccess(false).setGasUsed(30000).setVmError("execution reverted")
                        .build().toByteString()).build();
        Any cosmosFail = Any.newBuilder().setTypeUrl("/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse")
                .setValue(qorechain.abstractaccount.v1.Tx.MsgExecuteCosmosResponse.newBuilder()
                        .setSuccess(false).build().toByteString()).build();
        String events = "[{\"type\":\"message\",\"attributes\":[]},"
                + "{\"type\":\"abstractaccount_execution_failed\",\"attributes\":["
                + "{\"key\":\"account\",\"value\":\"" + ACCOUNT + "\"},{\"key\":\"lane\",\"value\":\"evm\"},"
                + "{\"key\":\"nonce\",\"value\":\"4\"},{\"key\":\"reason\",\"value\":\"reverted\"}]},"
                + "{\"type\":\"abstractaccount_execution_failed\",\"attributes\":["
                + "{\"key\":\"reason\",\"value\":\"spending limit\"}]}]";
        String data = java.util.Base64.getEncoder().encodeToString(txMsgData(evmOk, evmFail, cosmosFail));
        routes.put("/", q -> "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"hash\":\"AB\",\"height\":\"9\","
                + "\"check_tx\":{\"code\":0},\"tx_result\":{\"code\":0,\"data\":\"" + data + "\",\"events\":"
                + events + "}}}");
        Broadcaster.Result r = new Broadcaster(baseUrl).broadcast(new byte[] {1}, Broadcaster.Mode.COMMIT);
        assertEquals(0, r.code);
        assertEquals(3, r.events.size());

        List<Authenticator.ExecutionResult> rs = Authenticator.executionResults(r);
        assertEquals(3, rs.size());
        assertTrue(rs.get(0).success);
        assertEquals(21000, rs.get(0).gasUsed);
        assertEquals("", rs.get(0).reason);
        assertFalse(rs.get(1).success);
        assertEquals("reverted", rs.get(1).reason);
        assertEquals("execution reverted", rs.get(1).vmError);
        assertEquals("cosmos", rs.get(2).lane);
        assertEquals("spending limit", rs.get(2).reason);
        Authenticator.ExecutionFailedException e = assertThrows(Authenticator.ExecutionFailedException.class,
                () -> Authenticator.requireExecutionsSucceeded(r));
        assertTrue(e.getMessage().contains("reverted"), e.getMessage());

        Broadcaster.Result ok = new Broadcaster.Result("x", 0);
        ok.data = txMsgData(evmOk);
        assertEquals(1, Authenticator.requireExecutionsSucceeded(ok).size());
    }

    // ---- 3. governance params ----

    private static final String CROSSVM_PARAMS = "{\"max_message_size\":\"65536\",\"max_queue_size\":1000,"
            + "\"queue_timeout_blocks\":\"100\",\"enabled\":true,\"bridge_allowed_targets\":[\"cosmwasm:qor1x\"],"
            + "\"bridge_target_pins\":[{\"target\":\"cosmwasm:qor1x\",\"code_id\":\"12\",\"history_len\":\"2\"}],"
            + "\"max_pending_per_sender\":100,\"max_cosmos_tx_gas\":\"50000000\",\"record_retention_blocks\":\"100000\","
            + "\"max_block_wasm_gas\":\"3000000\",\"max_tx_wasm_share_bps\":5000,\"max_block_level_wasm_gas\":\"10000000\","
            + "\"queue_wasm_reserve_bps\":2500,\"wasm_congestion_max_factor\":1000,\"wasm_congestion_target_bps\":5000,"
            + "\"wasm_congestion_factor_micro\":\"1000000\",\"max_block_upload_bps\":5000,"
            + "\"max_queue_timeouts_per_block\":100}";

    @Test
    void crossvmUpdateParamsRequiresEveryField() {
        var partial = qorechain.crossvm.v1.Tx.MsgUpdateParams.newBuilder().setAuthority(GOV)
                .setMaxMessageSize(1).setMaxQueueSize(1).setQueueTimeoutBlocks(1).setEnabled(true)
                .addBridgeAllowedTargets("cosmwasm:qor1x").build();
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.crossvm.updateParams(partial));
        assertTrue(e.getMessage().contains("bridge_target_pins"), e.getMessage());
        assertTrue(e.getMessage().contains("max_queue_timeouts_per_block"), e.getMessage());
        assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.crossvm.updateParams(partial, Set.of("no_such_field")));
    }

    @Test
    void crossvmUpdateParamsFromCurrent() {
        routes.put("/qorechain/crossvm/v1/params", q -> CROSSVM_PARAMS);
        TypedMessage tm = QorechainMessages.crossvm.updateParamsFromCurrent(
                new RestClient(baseUrl), GOV, Map.of("max_pending_per_sender", 50));
        var m = (qorechain.crossvm.v1.Tx.MsgUpdateParams) tm.message;
        assertEquals(GOV, m.getAuthority());
        assertEquals(65536, m.getMaxMessageSize());
        assertEquals(50, m.getMaxPendingPerSender());
        assertEquals(1, m.getBridgeTargetPinsCount());
        assertEquals(12, m.getBridgeTargetPins(0).getCodeId());
        assertEquals(2, m.getBridgeTargetPins(0).getHistoryLen());
        assertEquals(100, m.getMaxQueueTimeoutsPerBlock());
        assertThrows(IllegalArgumentException.class, () -> QorechainMessages.crossvm.updateParamsFromCurrent(
                new RestClient(baseUrl), GOV, Map.of("nope", 1)));
        // clearing the pins explicitly is allowed
        var cleared = (qorechain.crossvm.v1.Tx.MsgUpdateParams) QorechainMessages.crossvm.updateParamsFromCurrent(
                new RestClient(baseUrl), GOV, Map.of("bridge_target_pins", List.of())).message;
        assertEquals(0, cleared.getBridgeTargetPinsCount());
    }

    @Test
    void rdkUpdateParamsFromCurrent() {
        routes.put("/qorechain/rdk/v1/params", q -> "{\"params\":{\"max_rollups\":100,\"min_stake_for_rollup\":"
                + "\"10000000\",\"rollup_creation_burn_rate\":\"0.010000000000000000\",\"default_challenge_window\":"
                + "\"604800\",\"max_da_blob_size\":\"2097152\",\"blob_retention_blocks\":\"100000\","
                + "\"max_batches_per_block\":10,\"finalized_batch_retention_blocks\":\"1000\","
                + "\"max_posted_data_bytes\":\"65536\",\"max_posted_data_bytes_per_block\":\"1048576\","
                + "\"posted_data_fee_per_byte\":\"10\",\"posted_data_retention_blocks\":\"50000\","
                + "\"min_submitter_bond\":\"1000000\"}}");
        var m = (qorechain.rdk.v1.Tx.MsgUpdateParams) QorechainMessages.rdk.updateParamsFromCurrent(
                new RestClient(baseUrl), GOV, Map.of("max_rollups", 200)).message;
        assertEquals(200, m.getMaxRollups());
        assertEquals(1_000_000, m.getMinSubmitterBond());
        assertEquals("0.010000000000000000", m.getRollupCreationBurnRate());
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.rdk.updateParams(m.toBuilder().setMinSubmitterBond(0).build()));
        assertTrue(e.getMessage().contains("min_submitter_bond"), e.getMessage());
        QorechainMessages.rdk.updateParams(m.toBuilder().setMinSubmitterBond(0).build(), Set.of("min_submitter_bond"));
    }

    @Test
    void svmUpdateParamsCustodyCeilings() {
        var params = qorechain.svm.v1.Tx.SVMParams.newBuilder().setMaxProgramSize(1).setMaxAccountDataSize(1)
                .setComputeBudgetMax(1).setLamportsPerByte(1).setRentExemptionMulti("2").setEnabled(true)
                .setSvmSlotOffset(1).setDefaultSigScheme(1).setMaxCpi(4).setMaxCustodyUqor(10)
                .setMaxCustodyHardUqor(100).setMaxAccountExcessUqor(5).build();
        var msg = qorechain.svm.v1.Tx.MsgUpdateParams.newBuilder().setAuthority(GOV).setParams(params).build();
        QorechainMessages.svm.updateParams(msg);
        var noHard = msg.toBuilder().setParams(params.toBuilder().setMaxCustodyHardUqor(0)).build();
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.svm.updateParams(noHard));
        assertTrue(e.getMessage().contains("max_custody_hard_uqor"), e.getMessage());
        IllegalArgumentException e2 = assertThrows(IllegalArgumentException.class,
                () -> QorechainMessages.svm.updateParams(noHard, Set.of("max_custody_hard_uqor")));
        assertTrue(e2.getMessage().contains("hard custody ceiling"), e2.getMessage());
        QorechainMessages.svm.updateParams(
                msg.toBuilder().setParams(params.toBuilder().setEnabled(false).setMaxCustodyHardUqor(0)).build(),
                Set.of("enabled", "max_custody_hard_uqor"));
    }

    // ---- 4. cross-VM ----

    private CrossVMClient client(StdFee fee, String restUrl) {
        Account acct = Accounts.deriveNativeAccount(MNEMONIC, 0);
        CrossVMClient.Signer s = new CrossVMClient.Signer();
        s.sender = acct.address;
        s.secp256k1PrivateKey = acct.privateKey;
        s.secp256k1PublicKey = acct.publicKey;
        s.fee = fee;
        s.restUrl = restUrl;
        s.chainId = CHAIN;
        return new CrossVMClient(s, new Broadcaster(baseUrl), null);
    }

    private static CrossVMClient.CallOptions asyncWasm() {
        CrossVMClient.CallOptions o = new CrossVMClient.CallOptions();
        o.targetVm = CrossVMClient.VMType.COSMWASM;
        o.targetContract = "qor1contract";
        o.payload = new byte[] {1};
        o.async = true;
        return o;
    }

    @Test
    void asyncGasOptions() {
        CrossVMClient.CallOptions o = asyncWasm();
        o.asyncGasLimit = 1_000_000;
        o.asyncMaxFactor = 2_000_000;
        var msg = (qorechain.crossvm.v1.Tx.MsgCrossVMCall) client(null, null).buildCall(o).message;
        assertEquals(1_000_000, msg.getAsyncGasLimit());
        assertEquals(2_000_000, msg.getAsyncMaxFactor());
        for (long bad : new long[] {249_999, 10_000_001}) {
            CrossVMClient.CallOptions b = asyncWasm();
            b.asyncGasLimit = bad;
            assertThrows(IllegalArgumentException.class, () -> client(null, null).buildCall(b));
        }
        CrossVMClient.CallOptions sync = asyncWasm();
        sync.async = false;
        sync.asyncGasLimit = 300_000;
        assertThrows(IllegalArgumentException.class, () -> client(null, null).buildCall(sync));
        CrossVMClient.CallOptions evm = asyncWasm();
        evm.targetVm = CrossVMClient.VMType.EVM;
        evm.asyncMaxFactor = 1;
        assertThrows(IllegalArgumentException.class, () -> client(null, null).buildCall(evm));
    }

    @Test
    void crossVmCallNeedsSimulationOrExplicitGas() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> client(null, null).call(asyncWasm()));
        routes.put("/cosmos/tx/v1beta1/simulate", q -> "{\"gas_info\":{\"gas_used\":\"100000\"}}");
        routes.put("/", q -> "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"code\":0,\"hash\":\"AB\",\"log\":\"\"}}");
        client(null, baseUrl).call(asyncWasm());
        assertTrue(queries.stream().anyMatch(s -> s.startsWith("/cosmos/tx/v1beta1/simulate")));
        assertTrue(AutoGas.gasWanted(100_000, true, true, null, true) >= 130_000);
        assertEquals(102_000 + 2_000, AutoGas.gasWanted(100_000, true, true, null, false));
    }

    @Test
    void pendingFollowsNextKey() {
        routes.put("/qorechain/crossvm/v1/pending", q -> q.contains("pagination.key=k2")
                ? "{\"messages\":[{\"id\":\"3\"}],\"count\":1,\"pagination\":{\"next_key\":null}}"
                : q.contains("pagination.key=k1")
                        ? "{\"messages\":[{\"id\":\"2\"}],\"count\":1,\"pagination\":{\"next_key\":\"k2\"}}"
                        : "{\"messages\":[{\"id\":\"1\"}],\"count\":1,\"pagination\":{\"next_key\":\"k1\"}}");
        List<JsonNode> all = CrossVMClient.listPending(new RestClient(baseUrl));
        assertEquals(List.of("1", "2", "3"), all.stream().map(n -> n.get("id").asText()).toList());
        assertThrows(IllegalStateException.class, () -> CrossVMClient.listPending(new RestClient(baseUrl), 2));
    }

    // ---- 5. EVM window ----

    @Test
    void evmWindowPolicyFields() {
        String sender = Address.bytesToBech32(new byte[20]);
        String valoper = Address.bytesToBech32(new byte[20], "qorvaloper");
        var m = (qorechain.pqc.v1.Tx.MsgOpenEVMWindow) EvmWindow.openWithPolicy(sender, 100, 10, "1000", false,
                null, List.of("0x" + "ab".repeat(20)), List.of(valoper), List.of("channel-0/cosmos1abc")).message;
        assertEquals(1, m.getValidatorsCount());
        assertEquals(valoper, m.getStakingValidators(0));
        assertEquals("channel-0/cosmos1abc", m.getIbcReceivers(0));
        assertThrows(IllegalArgumentException.class, () -> EvmWindow.openWithPolicy(sender, 100, 10, "1000",
                false, null, List.of("0x12"), null, null));
        assertThrows(IllegalArgumentException.class, () -> EvmWindow.openWithPolicy(sender, 100, 10, "1000",
                false, null, null, List.of(sender), null));
        for (String bad : List.of("cosmos1abc", "channel-0/", "/cosmos1", "channel-0/a b", "channel-0/a,b")) {
            assertThrows(IllegalArgumentException.class, () -> EvmWindow.openWithPolicy(sender, 100, 10, "1000",
                    false, null, null, null, List.of(bad)), bad);
        }
    }

    // ---- 6. gas ----

    @Test
    void evmLimitsQuery() {
        routes.put("/qorechain/pqc/v1/evm_limits", q -> "{\"limits\":{\"tx_max_gas\":\"0\","
                + "\"precompile_input_max_bytes\":\"0\"},\"tx_max_gas\":\"30000000\",\"precompile_input_max_bytes\":\"65536\"}");
        EvmLimits l = new RestClient(baseUrl).evmLimits();
        assertEquals(30_000_000L, l.txMaxGas);
        assertEquals(65_536L, l.precompileInputMaxBytes);
        l.checkGasLimit(30_000_000L);
        assertThrows(IllegalArgumentException.class, () -> l.checkGasLimit(30_000_001L));
        EvmLimits fallback = EvmLimits.of(MAPPER.createObjectNode().set("limits",
                MAPPER.createObjectNode().put("tx_max_gas", "20000000")));
        assertEquals(20_000_000L, fallback.txMaxGas);
        assertEquals(GasLimits.DEFAULT_EVM_TX_MAX_GAS, EvmLimits.of(MAPPER.createObjectNode()).txMaxGas);
    }

    @Test
    void gasCaps() {
        Account a = Accounts.deriveNativeAccount(MNEMONIC, 0);
        NativeTx.Options o = new NativeTx.Options();
        o.messages = List.of(NativeTx.bankSend(a.address, a.address, List.of(new StdFee.Coin("uqor", "1"))));
        o.secp256k1PrivateKey = a.privateKey;
        o.secp256k1PublicKey = a.publicKey;
        o.chainId = CHAIN;
        o.fee = StdFee.of("uqor", "1", "50000000");
        assertNotNull(NativeTx.buildAndSign(o));
        o.fee = StdFee.of("uqor", "1", "50000001");
        assertThrows(IllegalArgumentException.class, () -> NativeTx.buildAndSign(o));
        assertThrows(IllegalArgumentException.class, () -> Authenticator.executeEvmMsg(
                a.address, ACCOUNT, "secp256k1", new byte[33], new byte[64], "0x" + "11".repeat(20), "0",
                new byte[0], 30_000_001L, 0));
        assertThrows(IllegalArgumentException.class, () -> Authenticator.evmAuthSignBytesV2(
                CHAIN, ACCOUNT, new byte[33], "", "0", new byte[0], 0, 30_000_001L));
        assertTrue(GasLimits.carriesWasmOrCrossVm(List.of(asyncWasmMsg())));
        assertFalse(GasLimits.carriesWasmOrCrossVm(o.messages));
    }

    private TypedMessage asyncWasmMsg() {
        return client(null, null).buildCall(asyncWasm());
    }

    // ---- 8. minimum gas price ----

    @Test
    void minGasPriceHelpers() {
        routes.put("/cosmos/evm/feemarket/v1/params",
                q -> "{\"params\":{\"min_gas_price\":\"250000000000.500000000000000000\"}}");
        RestClient rest = new RestClient(baseUrl);
        assertEquals(0, new BigDecimal("0.2500000000005").compareTo(GasPrice.fetchMinGasPriceUqor(rest)));
        assertEquals(0, new BigDecimal("0.37500000000075").compareTo(GasPrice.recommendedGasPriceUqor(rest)));
        routes.put("/cosmos/evm/feemarket/v1/params", q -> "{\"params\":{\"min_gas_price\":\"0.000000000000000000\"}}");
        assertEquals(0, new BigDecimal("0.1").compareTo(GasPrice.fetchMinGasPriceUqor(rest)));
        assertEquals(0, new BigDecimal("0.15").compareTo(GasPrice.recommendedGasPriceUqor(rest)));
        assertEquals(0, new BigDecimal("0.2").compareTo(
                GasPrice.recommendedGasPriceUqor(new BigDecimal("0.1"), new BigDecimal("2"))));
        assertThrows(IllegalArgumentException.class,
                () -> GasPrice.recommendedGasPriceUqor(new BigDecimal("0.1"), new BigDecimal("0.5")));
        // the default price is untouched
        assertEquals("0.15uqor", GasPrice.DEFAULT_GAS_PRICE);
    }
}
