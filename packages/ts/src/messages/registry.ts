/**
 * Message registry for QoreChain transactions.
 *
 * {@link qorechainRegistry} returns a cosmjs {@link Registry} seeded with the
 * standard Cosmos SDK message types ({@link defaultRegistryTypes}: bank,
 * staking, distribution, gov, authz, feegrant, IBC transfer, …) plus every
 * QoreChain custom module message, keyed by its on-chain `typeUrl`. This is the
 * registry {@link TxClient} uses by default, so `signAndBroadcast` — and the
 * hybrid PQC tx path — can carry any supported message without extra setup.
 *
 * The generated message types are cosmjs-compatible: each exposes
 * `encode`/`decode`/`fromPartial`, which is all {@link Registry} requires.
 */

import {
  Registry,
  type GeneratedType,
} from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";

import * as amm from "../codegen/qorechain/amm/v1/tx";
import * as bridge from "../codegen/qorechain/bridge/v1/tx";
import * as rdk from "../codegen/qorechain/rdk/v1/tx";
import * as multilayer from "../codegen/qorechain/multilayer/v1/tx";
import * as pqc from "../codegen/qorechain/pqc/v1/tx";
import * as svm from "../codegen/qorechain/svm/v1/tx";
import * as lightnode from "../codegen/qorechain/lightnode/v1/tx";
import * as license from "../codegen/qorechain/license/v1/tx";
import * as abstractaccount from "../codegen/qorechain/abstractaccount/v1/tx";
import * as crossvm from "../codegen/qorechain/crossvm/v1/tx";
import * as rlconsensus from "../codegen/qorechain/rlconsensus/v1/tx";

/**
 * Every QoreChain custom-module message type, as `[typeUrl, GeneratedType]`
 * pairs ready to register. The `typeUrl` strings are the canonical on-chain
 * identifiers (`/qorechain.<module>.v1.Msg<Name>`).
 *
 * Generated `Msg*` objects satisfy cosmjs's structural `GeneratedType`
 * (encode/decode/fromPartial); the cast bridges the slightly wider ts-proto
 * `MessageFns` shape to that interface.
 */
export const qorechainRegistryTypes: ReadonlyArray<[string, GeneratedType]> = [
  // amm
  ["/qorechain.amm.v1.MsgCreatePool", amm.MsgCreatePool],
  ["/qorechain.amm.v1.MsgAddLiquidity", amm.MsgAddLiquidity],
  ["/qorechain.amm.v1.MsgRemoveLiquidity", amm.MsgRemoveLiquidity],
  ["/qorechain.amm.v1.MsgSwapExactIn", amm.MsgSwapExactIn],
  ["/qorechain.amm.v1.MsgSwapExactOut", amm.MsgSwapExactOut],
  ["/qorechain.amm.v1.MsgPausePool", amm.MsgPausePool],
  ["/qorechain.amm.v1.MsgResumePool", amm.MsgResumePool],
  // bridge
  ["/qorechain.bridge.v1.MsgBridgeDeposit", bridge.MsgBridgeDeposit],
  ["/qorechain.bridge.v1.MsgBridgeWithdraw", bridge.MsgBridgeWithdraw],
  [
    "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
    bridge.MsgRegisterBridgeValidator,
  ],
  ["/qorechain.bridge.v1.MsgBridgeAttestation", bridge.MsgBridgeAttestation],
  ["/qorechain.bridge.v1.MsgUpdateEthLightClient", bridge.MsgUpdateEthLightClient],
  ["/qorechain.bridge.v1.MsgUpdateChainConfig", bridge.MsgUpdateChainConfig],
  ["/qorechain.bridge.v1.MsgSetVerifierBootstrap", bridge.MsgSetVerifierBootstrap],
  // rdk
  ["/qorechain.rdk.v1.MsgCreateRollup", rdk.MsgCreateRollup],
  ["/qorechain.rdk.v1.MsgSubmitBatch", rdk.MsgSubmitBatch],
  ["/qorechain.rdk.v1.MsgChallengeBatch", rdk.MsgChallengeBatch],
  ["/qorechain.rdk.v1.MsgResolveChallenge", rdk.MsgResolveChallenge],
  ["/qorechain.rdk.v1.MsgPauseRollup", rdk.MsgPauseRollup],
  ["/qorechain.rdk.v1.MsgResumeRollup", rdk.MsgResumeRollup],
  ["/qorechain.rdk.v1.MsgStopRollup", rdk.MsgStopRollup],
  ["/qorechain.rdk.v1.MsgExecuteWithdrawal", rdk.MsgExecuteWithdrawal],
  // multilayer
  [
    "/qorechain.multilayer.v1.MsgRegisterSidechain",
    multilayer.MsgRegisterSidechain,
  ],
  [
    "/qorechain.multilayer.v1.MsgRegisterPaychain",
    multilayer.MsgRegisterPaychain,
  ],
  ["/qorechain.multilayer.v1.MsgAnchorState", multilayer.MsgAnchorState],
  [
    "/qorechain.multilayer.v1.MsgRouteTransaction",
    multilayer.MsgRouteTransaction,
  ],
  [
    "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
    multilayer.MsgUpdateLayerStatus,
  ],
  ["/qorechain.multilayer.v1.MsgChallengeAnchor", multilayer.MsgChallengeAnchor],
  // pqc
  ["/qorechain.pqc.v1.MsgRegisterPQCKey", pqc.MsgRegisterPQCKey],
  ["/qorechain.pqc.v1.MsgRegisterPQCKeyV2", pqc.MsgRegisterPQCKeyV2],
  ["/qorechain.pqc.v1.MsgMigratePQCKey", pqc.MsgMigratePQCKey],
  ["/qorechain.pqc.v1.MsgDeprecateAlgorithm", pqc.MsgDeprecateAlgorithm],
  ["/qorechain.pqc.v1.MsgDisableAlgorithm", pqc.MsgDisableAlgorithm],
  // svm
  ["/qorechain.svm.v1.MsgDeployProgram", svm.MsgDeployProgram],
  ["/qorechain.svm.v1.MsgCreateAccount", svm.MsgCreateAccount],
  ["/qorechain.svm.v1.MsgExecuteProgram", svm.MsgExecuteProgram],
  ["/qorechain.svm.v1.MsgRegisterSVMPQCKey", svm.MsgRegisterSVMPQCKey],
  // lightnode
  ["/qorechain.lightnode.v1.MsgRegisterLightNode", lightnode.MsgRegisterLightNode],
  ["/qorechain.lightnode.v1.MsgHeartbeat", lightnode.MsgHeartbeat],
  [
    "/qorechain.lightnode.v1.MsgDeregisterLightNode",
    lightnode.MsgDeregisterLightNode,
  ],
  [
    "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
    lightnode.MsgClaimLightNodeRewards,
  ],
  // license
  ["/qorechain.license.v1.MsgGrantLicense", license.MsgGrantLicense],
  ["/qorechain.license.v1.MsgRevokeLicense", license.MsgRevokeLicense],
  ["/qorechain.license.v1.MsgSuspendLicense", license.MsgSuspendLicense],
  ["/qorechain.license.v1.MsgResumeLicense", license.MsgResumeLicense],
  // abstractaccount
  [
    "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
    abstractaccount.MsgCreateAbstractAccount,
  ],
  [
    "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
    abstractaccount.MsgUpdateSpendingRules,
  ],
  // crossvm
  ["/qorechain.crossvm.v1.MsgCrossVMCall", crossvm.MsgCrossVMCall],
  ["/qorechain.crossvm.v1.MsgProcessQueue", crossvm.MsgProcessQueue],
  // rlconsensus
  ["/qorechain.rlconsensus.v1.MsgSetAgentMode", rlconsensus.MsgSetAgentMode],
  ["/qorechain.rlconsensus.v1.MsgResumeAgent", rlconsensus.MsgResumeAgent],
  ["/qorechain.rlconsensus.v1.MsgUpdatePolicy", rlconsensus.MsgUpdatePolicy],
  [
    "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
    rlconsensus.MsgUpdateRewardWeights,
  ],
].map(([typeUrl, type]) => [typeUrl as string, type as unknown as GeneratedType]);

/**
 * Build a cosmjs {@link Registry} covering the standard Cosmos SDK messages plus
 * every QoreChain custom-module message.
 *
 * @param extraTypes - Optional additional `[typeUrl, GeneratedType]` pairs to
 *   register on top (e.g. messages from a private module). Registered last, so
 *   they override any colliding built-in `typeUrl`.
 */
export function qorechainRegistry(
  extraTypes: ReadonlyArray<[string, GeneratedType]> = [],
): Registry {
  const registry = new Registry(defaultRegistryTypes);
  for (const [typeUrl, type] of qorechainRegistryTypes) {
    registry.register(typeUrl, type);
  }
  for (const [typeUrl, type] of extraTypes) {
    registry.register(typeUrl, type);
  }
  return registry;
}
