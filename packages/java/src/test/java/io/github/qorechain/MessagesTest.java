package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.Any;
import com.google.protobuf.Message;
import io.github.qorechain.messages.Messages;
import io.github.qorechain.messages.QorechainMessages;
import io.github.qorechain.messages.TypedMessage;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Registry coverage of all 49 QoreChain custom messages + Any pack/unpack round-trip. */
class MessagesTest {

    /** The 49 QoreChain custom Msg type URLs (amm 7, bridge 4, rdk 7, multilayer 6, pqc 5,
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
                    "/qorechain.rdk.v1.MsgCreateRollup",
                    "/qorechain.rdk.v1.MsgSubmitBatch",
                    "/qorechain.rdk.v1.MsgChallengeBatch",
                    "/qorechain.rdk.v1.MsgResolveChallenge",
                    "/qorechain.rdk.v1.MsgPauseRollup",
                    "/qorechain.rdk.v1.MsgResumeRollup",
                    "/qorechain.rdk.v1.MsgStopRollup",
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
    void allFortyNineCustomTypeUrlsRegistered() {
        assertEquals(49, QORECHAIN_TYPE_URLS.size());
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
    void packUsesBareSlashTypeUrlNotGoogleApis() {
        qorechain.pqc.v1.Tx.MsgRegisterPQCKey msg =
                qorechain.pqc.v1.Tx.MsgRegisterPQCKey.newBuilder().build();
        Any any = Messages.pack("/qorechain.pqc.v1.MsgRegisterPQCKey", msg);
        assertTrue(any.getTypeUrl().startsWith("/qorechain"));
        assertEquals("/qorechain.pqc.v1.MsgRegisterPQCKey", any.getTypeUrl());
    }
}
