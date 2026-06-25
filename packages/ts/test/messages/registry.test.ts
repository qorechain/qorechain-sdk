import { describe, it, expect } from "vitest";
import { qorechainRegistry } from "../../src/messages/registry";
import { msg } from "../../src/messages";

const SENDER = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

const registry = qorechainRegistry();

/**
 * A representative message per surface: custom modules + standard cosmos. Each
 * entry is an `EncodeObject` from the composers; the registry must encode and
 * decode it back to the same value.
 */
const samples = [
  msg.amm.swapExactIn({
    sender: SENDER,
    poolId: "7",
    tokenIn: { denom: "uatom", amount: "500" },
    denomOut: "uqor",
    minOut: "100",
  }),
  msg.bridge.bridgeDeposit({
    sender: SENDER,
    sourceChain: "ethereum",
    sourceTxHash: "0xabc",
    asset: "USDC",
    amount: "1000000",
  }),
  msg.pqc.registerPqcKey({
    sender: SENDER,
    dilithiumPubkey: new Uint8Array([1, 2, 3, 4]),
    ecdsaPubkey: new Uint8Array([5, 6, 7, 8]),
    keyType: "dilithium5",
  }),
  msg.svm.deployProgram({
    sender: SENDER,
    bytecode: new Uint8Array([9, 9, 9]),
  }),
  msg.rdk.createRollup({
    creator: SENDER,
    rollupId: "rollup-1",
    profile: "default",
    vmType: "evm",
    stakeAmount: "1000",
  }),
  msg.staking.delegate({
    delegatorAddress: SENDER,
    validatorAddress: "qorvaloper1abc",
    amount: { denom: "uqor", amount: "5000" },
  }),
  msg.gov.vote({
    proposalId: "3",
    voter: SENDER,
    option: 1,
    metadata: "",
  }),
];

describe("qorechainRegistry", () => {
  it("resolves a representative set of custom and standard typeUrls", () => {
    const typeUrls = [
      "/qorechain.amm.v1.MsgSwapExactIn",
      "/qorechain.bridge.v1.MsgBridgeDeposit",
      "/qorechain.pqc.v1.MsgRegisterPQCKey",
      "/qorechain.svm.v1.MsgDeployProgram",
      "/cosmos.staking.v1beta1.MsgDelegate",
      "/cosmos.gov.v1.MsgVote",
    ];
    for (const typeUrl of typeUrls) {
      // lookupType returns undefined for unregistered typeUrls.
      expect(registry.lookupType(typeUrl), typeUrl).toBeTruthy();
    }
  });

  it("round-trips encode -> decode for a sample of each surface", () => {
    for (const sample of samples) {
      const bytes = registry.encode(sample);
      expect(bytes.length, sample.typeUrl).toBeGreaterThan(0);
      const decoded = registry.decode({
        typeUrl: sample.typeUrl,
        value: bytes,
      });
      expect(decoded, sample.typeUrl).toMatchObject(
        sample.value as Record<string, unknown>,
      );
    }
  });

  it("registers extra types on top of the defaults", () => {
    const before = qorechainRegistry();
    expect(before.lookupType("/custom.v1.MsgFoo")).toBeFalsy();
    // Reuse a generated type under a fake typeUrl to prove pass-through.
    const fooType = registry.lookupType("/qorechain.amm.v1.MsgSwapExactIn")!;
    const withExtra = qorechainRegistry([["/custom.v1.MsgFoo", fooType]]);
    expect(withExtra.lookupType("/custom.v1.MsgFoo")).toBeTruthy();
  });
});
