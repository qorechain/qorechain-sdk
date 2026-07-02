import { describe, it, expect, vi } from "vitest";
import { TxClient } from "../../src/tx/builder";
import { QoreTxError } from "../../src/errors";
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

  it("throws a typed QoreTxError on a non-zero broadcast result code (commit mode)", async () => {
    const sg = fakeStargate();
    sg.signAndBroadcast.mockResolvedValueOnce({
      code: 5,
      codespace: "sdk",
      transactionHash: "DEAD",
      rawLog: "insufficient funds",
    });
    const client = makeClient(sg);
    const err = await client
      .signAndBroadcast([{ typeUrl: "/x", value: {} }], FEE)
      .catch((e) => e);
    expect(err).toBeInstanceOf(QoreTxError);
    expect(err.code).toBe(5);
    expect(err.kind).toBe("insufficient_funds");
    expect(err.txHash).toBe("DEAD");
  });
});

describe("TxClient auto-gas", () => {
  it("estimateGas applies the default 1.4 multiplier and rounds up", async () => {
    const sg = fakeStargate(); // simulate -> 123456
    const client = makeClient(sg);
    const gas = await client.estimateGas([{ typeUrl: "/x", value: {} }]);
    expect(gas).toBe(Math.ceil(123456 * 1.4)); // 172839
  });

  it('resolves fee "auto" via simulate * multiplier * gasPrice', async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    const msgs = [{ typeUrl: "/x", value: {} }];
    await client.signAndBroadcast(msgs, "auto", "");
    const fee = sg.signAndBroadcast.mock.calls[0][2];
    // gas = ceil(123456 * 1.4) = 172839; fee = ceil(172839 * 0.15) = 25926
    expect(fee).toEqual({
      gas: "172839",
      amount: [{ denom: "uqor", amount: "25926" }],
    });
  });

  it("honors a custom gasMultiplier and gasPrice", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    await client.signAndBroadcast([{ typeUrl: "/x", value: {} }], "auto", "", {
      autoFee: { gasMultiplier: 2, gasPrice: "0.1uqor" },
    });
    const fee = sg.signAndBroadcast.mock.calls[0][2];
    // gas = ceil(123456 * 2) = 246912; fee = ceil(246912 * 0.1) = 24692 (24691.2 -> 24692)
    expect(fee.gas).toBe("246912");
    expect(fee.amount[0].amount).toBe("24692");
  });

  it("bankSend defaults to the auto fee path", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    await client.bankSend(RECIPIENT, [{ denom: "uqor", amount: "1" }]);
    expect(sg.simulate).toHaveBeenCalledOnce();
    const fee = sg.signAndBroadcast.mock.calls[0][2];
    expect(fee.amount[0].denom).toBe("uqor");
  });

  it("does not simulate when an explicit fee is supplied", async () => {
    const sg = fakeStargate();
    const client = makeClient(sg);
    await client.signAndBroadcast([{ typeUrl: "/x", value: {} }], FEE, "");
    expect(sg.simulate).not.toHaveBeenCalled();
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
