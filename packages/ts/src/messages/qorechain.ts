/**
 * Typed message composers for the QoreChain custom modules.
 *
 * Each composer takes the message's partial value and returns a cosmjs
 * {@link EncodeObject} (`{ typeUrl, value }`) ready to pass to
 * `TxClient.signAndBroadcast` / the hybrid tx path. The `value` is built via the
 * generated `Msg*.fromPartial`, so optional fields default correctly and the
 * input is fully typed.
 *
 * Composers are grouped by module and re-exported as a single `qorechain`
 * object (see {@link messages.ts}) so callers write e.g.
 * `msg.amm.swapExactIn({ ... })` or `msg.pqc.registerPqcKey({ ... })`.
 */

import type { EncodeObject } from "@cosmjs/proto-signing";

import * as ammTx from "../codegen/qorechain/amm/v1/tx";
import * as bridgeTx from "../codegen/qorechain/bridge/v1/tx";
import * as rdkTx from "../codegen/qorechain/rdk/v1/tx";
import * as multilayerTx from "../codegen/qorechain/multilayer/v1/tx";
import * as pqcTx from "../codegen/qorechain/pqc/v1/tx";
import * as svmTx from "../codegen/qorechain/svm/v1/tx";
import * as lightnodeTx from "../codegen/qorechain/lightnode/v1/tx";
import * as licenseTx from "../codegen/qorechain/license/v1/tx";
import * as abstractaccountTx from "../codegen/qorechain/abstractaccount/v1/tx";
import * as crossvmTx from "../codegen/qorechain/crossvm/v1/tx";
import * as rlconsensusTx from "../codegen/qorechain/rlconsensus/v1/tx";

/** A partial of a generated message (ts-proto `DeepPartial`-friendly). */
type Partial<T> = Parameters<{ fromPartial(o: never): T }["fromPartial"]> extends [
  infer P,
]
  ? P
  : never;

/** A generated message type with the methods the composers use. */
interface MsgType<T> {
  fromPartial(object: Partial<T>): T;
}

/** Build a `{ typeUrl, value }` composer bound to a fixed typeUrl + message. */
function composer<T>(typeUrl: string, msg: MsgType<T>) {
  return (value: Partial<T>): EncodeObject => ({
    typeUrl,
    value: msg.fromPartial(value),
  });
}

/** AMM (automated market maker) message composers. */
export const amm = {
  createPool: composer("/qorechain.amm.v1.MsgCreatePool", ammTx.MsgCreatePool),
  addLiquidity: composer(
    "/qorechain.amm.v1.MsgAddLiquidity",
    ammTx.MsgAddLiquidity,
  ),
  removeLiquidity: composer(
    "/qorechain.amm.v1.MsgRemoveLiquidity",
    ammTx.MsgRemoveLiquidity,
  ),
  swapExactIn: composer(
    "/qorechain.amm.v1.MsgSwapExactIn",
    ammTx.MsgSwapExactIn,
  ),
  swapExactOut: composer(
    "/qorechain.amm.v1.MsgSwapExactOut",
    ammTx.MsgSwapExactOut,
  ),
  pausePool: composer("/qorechain.amm.v1.MsgPausePool", ammTx.MsgPausePool),
  resumePool: composer("/qorechain.amm.v1.MsgResumePool", ammTx.MsgResumePool),
};

/** Bridge (cross-chain asset transfer) message composers. */
export const bridge = {
  bridgeDeposit: composer(
    "/qorechain.bridge.v1.MsgBridgeDeposit",
    bridgeTx.MsgBridgeDeposit,
  ),
  bridgeWithdraw: composer(
    "/qorechain.bridge.v1.MsgBridgeWithdraw",
    bridgeTx.MsgBridgeWithdraw,
  ),
  registerBridgeValidator: composer(
    "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
    bridgeTx.MsgRegisterBridgeValidator,
  ),
  bridgeAttestation: composer(
    "/qorechain.bridge.v1.MsgBridgeAttestation",
    bridgeTx.MsgBridgeAttestation,
  ),
};

/** RDK (rollup development kit) message composers. */
export const rdk = {
  createRollup: composer(
    "/qorechain.rdk.v1.MsgCreateRollup",
    rdkTx.MsgCreateRollup,
  ),
  submitBatch: composer(
    "/qorechain.rdk.v1.MsgSubmitBatch",
    rdkTx.MsgSubmitBatch,
  ),
  challengeBatch: composer(
    "/qorechain.rdk.v1.MsgChallengeBatch",
    rdkTx.MsgChallengeBatch,
  ),
  resolveChallenge: composer(
    "/qorechain.rdk.v1.MsgResolveChallenge",
    rdkTx.MsgResolveChallenge,
  ),
  pauseRollup: composer(
    "/qorechain.rdk.v1.MsgPauseRollup",
    rdkTx.MsgPauseRollup,
  ),
  resumeRollup: composer(
    "/qorechain.rdk.v1.MsgResumeRollup",
    rdkTx.MsgResumeRollup,
  ),
  stopRollup: composer("/qorechain.rdk.v1.MsgStopRollup", rdkTx.MsgStopRollup),
};

/** Multilayer (sidechain / paychain anchoring) message composers. */
export const multilayer = {
  registerSidechain: composer(
    "/qorechain.multilayer.v1.MsgRegisterSidechain",
    multilayerTx.MsgRegisterSidechain,
  ),
  registerPaychain: composer(
    "/qorechain.multilayer.v1.MsgRegisterPaychain",
    multilayerTx.MsgRegisterPaychain,
  ),
  anchorState: composer(
    "/qorechain.multilayer.v1.MsgAnchorState",
    multilayerTx.MsgAnchorState,
  ),
  routeTransaction: composer(
    "/qorechain.multilayer.v1.MsgRouteTransaction",
    multilayerTx.MsgRouteTransaction,
  ),
  updateLayerStatus: composer(
    "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
    multilayerTx.MsgUpdateLayerStatus,
  ),
  challengeAnchor: composer(
    "/qorechain.multilayer.v1.MsgChallengeAnchor",
    multilayerTx.MsgChallengeAnchor,
  ),
};

/** PQC (post-quantum key) message composers. */
export const pqc = {
  registerPqcKey: composer(
    "/qorechain.pqc.v1.MsgRegisterPQCKey",
    pqcTx.MsgRegisterPQCKey,
  ),
  registerPqcKeyV2: composer(
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
    pqcTx.MsgRegisterPQCKeyV2,
  ),
  migratePqcKey: composer(
    "/qorechain.pqc.v1.MsgMigratePQCKey",
    pqcTx.MsgMigratePQCKey,
  ),
  deprecateAlgorithm: composer(
    "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
    pqcTx.MsgDeprecateAlgorithm,
  ),
  disableAlgorithm: composer(
    "/qorechain.pqc.v1.MsgDisableAlgorithm",
    pqcTx.MsgDisableAlgorithm,
  ),
};

/** SVM (virtual machine programs/accounts) message composers. */
export const svm = {
  deployProgram: composer(
    "/qorechain.svm.v1.MsgDeployProgram",
    svmTx.MsgDeployProgram,
  ),
  createAccount: composer(
    "/qorechain.svm.v1.MsgCreateAccount",
    svmTx.MsgCreateAccount,
  ),
  executeProgram: composer(
    "/qorechain.svm.v1.MsgExecuteProgram",
    svmTx.MsgExecuteProgram,
  ),
  registerSvmPqcKey: composer(
    "/qorechain.svm.v1.MsgRegisterSVMPQCKey",
    svmTx.MsgRegisterSVMPQCKey,
  ),
};

/** Light-node lifecycle message composers. */
export const lightnode = {
  registerLightNode: composer(
    "/qorechain.lightnode.v1.MsgRegisterLightNode",
    lightnodeTx.MsgRegisterLightNode,
  ),
  heartbeat: composer(
    "/qorechain.lightnode.v1.MsgHeartbeat",
    lightnodeTx.MsgHeartbeat,
  ),
  deregisterLightNode: composer(
    "/qorechain.lightnode.v1.MsgDeregisterLightNode",
    lightnodeTx.MsgDeregisterLightNode,
  ),
  claimLightNodeRewards: composer(
    "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
    lightnodeTx.MsgClaimLightNodeRewards,
  ),
};

/** Feature-license message composers. */
export const license = {
  grantLicense: composer(
    "/qorechain.license.v1.MsgGrantLicense",
    licenseTx.MsgGrantLicense,
  ),
  revokeLicense: composer(
    "/qorechain.license.v1.MsgRevokeLicense",
    licenseTx.MsgRevokeLicense,
  ),
  suspendLicense: composer(
    "/qorechain.license.v1.MsgSuspendLicense",
    licenseTx.MsgSuspendLicense,
  ),
  resumeLicense: composer(
    "/qorechain.license.v1.MsgResumeLicense",
    licenseTx.MsgResumeLicense,
  ),
};

/** Abstract-account message composers. */
export const abstractaccount = {
  createAbstractAccount: composer(
    "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
    abstractaccountTx.MsgCreateAbstractAccount,
  ),
  updateSpendingRules: composer(
    "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
    abstractaccountTx.MsgUpdateSpendingRules,
  ),
};

/** Cross-VM message composers. */
export const crossvm = {
  crossVmCall: composer(
    "/qorechain.crossvm.v1.MsgCrossVMCall",
    crossvmTx.MsgCrossVMCall,
  ),
  processQueue: composer(
    "/qorechain.crossvm.v1.MsgProcessQueue",
    crossvmTx.MsgProcessQueue,
  ),
};

/** RL-consensus (governance authority) message composers. */
export const rlconsensus = {
  setAgentMode: composer(
    "/qorechain.rlconsensus.v1.MsgSetAgentMode",
    rlconsensusTx.MsgSetAgentMode,
  ),
  resumeAgent: composer(
    "/qorechain.rlconsensus.v1.MsgResumeAgent",
    rlconsensusTx.MsgResumeAgent,
  ),
  updatePolicy: composer(
    "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
    rlconsensusTx.MsgUpdatePolicy,
  ),
  updateRewardWeights: composer(
    "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
    rlconsensusTx.MsgUpdateRewardWeights,
  ),
};
