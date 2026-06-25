import { describe, it, expect } from "vitest";
import { msg } from "../../src/messages";
import { qorechainRegistry } from "../../src/messages/registry";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const VAL = "qorvaloper1abcdefghijklmnopqrstuvwxyz0123456789ab";
const registry = qorechainRegistry();

describe("standard cosmos message builders", () => {
  it("staking.delegate has the correct typeUrl and shape", () => {
    const m = msg.staking.delegate({
      delegatorAddress: ADDR,
      validatorAddress: VAL,
      amount: { denom: "uqor", amount: "1000" },
    });
    expect(m.typeUrl).toBe("/cosmos.staking.v1beta1.MsgDelegate");
    expect(m.value).toMatchObject({
      delegatorAddress: ADDR,
      validatorAddress: VAL,
      amount: { denom: "uqor", amount: "1000" },
    });
    expect(registry.encode(m).length).toBeGreaterThan(0);
  });

  it("gov.vote has the correct typeUrl and round-trips", () => {
    const m = msg.gov.vote({ proposalId: "5", voter: ADDR, option: 1 });
    expect(m.typeUrl).toBe("/cosmos.gov.v1.MsgVote");
    const decoded = registry.decode({
      typeUrl: m.typeUrl,
      value: registry.encode(m),
    });
    // cosmjs-types decodes uint64 fields as bigint (unlike the forceLong=string
    // QoreChain codegen), so proposalId comes back as 5n.
    expect(decoded).toMatchObject({ proposalId: 5n, voter: ADDR, option: 1 });
  });

  it("ibc.transfer has the correct typeUrl and shape", () => {
    const m = msg.ibc.transfer({
      sourcePort: "transfer",
      sourceChannel: "channel-0",
      token: { denom: "uqor", amount: "100" },
      sender: ADDR,
      receiver: "cosmos1receiver",
      timeoutTimestamp: "0",
    });
    expect(m.typeUrl).toBe("/ibc.applications.transfer.v1.MsgTransfer");
    expect(m.value).toMatchObject({
      sourceChannel: "channel-0",
      sender: ADDR,
      receiver: "cosmos1receiver",
    });
    expect(registry.encode(m).length).toBeGreaterThan(0);
  });

  it("exposes the documented standard typeUrls", () => {
    expect(
      msg.bank.send({ fromAddress: ADDR, toAddress: ADDR, amount: [] })
        .typeUrl,
    ).toBe("/cosmos.bank.v1beta1.MsgSend");
    expect(
      msg.distribution.withdrawDelegatorReward({
        delegatorAddress: ADDR,
        validatorAddress: VAL,
      }).typeUrl,
    ).toBe("/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward");
    expect(msg.authz.exec({ grantee: ADDR, msgs: [] }).typeUrl).toBe(
      "/cosmos.authz.v1beta1.MsgExec",
    );
    expect(
      msg.feegrant.revoke({ granter: ADDR, grantee: ADDR }).typeUrl,
    ).toBe("/cosmos.feegrant.v1beta1.MsgRevokeAllowance");
  });
});
