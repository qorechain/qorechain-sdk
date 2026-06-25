import { describe, it, expect, vi } from "vitest";
import { TxClient } from "../../src/tx/builder";
import { msg } from "../../src/messages";
import { qorechainRegistry } from "../../src/messages/registry";

const SENDER = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const FEE = { amount: [{ denom: "uqor", amount: "5000" }], gas: "200000" };

/** A fake SigningStargateClient capturing the messages it is asked to sign. */
function fakeStargate() {
  return {
    simulate: vi.fn(async () => 100000),
    signAndBroadcast: vi.fn(async () => ({
      code: 0,
      transactionHash: "HASH",
      height: 1,
    })),
    signAndBroadcastSync: vi.fn(async () => "HASH"),
    disconnect: vi.fn(),
  };
}

describe("TxClient with a custom QoreChain message", () => {
  it("carries an amm SwapExactIn message through signAndBroadcast", async () => {
    const sg = fakeStargate();
    const client = new TxClient({
      signingClient: sg as never,
      senderAddress: SENDER,
    });

    const swap = msg.amm.swapExactIn({
      sender: SENDER,
      poolId: "9",
      tokenIn: { denom: "uatom", amount: "250" },
      denomOut: "uqor",
      minOut: "200",
    });

    await client.signAndBroadcast([swap], FEE, "swap");

    const [addr, msgs, fee, memo] = sg.signAndBroadcast.mock.calls[0];
    expect(addr).toBe(SENDER);
    expect(fee).toEqual(FEE);
    expect(memo).toBe("swap");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].typeUrl).toBe("/qorechain.amm.v1.MsgSwapExactIn");

    // The default registry (which TxClient.connect uses) encodes this message
    // and decodes it back to the same value — i.e. the body would be carried
    // correctly on the wire.
    const registry = qorechainRegistry();
    const encoded = registry.encode(msgs[0]);
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = registry.decode({
      typeUrl: msgs[0].typeUrl,
      value: encoded,
    });
    expect(decoded).toMatchObject({
      sender: SENDER,
      poolId: "9",
      denomOut: "uqor",
      minOut: "200",
      tokenIn: { denom: "uatom", amount: "250" },
    });
  });
});
