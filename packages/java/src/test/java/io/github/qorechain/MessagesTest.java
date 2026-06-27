package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.Any;
import com.google.protobuf.ByteString;
import com.google.protobuf.Message;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Registry coverage of all 53 QoreChain custom messages + Any pack/unpack round-trip. */
class MessagesTest {

    /** The 53 QoreChain custom Msg type URLs (amm 7, bridge 7, rdk 8, multilayer 6, pqc 5,
     * svm 4, lightnode 4, license 4, abstractaccount 2, crossvm 2, rlconsensus 4). */
    private static final List<String> QORECHAIN_TYPE_URLS =
            List.of(
                    "/qorechain.amm.v1.MsgCreatePool",
                    "/qorechain.amm.v1.MsgAddLiquidity",
                    "/qorechain.amm.v1.MsgRemoveLiquidity",
                    "/qorechain.amm.v1.MsgSwapExactIn",
                    "/qorechain.amm.v1.MsgSwapExactOut",
                    "/qorechain.amm.v1.MsgPausePool",
                    "/qorechain.amm.v1.MsgResumePool",
                    "/qorechain.bridge.v1.MsgBridgeDeposit",
                    "/qorechain.bridge.v1.MsgBridgeWithdraw",
                    "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
                    "/qorechain.bridge.v1.MsgBridgeAttestation",
                    "/qorechain.bridge.v1.MsgUpdateEthLightClient",
                    "/qorechain.bridge.v1.MsgUpdateChainConfig",
                    "/qorechain.bridge.v1.MsgSetVerifierBootstrap",
                    "/qorechain.rdk.v1.MsgCreateRollup",
                    "/qorechain.rdk.v1.MsgSubmitBatch",
                    "/qorechain.rdk.v1.MsgChallengeBatch",
                    "/qorechain.rdk.v1.MsgResolveChallenge",
                    "/qorechain.rdk.v1.MsgPauseRollup",
                    "/qorechain.rdk.v1.MsgResumeRollup",
                    "/qorechain.rdk.v1.MsgStopRollup",
                    "/qorechain.rdk.v1.MsgExecuteWithdrawal",
                    "/qorechain.multilayer.v1.MsgRegisterSidechain",
                    "/qorechain.multilayer.v1.MsgRegisterPaychain",
                    "/qorechain.multilayer.v1.MsgAnchorState",
                    "/qorechain.multilayer.v1.MsgRouteTransaction",
                    "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
                    "/qorechain.multilayer.v1.MsgChallengeAnchor",
                    "/qorechain.pqc.v1.MsgRegisterPQCKey",
                    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
                    "/qorechain.pqc.v1.MsgMigratePQCKey",
                    "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
                    "/qorechain.pqc.v1.MsgDisableAlgorithm",
                    "/qorechain.svm.v1.MsgDeployProgram",
                    "/qorechain.svm.v1.MsgCreateAccount",
                    "/qorechain.svm.v1.MsgExecuteProgram",
                    "/qorechain.svm.v1.MsgRegisterSVMPQCKey",
                    "/qorechain.lightnode.v1.MsgRegisterLightNode",
                    "/qorechain.lightnode.v1.MsgHeartbeat",
                    "/qorechain.lightnode.v1.MsgDeregisterLightNode",
                    "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
                    "/qorechain.license.v1.MsgGrantLicense",
                    "/qorechain.license.v1.MsgRevokeLicense",
                    "/qorechain.license.v1.MsgSuspendLicense",
                    "/qorechain.license.v1.MsgResumeLicense",
                    "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
                    "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
                    "/qorechain.crossvm.v1.MsgCrossVMCall",
                    "/qorechain.crossvm.v1.MsgProcessQueue",
                    "/qorechain.rlconsensus.v1.MsgSetAgentMode",
                    "/qorechain.rlconsensus.v1.MsgResumeAgent",
                    "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
                    "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights");

    @Test
    void allCustomTypeUrlsRegistered() {
        assertEquals(53, QORECHAIN_TYPE_URLS.size());
        Set<String> registered = Messages.typeUrls();
        for (String url : QORECHAIN_TYPE_URLS) {
            assertTrue(registered.contains(url), "missing registry entry: " + url);
        }
        // The registry also carries the standard bank messages.
        assertTrue(registered.contains("/cosmos.bank.v1beta1.MsgSend"));
    }

    @Test
    void anyPackUnpackRoundTrip() throws Exception {
        // Compose a typed AMM message, pack to Any (bare slash type URL), unpack via registry.
        qorechain.amm.v1.Tx.MsgCreatePool msg =
                qorechain.amm.v1.Tx.MsgCreatePool.newBuilder().setCreator("qor1creator").build();
        TypedMessage tm = QorechainMessages.amm.createPool(msg);
        assertEquals("/qorechain.amm.v1.MsgCreatePool", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals("/qorechain.amm.v1.MsgCreatePool", any.getTypeUrl());

        Message decoded = Messages.unpack(any);
        assertTrue(decoded instanceof qorechain.amm.v1.Tx.MsgCreatePool);
        assertEquals("qor1creator", ((qorechain.amm.v1.Tx.MsgCreatePool) decoded).getCreator());
    }

    @Test
    void rdkExecuteWithdrawalTypeUrlAndRoundTrip() throws Exception {
        qorechain.rdk.v1.Tx.MsgExecuteWithdrawal msg =
                qorechain.rdk.v1.Tx.MsgExecuteWithdrawal.newBuilder()
                        .setSubmitter("qor1submitter")
                        .setRollupId("rollup-1")
                        .setBatchIndex(7)
                        .setWithdrawalIndex(3)
                        .setRecipient("qor1recipient")
                        .setDenom("uqor")
                        .setAmount(1000)
                        .addProof(ByteString.copyFromUtf8("sibling-0"))
                        .addProof(ByteString.copyFromUtf8("sibling-1"))
                        .build();
        TypedMessage tm = QorechainMessages.rdk.executeWithdrawal(msg);
        assertEquals("/qorechain.rdk.v1.MsgExecuteWithdrawal", tm.typeUrl);

        Any any = Messages.pack(tm);
        assertEquals("/qorechain.rdk.v1.MsgExecuteWithdrawal", any.getTypeUrl());

        Message decoded = Messages.unpack(any);
        assertTrue(decoded instanceof qorechain.rdk.v1.Tx.MsgExecuteWithdrawal);
        qorechain.rdk.v1.Tx.MsgExecuteWithdrawal back =
                (qorechain.rdk.v1.Tx.MsgExecuteWithdrawal) decoded;
        assertEquals("qor1submitter", back.getSubmitter());
        assertEquals(7, back.getBatchIndex());
        assertEquals(2, back.getProofCount());
    }

    @Test
    void bridgeAdminMsgTypeUrlsAndRoundTrip() throws Exception {
        // MsgUpdateEthLightClient
        qorechain.bridge.v1.Tx.MsgUpdateEthLightClient ethMsg =
                qorechain.bridge.v1.Tx.MsgUpdateEthLightClient.newBuilder()
                        .setRelayer("qor1relayer")
                        .setUpdate(ByteString.copyFromUtf8("altair-bundle"))
                        .build();
        TypedMessage ethTm = QorechainMessages.bridge.updateEthLightClient(ethMsg);
        assertEquals("/qorechain.bridge.v1.MsgUpdateEthLightClient", ethTm.typeUrl);
        Any ethAny = Messages.pack(ethTm);
        assertEquals("/qorechain.bridge.v1.MsgUpdateEthLightClient", ethAny.getTypeUrl());
        Message ethBack = Messages.unpack(ethAny);
        assertTrue(ethBack instanceof qorechain.bridge.v1.Tx.MsgUpdateEthLightClient);
        assertEquals(
                "qor1relayer",
                ((qorechain.bridge.v1.Tx.MsgUpdateEthLightClient) ethBack).getRelayer());

        // MsgUpdateChainConfig
        qorechain.bridge.v1.Tx.MsgUpdateChainConfig cfgMsg =
                qorechain.bridge.v1.Tx.MsgUpdateChainConfig.newBuilder()
                        .setAdmin("qor1admin")
                        .setChainId("eth")
                        .setStatus("active")
                        .setVerifier("light_client")
                        .build();
        TypedMessage cfgTm = QorechainMessages.bridge.updateChainConfig(cfgMsg);
        assertEquals("/qorechain.bridge.v1.MsgUpdateChainConfig", cfgTm.typeUrl);
        Any cfgAny = Messages.pack(cfgTm);
        Message cfgBack = Messages.unpack(cfgAny);
        assertTrue(cfgBack instanceof qorechain.bridge.v1.Tx.MsgUpdateChainConfig);
        assertEquals(
                "eth", ((qorechain.bridge.v1.Tx.MsgUpdateChainConfig) cfgBack).getChainId());

        // MsgSetVerifierBootstrap
        qorechain.bridge.v1.Tx.MsgSetVerifierBootstrap bsMsg =
                qorechain.bridge.v1.Tx.MsgSetVerifierBootstrap.newBuilder()
                        .setAdmin("qor1admin")
                        .setChainId("eth")
                        .build();
        TypedMessage bsTm = QorechainMessages.bridge.setVerifierBootstrap(bsMsg);
        assertEquals("/qorechain.bridge.v1.MsgSetVerifierBootstrap", bsTm.typeUrl);
        Any bsAny = Messages.pack(bsTm);
        Message bsBack = Messages.unpack(bsAny);
        assertTrue(bsBack instanceof qorechain.bridge.v1.Tx.MsgSetVerifierBootstrap);
        assertEquals(
                "qor1admin",
                ((qorechain.bridge.v1.Tx.MsgSetVerifierBootstrap) bsBack).getAdmin());
    }

    @Test
    void packUsesBareSlashTypeUrlNotGoogleApis() {
        qorechain.pqc.v1.Tx.MsgRegisterPQCKey msg =
                qorechain.pqc.v1.Tx.MsgRegisterPQCKey.newBuilder().build();
        Any any = Messages.pack("/qorechain.pqc.v1.MsgRegisterPQCKey", msg);
        assertTrue(any.getTypeUrl().startsWith("/qorechain"));
        assertEquals("/qorechain.pqc.v1.MsgRegisterPQCKey", any.getTypeUrl());
    }
}
