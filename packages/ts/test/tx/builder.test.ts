import { describe, it, expect, vi } from "vitest";
import { TxClient } from "../../src/tx/builder";
import type { Coin } from "../../src/query/rest";

const SENDER = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const RECIPIENT = "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq";

const FEE = { amount: [{ denom: "uqor", amount: "5000" }], gas: "200000" };

/** A fake SigningStargateClient capturing calls. */
function fakeStargate() {
  return {
    simulate: vi.fn(async () => 123456),
    signAndBroadcast: vi.fn(async () => ({
      code: 0,
      transactionHash: "ABC",
      height: 10,
    })),
    signAndBroadcastSync: vi.fn(async () => "ABCSYNC"),
    disconnect: vi.fn(),
  };
}

function makeClient(stargate: ReturnType<typeof fakeStargate>) {
  return new TxClient({
    signingClient: stargate as never,
    senderAddress: SENDER,
  });
}

describe("TxClient.simulate", () => {
  it("passes sender, messages and memo through to the signing client", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    const msgs = [{ typeUrl: "/x", value: { foo: 1 } }];
    const gas = await client.simulate(msgs, { memo: "hi" });
    expect(gas).toBe(123456);
    expect(sg.simulate).toHaveBeenCalledWith(SENDER, msgs, "hi");
  });
});

describe("TxClient.signAndBroadcast", () => {
  it("uses commit mode by default (signAndBroadcast)", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    const msgs = [{ typeUrl: "/x", value: {} }];
    const res = await client.signAndBroadcast(msgs, FEE, "memo");
    expect(sg.signAndBroadcast).toHaveBeenCalledWith(SENDER, msgs, FEE, "memo");
    expect(res.transactionHash).toBe("ABC");
  });

  it("maps sync mode to signAndBroadcastSync and returns the hash", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    const msgs = [{ typeUrl: "/x", value: {} }];
    const res = await client.signAndBroadcast(msgs, FEE, "", { mode: "sync" });
    expect(sg.signAndBroadcastSync).toHaveBeenCalledWith(SENDER, msgs, FEE, "");
    expect(sg.signAndBroadcast).not.toHaveBeenCalled();
    expect(res.transactionHash).toBe("ABCSYNC");
  });

  it("maps async mode to signAndBroadcastSync (fire-and-forget hash)", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    await client.signAndBroadcast([{ typeUrl: "/x", value: {} }], FEE, "", {
      mode: "async",
    });
    expect(sg.signAndBroadcastSync).toHaveBeenCalledOnce();
  });

  it("throws on a non-zero broadcast result code (commit mode)", async () => {
    const sg = fakeStargate();
    sg.signAndBroadcast.mockResolvedValueOnce({
      code: 5,
      transactionHash: "DEAD",
      rawLog: "insufficient funds",
    });
    const client = makeClient(sg);
    await expect(
      client.signAndBroadcast([{ typeUrl: "/x", value: {} }], FEE),
    ).rejects.toThrow(/insufficient funds|code 5/);
  });
});

describe("TxClient.bankSend", () => {
  it("constructs a MsgSend with the correct fields and broadcasts", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    const amount: Coin[] = [{ denom: "uqor", amount: "1000" }];
    await client.bankSend(RECIPIENT, amount, { fee: FEE, memo: "pay" });

    const [addr, msgs, fee, memo] = sg.signAndBroadcast.mock.calls[0];
    expect(addr).toBe(SENDER);
    expect(memo).toBe("pay");
    expect(fee).toEqual(FEE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].typeUrl).toBe("/cosmos.bank.v1beta1.MsgSend");
    expect(msgs[0].value).toMatchObject({
      fromAddress: SENDER,
      toAddress: RECIPIENT,
      amount,
    });
  });
});
