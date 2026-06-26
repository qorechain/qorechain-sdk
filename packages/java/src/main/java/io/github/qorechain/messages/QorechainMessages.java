package io.github.qorechain.messages;

/**
 * Typed composers for every QoreChain custom-module {@code Msg} (49 total).
 *
 * <p>Each method wraps an already-built protobuf message in a {@link TypedMessage}
 * carrying the correct on-chain type URL, ready to feed into the tx builder. The
 * methods are grouped by module to mirror the other-language SDKs (e.g.
 * {@code QorechainMessages.amm.createPool(msg)}).
 */
public final class QorechainMessages {

    private QorechainMessages() {}

    /** AMM module composers. */
    public static final class amm {
        private amm() {}

        public static TypedMessage createPool(qorechain.amm.v1.Tx.MsgCreatePool m) {
            return new TypedMessage("/qorechain.amm.v1.MsgCreatePool", m);
        }

        public static TypedMessage addLiquidity(qorechain.amm.v1.Tx.MsgAddLiquidity m) {
            return new TypedMessage("/qorechain.amm.v1.MsgAddLiquidity", m);
        }

        public static TypedMessage removeLiquidity(qorechain.amm.v1.Tx.MsgRemoveLiquidity m) {
            return new TypedMessage("/qorechain.amm.v1.MsgRemoveLiquidity", m);
        }

        public static TypedMessage swapExactIn(qorechain.amm.v1.Tx.MsgSwapExactIn m) {
            return new TypedMessage("/qorechain.amm.v1.MsgSwapExactIn", m);
        }

        public static TypedMessage swapExactOut(qorechain.amm.v1.Tx.MsgSwapExactOut m) {
            return new TypedMessage("/qorechain.amm.v1.MsgSwapExactOut", m);
        }

        public static TypedMessage pausePool(qorechain.amm.v1.Tx.MsgPausePool m) {
            return new TypedMessage("/qorechain.amm.v1.MsgPausePool", m);
        }

        public static TypedMessage resumePool(qorechain.amm.v1.Tx.MsgResumePool m) {
            return new TypedMessage("/qorechain.amm.v1.MsgResumePool", m);
        }
    }

    /** Bridge module composers. */
    public static final class bridge {
        private bridge() {}

        public static TypedMessage bridgeDeposit(qorechain.bridge.v1.Tx.MsgBridgeDeposit m) {
            return new TypedMessage("/qorechain.bridge.v1.MsgBridgeDeposit", m);
        }

        public static TypedMessage bridgeWithdraw(qorechain.bridge.v1.Tx.MsgBridgeWithdraw m) {
            return new TypedMessage("/qorechain.bridge.v1.MsgBridgeWithdraw", m);
        }

        public static TypedMessage registerBridgeValidator(
                qorechain.bridge.v1.Tx.MsgRegisterBridgeValidator m) {
            return new TypedMessage("/qorechain.bridge.v1.MsgRegisterBridgeValidator", m);
        }

        public static TypedMessage bridgeAttestation(qorechain.bridge.v1.Tx.MsgBridgeAttestation m) {
            return new TypedMessage("/qorechain.bridge.v1.MsgBridgeAttestation", m);
        }
    }

    /** RDK (rollup development kit) module composers. */
    public static final class rdk {
        private rdk() {}

        public static TypedMessage createRollup(qorechain.rdk.v1.Tx.MsgCreateRollup m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgCreateRollup", m);
        }

        public static TypedMessage submitBatch(qorechain.rdk.v1.Tx.MsgSubmitBatch m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgSubmitBatch", m);
        }

        public static TypedMessage challengeBatch(qorechain.rdk.v1.Tx.MsgChallengeBatch m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgChallengeBatch", m);
        }

        public static TypedMessage resolveChallenge(qorechain.rdk.v1.Tx.MsgResolveChallenge m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgResolveChallenge", m);
        }

        public static TypedMessage pauseRollup(qorechain.rdk.v1.Tx.MsgPauseRollup m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgPauseRollup", m);
        }

        public static TypedMessage resumeRollup(qorechain.rdk.v1.Tx.MsgResumeRollup m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgResumeRollup", m);
        }

        public static TypedMessage stopRollup(qorechain.rdk.v1.Tx.MsgStopRollup m) {
            return new TypedMessage("/qorechain.rdk.v1.MsgStopRollup", m);
        }
    }

    /** Multilayer module composers. */
    public static final class multilayer {
        private multilayer() {}

        public static TypedMessage registerSidechain(
                qorechain.multilayer.v1.Tx.MsgRegisterSidechain m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgRegisterSidechain", m);
        }

        public static TypedMessage registerPaychain(
                qorechain.multilayer.v1.Tx.MsgRegisterPaychain m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgRegisterPaychain", m);
        }

        public static TypedMessage anchorState(qorechain.multilayer.v1.Tx.MsgAnchorState m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgAnchorState", m);
        }

        public static TypedMessage routeTransaction(
                qorechain.multilayer.v1.Tx.MsgRouteTransaction m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgRouteTransaction", m);
        }

        public static TypedMessage updateLayerStatus(
                qorechain.multilayer.v1.Tx.MsgUpdateLayerStatus m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgUpdateLayerStatus", m);
        }

        public static TypedMessage challengeAnchor(
                qorechain.multilayer.v1.Tx.MsgChallengeAnchor m) {
            return new TypedMessage("/qorechain.multilayer.v1.MsgChallengeAnchor", m);
        }
    }

    /** PQC module composers. */
    public static final class pqc {
        private pqc() {}

        public static TypedMessage registerPqcKey(qorechain.pqc.v1.Tx.MsgRegisterPQCKey m) {
            return new TypedMessage("/qorechain.pqc.v1.MsgRegisterPQCKey", m);
        }

        public static TypedMessage registerPqcKeyV2(qorechain.pqc.v1.Tx.MsgRegisterPQCKeyV2 m) {
            return new TypedMessage("/qorechain.pqc.v1.MsgRegisterPQCKeyV2", m);
        }

        public static TypedMessage migratePqcKey(qorechain.pqc.v1.Tx.MsgMigratePQCKey m) {
            return new TypedMessage("/qorechain.pqc.v1.MsgMigratePQCKey", m);
        }

        public static TypedMessage deprecateAlgorithm(
                qorechain.pqc.v1.Tx.MsgDeprecateAlgorithm m) {
            return new TypedMessage("/qorechain.pqc.v1.MsgDeprecateAlgorithm", m);
        }

        public static TypedMessage disableAlgorithm(qorechain.pqc.v1.Tx.MsgDisableAlgorithm m) {
            return new TypedMessage("/qorechain.pqc.v1.MsgDisableAlgorithm", m);
        }
    }

    /** SVM module composers. */
    public static final class svm {
        private svm() {}

        public static TypedMessage deployProgram(qorechain.svm.v1.Tx.MsgDeployProgram m) {
            return new TypedMessage("/qorechain.svm.v1.MsgDeployProgram", m);
        }

        public static TypedMessage createAccount(qorechain.svm.v1.Tx.MsgCreateAccount m) {
            return new TypedMessage("/qorechain.svm.v1.MsgCreateAccount", m);
        }

        public static TypedMessage executeProgram(qorechain.svm.v1.Tx.MsgExecuteProgram m) {
            return new TypedMessage("/qorechain.svm.v1.MsgExecuteProgram", m);
        }

        public static TypedMessage registerSvmPqcKey(qorechain.svm.v1.Tx.MsgRegisterSVMPQCKey m) {
            return new TypedMessage("/qorechain.svm.v1.MsgRegisterSVMPQCKey", m);
        }
    }

    /** Light-node module composers. */
    public static final class lightnode {
        private lightnode() {}

        public static TypedMessage registerLightNode(
                qorechain.lightnode.v1.Tx.MsgRegisterLightNode m) {
            return new TypedMessage("/qorechain.lightnode.v1.MsgRegisterLightNode", m);
        }

        public static TypedMessage heartbeat(qorechain.lightnode.v1.Tx.MsgHeartbeat m) {
            return new TypedMessage("/qorechain.lightnode.v1.MsgHeartbeat", m);
        }

        public static TypedMessage deregisterLightNode(
                qorechain.lightnode.v1.Tx.MsgDeregisterLightNode m) {
            return new TypedMessage("/qorechain.lightnode.v1.MsgDeregisterLightNode", m);
        }

        public static TypedMessage claimLightNodeRewards(
                qorechain.lightnode.v1.Tx.MsgClaimLightNodeRewards m) {
            return new TypedMessage("/qorechain.lightnode.v1.MsgClaimLightNodeRewards", m);
        }
    }

    /** License module composers. */
    public static final class license {
        private license() {}

        public static TypedMessage grantLicense(qorechain.license.v1.Tx.MsgGrantLicense m) {
            return new TypedMessage("/qorechain.license.v1.MsgGrantLicense", m);
        }

        public static TypedMessage revokeLicense(qorechain.license.v1.Tx.MsgRevokeLicense m) {
            return new TypedMessage("/qorechain.license.v1.MsgRevokeLicense", m);
        }

        public static TypedMessage suspendLicense(qorechain.license.v1.Tx.MsgSuspendLicense m) {
            return new TypedMessage("/qorechain.license.v1.MsgSuspendLicense", m);
        }

        public static TypedMessage resumeLicense(qorechain.license.v1.Tx.MsgResumeLicense m) {
            return new TypedMessage("/qorechain.license.v1.MsgResumeLicense", m);
        }
    }

    /** Abstract-account module composers. */
    public static final class abstractaccount {
        private abstractaccount() {}

        public static TypedMessage createAbstractAccount(
                qorechain.abstractaccount.v1.Tx.MsgCreateAbstractAccount m) {
            return new TypedMessage("/qorechain.abstractaccount.v1.MsgCreateAbstractAccount", m);
        }

        public static TypedMessage updateSpendingRules(
                qorechain.abstractaccount.v1.Tx.MsgUpdateSpendingRules m) {
            return new TypedMessage("/qorechain.abstractaccount.v1.MsgUpdateSpendingRules", m);
        }
    }

    /** Cross-VM module composers. */
    public static final class crossvm {
        private crossvm() {}

        public static TypedMessage crossVmCall(qorechain.crossvm.v1.Tx.MsgCrossVMCall m) {
            return new TypedMessage("/qorechain.crossvm.v1.MsgCrossVMCall", m);
        }

        public static TypedMessage processQueue(qorechain.crossvm.v1.Tx.MsgProcessQueue m) {
            return new TypedMessage("/qorechain.crossvm.v1.MsgProcessQueue", m);
        }
    }

    /** RL-consensus module composers. */
    public static final class rlconsensus {
        private rlconsensus() {}

        public static TypedMessage setAgentMode(qorechain.rlconsensus.v1.Tx.MsgSetAgentMode m) {
            return new TypedMessage("/qorechain.rlconsensus.v1.MsgSetAgentMode", m);
        }

        public static TypedMessage resumeAgent(qorechain.rlconsensus.v1.Tx.MsgResumeAgent m) {
            return new TypedMessage("/qorechain.rlconsensus.v1.MsgResumeAgent", m);
        }

        public static TypedMessage updatePolicy(qorechain.rlconsensus.v1.Tx.MsgUpdatePolicy m) {
            return new TypedMessage("/qorechain.rlconsensus.v1.MsgUpdatePolicy", m);
        }

        public static TypedMessage updateRewardWeights(
                qorechain.rlconsensus.v1.Tx.MsgUpdateRewardWeights m) {
            return new TypedMessage("/qorechain.rlconsensus.v1.MsgUpdateRewardWeights", m);
        }
    }
}
