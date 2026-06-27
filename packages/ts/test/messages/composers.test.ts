import { describe, it, expect } from "vitest";
import { msg } from "../../src/messages";
import { qorechainRegistry } from "../../src/messages/registry";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const registry = qorechainRegistry();

/**
 * Every custom-module composer call paired with its expected on-chain typeUrl.
 * Each produced value must (a) carry the exact typeUrl and (b) encode via the
 * default registry.
 */
const cases: Array<{ name: string; obj: { typeUrl: string }; typeUrl: string }> =
  [
    // amm
    {
      name: "amm.createPool",
      typeUrl: "/qorechain.amm.v1.MsgCreatePool",
      obj: msg.amm.createPool({ creator: ADDR, poolType: "weighted" }),
    },
    {
      name: "amm.swapExactIn",
      typeUrl: "/qorechain.amm.v1.MsgSwapExactIn",
      obj: msg.amm.swapExactIn({ sender: ADDR, poolId: "1", minOut: "1" }),
    },
    {
      name: "amm.swapExactOut",
      typeUrl: "/qorechain.amm.v1.MsgSwapExactOut",
      obj: msg.amm.swapExactOut({ sender: ADDR, poolId: "1", maxIn: "1" }),
    },
    {
      name: "amm.addLiquidity",
      typeUrl: "/qorechain.amm.v1.MsgAddLiquidity",
      obj: msg.amm.addLiquidity({ sender: ADDR, poolId: "1", minLpOut: "1" }),
    },
    {
      name: "amm.removeLiquidity",
      typeUrl: "/qorechain.amm.v1.MsgRemoveLiquidity",
      obj: msg.amm.removeLiquidity({
        sender: ADDR,
        poolId: "1",
        lpAmount: "1",
        minAmountA: "0",
        minAmountB: "0",
      }),
    },
    {
      name: "amm.pausePool",
      typeUrl: "/qorechain.amm.v1.MsgPausePool",
      obj: msg.amm.pausePool({ authority: ADDR, poolId: "1", reason: "x" }),
    },
    {
      name: "amm.resumePool",
      typeUrl: "/qorechain.amm.v1.MsgResumePool",
      obj: msg.amm.resumePool({ authority: ADDR, poolId: "1" }),
    },
    // bridge
    {
      name: "bridge.bridgeDeposit",
      typeUrl: "/qorechain.bridge.v1.MsgBridgeDeposit",
      obj: msg.bridge.bridgeDeposit({ sender: ADDR }),
    },
    {
      name: "bridge.bridgeWithdraw",
      typeUrl: "/qorechain.bridge.v1.MsgBridgeWithdraw",
      obj: msg.bridge.bridgeWithdraw({ sender: ADDR }),
    },
    {
      name: "bridge.registerBridgeValidator",
      typeUrl: "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
      obj: msg.bridge.registerBridgeValidator({ validatorAddress: ADDR }),
    },
    {
      name: "bridge.bridgeAttestation",
      typeUrl: "/qorechain.bridge.v1.MsgBridgeAttestation",
      obj: msg.bridge.bridgeAttestation({ validator: ADDR, amount: "1" }),
    },
    {
      name: "bridge.updateEthLightClient",
      typeUrl: "/qorechain.bridge.v1.MsgUpdateEthLightClient",
      obj: msg.bridge.updateEthLightClient({
        relayer: ADDR,
        update: new Uint8Array([1, 2, 3]),
      }),
    },
    {
      name: "bridge.updateChainConfig",
      typeUrl: "/qorechain.bridge.v1.MsgUpdateChainConfig",
      obj: msg.bridge.updateChainConfig({
        admin: ADDR,
        chainId: "ethereum",
        status: "active",
      }),
    },
    {
      name: "bridge.setVerifierBootstrap",
      typeUrl: "/qorechain.bridge.v1.MsgSetVerifierBootstrap",
      obj: msg.bridge.setVerifierBootstrap({
        admin: ADDR,
        chainId: "ethereum",
        wormhole: { addresses: [new Uint8Array(20).fill(1)], quorum: 1 },
      }),
    },
    // rdk
    {
      name: "rdk.createRollup",
      typeUrl: "/qorechain.rdk.v1.MsgCreateRollup",
      obj: msg.rdk.createRollup({ creator: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.submitBatch",
      typeUrl: "/qorechain.rdk.v1.MsgSubmitBatch",
      obj: msg.rdk.submitBatch({ sequencer: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.challengeBatch",
      typeUrl: "/qorechain.rdk.v1.MsgChallengeBatch",
      obj: msg.rdk.challengeBatch({ challenger: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.resolveChallenge",
      typeUrl: "/qorechain.rdk.v1.MsgResolveChallenge",
      obj: msg.rdk.resolveChallenge({ resolver: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.pauseRollup",
      typeUrl: "/qorechain.rdk.v1.MsgPauseRollup",
      obj: msg.rdk.pauseRollup({ creator: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.resumeRollup",
      typeUrl: "/qorechain.rdk.v1.MsgResumeRollup",
      obj: msg.rdk.resumeRollup({ creator: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.stopRollup",
      typeUrl: "/qorechain.rdk.v1.MsgStopRollup",
      obj: msg.rdk.stopRollup({ creator: ADDR, rollupId: "r1" }),
    },
    {
      name: "rdk.executeWithdrawal",
      typeUrl: "/qorechain.rdk.v1.MsgExecuteWithdrawal",
      obj: msg.rdk.executeWithdrawal({
        submitter: ADDR,
        rollupId: "r1",
        batchIndex: "0",
        withdrawalIndex: "0",
        recipient: ADDR,
        denom: "uqor",
        amount: "100",
        proof: [new Uint8Array([1]), new Uint8Array([2])],
      }),
    },
    // multilayer
    {
      name: "multilayer.registerSidechain",
      typeUrl: "/qorechain.multilayer.v1.MsgRegisterSidechain",
      obj: msg.multilayer.registerSidechain({ creator: ADDR, layerId: "l1" }),
    },
    {
      name: "multilayer.registerPaychain",
      typeUrl: "/qorechain.multilayer.v1.MsgRegisterPaychain",
      obj: msg.multilayer.registerPaychain({ creator: ADDR, layerId: "l1" }),
    },
    {
      name: "multilayer.anchorState",
      typeUrl: "/qorechain.multilayer.v1.MsgAnchorState",
      obj: msg.multilayer.anchorState({ relayer: ADDR, layerId: "l1" }),
    },
    {
      name: "multilayer.routeTransaction",
      typeUrl: "/qorechain.multilayer.v1.MsgRouteTransaction",
      obj: msg.multilayer.routeTransaction({ sender: ADDR }),
    },
    {
      name: "multilayer.updateLayerStatus",
      typeUrl: "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
      obj: msg.multilayer.updateLayerStatus({ authority: ADDR, layerId: "l1" }),
    },
    {
      name: "multilayer.challengeAnchor",
      typeUrl: "/qorechain.multilayer.v1.MsgChallengeAnchor",
      obj: msg.multilayer.challengeAnchor({ challenger: ADDR, layerId: "l1" }),
    },
    // pqc
    {
      name: "pqc.registerPqcKey",
      typeUrl: "/qorechain.pqc.v1.MsgRegisterPQCKey",
      obj: msg.pqc.registerPqcKey({ sender: ADDR }),
    },
    {
      name: "pqc.registerPqcKeyV2",
      typeUrl: "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
      obj: msg.pqc.registerPqcKeyV2({ sender: ADDR, algorithmId: 1 }),
    },
    {
      name: "pqc.migratePqcKey",
      typeUrl: "/qorechain.pqc.v1.MsgMigratePQCKey",
      obj: msg.pqc.migratePqcKey({ sender: ADDR, newAlgorithmId: 2 }),
    },
    {
      name: "pqc.deprecateAlgorithm",
      typeUrl: "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
      obj: msg.pqc.deprecateAlgorithm({ authority: ADDR, algorithmId: 1 }),
    },
    {
      name: "pqc.disableAlgorithm",
      typeUrl: "/qorechain.pqc.v1.MsgDisableAlgorithm",
      obj: msg.pqc.disableAlgorithm({ authority: ADDR, algorithmId: 1 }),
    },
    // svm
    {
      name: "svm.deployProgram",
      typeUrl: "/qorechain.svm.v1.MsgDeployProgram",
      obj: msg.svm.deployProgram({ sender: ADDR }),
    },
    {
      name: "svm.createAccount",
      typeUrl: "/qorechain.svm.v1.MsgCreateAccount",
      obj: msg.svm.createAccount({ sender: ADDR, space: "0", lamports: "0" }),
    },
    {
      name: "svm.executeProgram",
      typeUrl: "/qorechain.svm.v1.MsgExecuteProgram",
      obj: msg.svm.executeProgram({ sender: ADDR }),
    },
    {
      name: "svm.registerSvmPqcKey",
      typeUrl: "/qorechain.svm.v1.MsgRegisterSVMPQCKey",
      obj: msg.svm.registerSvmPqcKey({ sender: ADDR }),
    },
    // lightnode
    {
      name: "lightnode.registerLightNode",
      typeUrl: "/qorechain.lightnode.v1.MsgRegisterLightNode",
      obj: msg.lightnode.registerLightNode({ operator: ADDR }),
    },
    {
      name: "lightnode.heartbeat",
      typeUrl: "/qorechain.lightnode.v1.MsgHeartbeat",
      obj: msg.lightnode.heartbeat({ operator: ADDR }),
    },
    {
      name: "lightnode.deregisterLightNode",
      typeUrl: "/qorechain.lightnode.v1.MsgDeregisterLightNode",
      obj: msg.lightnode.deregisterLightNode({ operator: ADDR }),
    },
    {
      name: "lightnode.claimLightNodeRewards",
      typeUrl: "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
      obj: msg.lightnode.claimLightNodeRewards({ operator: ADDR }),
    },
    // license
    {
      name: "license.grantLicense",
      typeUrl: "/qorechain.license.v1.MsgGrantLicense",
      obj: msg.license.grantLicense({ authority: ADDR, grantee: ADDR }),
    },
    {
      name: "license.revokeLicense",
      typeUrl: "/qorechain.license.v1.MsgRevokeLicense",
      obj: msg.license.revokeLicense({ authority: ADDR, grantee: ADDR }),
    },
    {
      name: "license.suspendLicense",
      typeUrl: "/qorechain.license.v1.MsgSuspendLicense",
      obj: msg.license.suspendLicense({ authority: ADDR, grantee: ADDR }),
    },
    {
      name: "license.resumeLicense",
      typeUrl: "/qorechain.license.v1.MsgResumeLicense",
      obj: msg.license.resumeLicense({ authority: ADDR, grantee: ADDR }),
    },
    // abstractaccount
    {
      name: "abstractaccount.createAbstractAccount",
      typeUrl: "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
      obj: msg.abstractaccount.createAbstractAccount({ owner: ADDR }),
    },
    {
      name: "abstractaccount.updateSpendingRules",
      typeUrl: "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
      obj: msg.abstractaccount.updateSpendingRules({ owner: ADDR, rules: [] }),
    },
    // crossvm
    {
      name: "crossvm.crossVmCall",
      typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall",
      obj: msg.crossvm.crossVmCall({ sender: ADDR }),
    },
    {
      name: "crossvm.processQueue",
      typeUrl: "/qorechain.crossvm.v1.MsgProcessQueue",
      obj: msg.crossvm.processQueue({ authority: ADDR }),
    },
    // rlconsensus
    {
      name: "rlconsensus.setAgentMode",
      typeUrl: "/qorechain.rlconsensus.v1.MsgSetAgentMode",
      obj: msg.rlconsensus.setAgentMode({ authority: ADDR, mode: 1 }),
    },
    {
      name: "rlconsensus.resumeAgent",
      typeUrl: "/qorechain.rlconsensus.v1.MsgResumeAgent",
      obj: msg.rlconsensus.resumeAgent({ authority: ADDR }),
    },
    {
      name: "rlconsensus.updatePolicy",
      typeUrl: "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
      obj: msg.rlconsensus.updatePolicy({ authority: ADDR, weightsJson: "{}" }),
    },
    {
      name: "rlconsensus.updateRewardWeights",
      typeUrl: "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
      obj: msg.rlconsensus.updateRewardWeights({ authority: ADDR }),
    },
  ];

describe("qorechain custom-module composers", () => {
  it("covers all 53 custom Msg types", () => {
    expect(cases).toHaveLength(53);
  });

  for (const c of cases) {
    it(`${c.name} -> ${c.typeUrl} (correct typeUrl, encodable)`, () => {
      expect(c.obj.typeUrl).toBe(c.typeUrl);
      const bytes = registry.encode(c.obj as never);
      // Empty-body messages encode to zero bytes; that is still valid.
      expect(bytes).toBeInstanceOf(Uint8Array);
    });
  }
});

/**
 * The newly-wired messages (re-synced protos): each must round-trip
 * composer -> Any encode -> registry decode back to the same value, proving the
 * registry entry and the generated codec agree.
 */
describe("new composers round-trip through the registry (Any encode/decode)", () => {
  const roundTrip = [
    msg.rdk.executeWithdrawal({
      submitter: ADDR,
      rollupId: "r1",
      batchIndex: "5",
      withdrawalIndex: "2",
      recipient: ADDR,
      denom: "uqor",
      amount: "777",
      proof: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
    }),
    msg.bridge.updateEthLightClient({
      relayer: ADDR,
      update: new Uint8Array([9, 8, 7, 6]),
    }),
    msg.bridge.updateChainConfig({
      admin: ADDR,
      chainId: "ethereum",
      bridgeContract: "0xabc",
      confirmationsRequired: 12,
      architecture: "evm",
      status: "active",
      verifier: "light_client",
      lockEventSig: "0xtopic0",
    }),
    msg.bridge.setVerifierBootstrap({
      admin: ADDR,
      chainId: "solana",
      ed25519: { pubkeys: [new Uint8Array(32).fill(2)], threshold: 1 },
    }),
  ];

  for (const sample of roundTrip) {
    it(`${sample.typeUrl} round-trips`, () => {
      const bytes = registry.encode(sample);
      const decoded = registry.decode({
        typeUrl: sample.typeUrl,
        value: bytes,
      });
      expect(decoded, sample.typeUrl).toMatchObject(
        sample.value as Record<string, unknown>,
      );
    });
  }
});
