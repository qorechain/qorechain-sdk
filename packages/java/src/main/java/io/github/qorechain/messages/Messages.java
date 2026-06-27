package io.github.qorechain.messages;

import com.google.protobuf.Any;
import com.google.protobuf.ByteString;
import com.google.protobuf.InvalidProtocolBufferException;
import com.google.protobuf.Message;
import com.google.protobuf.Parser;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * The QoreChain message registry: a {@code typeUrl → protobuf Parser} map plus
 * Cosmos-style {@link Any} pack/unpack.
 *
 * <p>Covers all 53 QoreChain custom-module {@code Msg} types (amm, bridge, rdk,
 * multilayer, pqc, svm, lightnode, license, abstractaccount, crossvm,
 * rlconsensus) and the standard Cosmos messages exposed by {@link CosmosMessages}.
 *
 * <p>Cosmos packs messages into {@code Any} with a bare leading-slash type URL
 * (e.g. {@code /qorechain.amm.v1.MsgCreatePool}) — NOT protobuf-java's default
 * {@code type.googleapis.com/} prefix — so {@link #pack} and {@link #unpack}
 * build/read the {@code Any} fields directly.
 */
public final class Messages {

    private Messages() {}

    private static final Map<String, Parser<? extends Message>> REGISTRY;

    static {
        Map<String, Parser<? extends Message>> m = new LinkedHashMap<>();

        // ---- Standard Cosmos messages ----
        m.put("/cosmos.bank.v1beta1.MsgSend", cosmos.bank.v1beta1.Tx.MsgSend.parser());
        m.put("/cosmos.bank.v1beta1.MsgMultiSend", cosmos.bank.v1beta1.Tx.MsgMultiSend.parser());

        // ---- amm (7) ----
        m.put("/qorechain.amm.v1.MsgCreatePool", qorechain.amm.v1.Tx.MsgCreatePool.parser());
        m.put("/qorechain.amm.v1.MsgAddLiquidity", qorechain.amm.v1.Tx.MsgAddLiquidity.parser());
        m.put("/qorechain.amm.v1.MsgRemoveLiquidity", qorechain.amm.v1.Tx.MsgRemoveLiquidity.parser());
        m.put("/qorechain.amm.v1.MsgSwapExactIn", qorechain.amm.v1.Tx.MsgSwapExactIn.parser());
        m.put("/qorechain.amm.v1.MsgSwapExactOut", qorechain.amm.v1.Tx.MsgSwapExactOut.parser());
        m.put("/qorechain.amm.v1.MsgPausePool", qorechain.amm.v1.Tx.MsgPausePool.parser());
        m.put("/qorechain.amm.v1.MsgResumePool", qorechain.amm.v1.Tx.MsgResumePool.parser());

        // ---- bridge (7) ----
        m.put("/qorechain.bridge.v1.MsgBridgeDeposit", qorechain.bridge.v1.Tx.MsgBridgeDeposit.parser());
        m.put("/qorechain.bridge.v1.MsgBridgeWithdraw", qorechain.bridge.v1.Tx.MsgBridgeWithdraw.parser());
        m.put("/qorechain.bridge.v1.MsgRegisterBridgeValidator", qorechain.bridge.v1.Tx.MsgRegisterBridgeValidator.parser());
        m.put("/qorechain.bridge.v1.MsgBridgeAttestation", qorechain.bridge.v1.Tx.MsgBridgeAttestation.parser());
        m.put("/qorechain.bridge.v1.MsgUpdateEthLightClient", qorechain.bridge.v1.Tx.MsgUpdateEthLightClient.parser());
        m.put("/qorechain.bridge.v1.MsgUpdateChainConfig", qorechain.bridge.v1.Tx.MsgUpdateChainConfig.parser());
        m.put("/qorechain.bridge.v1.MsgSetVerifierBootstrap", qorechain.bridge.v1.Tx.MsgSetVerifierBootstrap.parser());

        // ---- rdk (8) ----
        m.put("/qorechain.rdk.v1.MsgCreateRollup", qorechain.rdk.v1.Tx.MsgCreateRollup.parser());
        m.put("/qorechain.rdk.v1.MsgSubmitBatch", qorechain.rdk.v1.Tx.MsgSubmitBatch.parser());
        m.put("/qorechain.rdk.v1.MsgChallengeBatch", qorechain.rdk.v1.Tx.MsgChallengeBatch.parser());
        m.put("/qorechain.rdk.v1.MsgResolveChallenge", qorechain.rdk.v1.Tx.MsgResolveChallenge.parser());
        m.put("/qorechain.rdk.v1.MsgPauseRollup", qorechain.rdk.v1.Tx.MsgPauseRollup.parser());
        m.put("/qorechain.rdk.v1.MsgResumeRollup", qorechain.rdk.v1.Tx.MsgResumeRollup.parser());
        m.put("/qorechain.rdk.v1.MsgStopRollup", qorechain.rdk.v1.Tx.MsgStopRollup.parser());
        m.put("/qorechain.rdk.v1.MsgExecuteWithdrawal", qorechain.rdk.v1.Tx.MsgExecuteWithdrawal.parser());

        // ---- multilayer (6) ----
        m.put("/qorechain.multilayer.v1.MsgRegisterSidechain", qorechain.multilayer.v1.Tx.MsgRegisterSidechain.parser());
        m.put("/qorechain.multilayer.v1.MsgRegisterPaychain", qorechain.multilayer.v1.Tx.MsgRegisterPaychain.parser());
        m.put("/qorechain.multilayer.v1.MsgAnchorState", qorechain.multilayer.v1.Tx.MsgAnchorState.parser());
        m.put("/qorechain.multilayer.v1.MsgRouteTransaction", qorechain.multilayer.v1.Tx.MsgRouteTransaction.parser());
        m.put("/qorechain.multilayer.v1.MsgUpdateLayerStatus", qorechain.multilayer.v1.Tx.MsgUpdateLayerStatus.parser());
        m.put("/qorechain.multilayer.v1.MsgChallengeAnchor", qorechain.multilayer.v1.Tx.MsgChallengeAnchor.parser());

        // ---- pqc (5) ----
        m.put("/qorechain.pqc.v1.MsgRegisterPQCKey", qorechain.pqc.v1.Tx.MsgRegisterPQCKey.parser());
        m.put("/qorechain.pqc.v1.MsgRegisterPQCKeyV2", qorechain.pqc.v1.Tx.MsgRegisterPQCKeyV2.parser());
        m.put("/qorechain.pqc.v1.MsgMigratePQCKey", qorechain.pqc.v1.Tx.MsgMigratePQCKey.parser());
        m.put("/qorechain.pqc.v1.MsgDeprecateAlgorithm", qorechain.pqc.v1.Tx.MsgDeprecateAlgorithm.parser());
        m.put("/qorechain.pqc.v1.MsgDisableAlgorithm", qorechain.pqc.v1.Tx.MsgDisableAlgorithm.parser());

        // ---- svm (4) ----
        m.put("/qorechain.svm.v1.MsgDeployProgram", qorechain.svm.v1.Tx.MsgDeployProgram.parser());
        m.put("/qorechain.svm.v1.MsgCreateAccount", qorechain.svm.v1.Tx.MsgCreateAccount.parser());
        m.put("/qorechain.svm.v1.MsgExecuteProgram", qorechain.svm.v1.Tx.MsgExecuteProgram.parser());
        m.put("/qorechain.svm.v1.MsgRegisterSVMPQCKey", qorechain.svm.v1.Tx.MsgRegisterSVMPQCKey.parser());

        // ---- lightnode (4) ----
        m.put("/qorechain.lightnode.v1.MsgRegisterLightNode", qorechain.lightnode.v1.Tx.MsgRegisterLightNode.parser());
        m.put("/qorechain.lightnode.v1.MsgHeartbeat", qorechain.lightnode.v1.Tx.MsgHeartbeat.parser());
        m.put("/qorechain.lightnode.v1.MsgDeregisterLightNode", qorechain.lightnode.v1.Tx.MsgDeregisterLightNode.parser());
        m.put("/qorechain.lightnode.v1.MsgClaimLightNodeRewards", qorechain.lightnode.v1.Tx.MsgClaimLightNodeRewards.parser());

        // ---- license (4) ----
        m.put("/qorechain.license.v1.MsgGrantLicense", qorechain.license.v1.Tx.MsgGrantLicense.parser());
        m.put("/qorechain.license.v1.MsgRevokeLicense", qorechain.license.v1.Tx.MsgRevokeLicense.parser());
        m.put("/qorechain.license.v1.MsgSuspendLicense", qorechain.license.v1.Tx.MsgSuspendLicense.parser());
        m.put("/qorechain.license.v1.MsgResumeLicense", qorechain.license.v1.Tx.MsgResumeLicense.parser());

        // ---- abstractaccount (2) ----
        m.put("/qorechain.abstractaccount.v1.MsgCreateAbstractAccount", qorechain.abstractaccount.v1.Tx.MsgCreateAbstractAccount.parser());
        m.put("/qorechain.abstractaccount.v1.MsgUpdateSpendingRules", qorechain.abstractaccount.v1.Tx.MsgUpdateSpendingRules.parser());

        // ---- crossvm (2) ----
        m.put("/qorechain.crossvm.v1.MsgCrossVMCall", qorechain.crossvm.v1.Tx.MsgCrossVMCall.parser());
        m.put("/qorechain.crossvm.v1.MsgProcessQueue", qorechain.crossvm.v1.Tx.MsgProcessQueue.parser());

        // ---- rlconsensus (4) ----
        m.put("/qorechain.rlconsensus.v1.MsgSetAgentMode", qorechain.rlconsensus.v1.Tx.MsgSetAgentMode.parser());
        m.put("/qorechain.rlconsensus.v1.MsgResumeAgent", qorechain.rlconsensus.v1.Tx.MsgResumeAgent.parser());
        m.put("/qorechain.rlconsensus.v1.MsgUpdatePolicy", qorechain.rlconsensus.v1.Tx.MsgUpdatePolicy.parser());
        m.put("/qorechain.rlconsensus.v1.MsgUpdateRewardWeights", qorechain.rlconsensus.v1.Tx.MsgUpdateRewardWeights.parser());

        REGISTRY = Collections.unmodifiableMap(m);
    }

    /** All registered type URLs (Cosmos standard + 53 QoreChain customs). */
    public static Set<String> typeUrls() {
        return REGISTRY.keySet();
    }

    /** True if the type URL is registered. */
    public static boolean isRegistered(String typeUrl) {
        return REGISTRY.containsKey(typeUrl);
    }

    /** The protobuf parser for a registered type URL, or null if unknown. */
    public static Parser<? extends Message> parser(String typeUrl) {
        return REGISTRY.get(typeUrl);
    }

    /** Pack a message into a Cosmos-style {@link Any} with a bare leading-slash type URL. */
    public static Any pack(String typeUrl, Message message) {
        return Any.newBuilder()
                .setTypeUrl(typeUrl)
                .setValue(message.toByteString())
                .build();
    }

    /** Pack a {@link TypedMessage} into a Cosmos-style {@link Any}. */
    public static Any pack(TypedMessage tm) {
        return pack(tm.typeUrl, tm.message);
    }

    /**
     * Unpack a Cosmos-style {@link Any} into its concrete message via the registry.
     *
     * @throws IllegalArgumentException if the type URL is not registered.
     * @throws InvalidProtocolBufferException if the bytes do not decode.
     */
    public static Message unpack(Any any) throws InvalidProtocolBufferException {
        Parser<? extends Message> parser = REGISTRY.get(any.getTypeUrl());
        if (parser == null) {
            throw new IllegalArgumentException("unregistered type URL: " + any.getTypeUrl());
        }
        return parser.parseFrom(any.getValue());
    }

    /** Build an {@link Any} from a raw type URL and value bytes. */
    public static Any anyOf(String typeUrl, ByteString value) {
        return Any.newBuilder().setTypeUrl(typeUrl).setValue(value).build();
    }
}
