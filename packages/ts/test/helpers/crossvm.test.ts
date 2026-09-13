import { describe, it, expect, vi } from "vitest";

import { createCrossVMClient, VM_TYPES } from "../../src/helpers";
import type { TxClient } from "../../src/tx/builder";
import type { CrossVmQueryClient } from "../../src/query/grpc";
import type { QorClient } from "../../src/query/qor";
import {
  MsgCrossVMCall,
  MsgCrossVMCallResponse,
} from "../../src/codegen/qorechain/crossvm/v1/tx";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

/** A fake TxClient capturing the messages handed to signAndBroadcast. */
function fakeTx(events?: unknown, msgResponses?: unknown) {
  const signAndBroadcast = vi.fn(async () => ({
    transactionHash: "DEADBEEF",
    code: 0,
    ...(events ? { events } : {}),
    ...(msgResponses ? { msgResponses } : {}),
  }));
  const tx = {
    senderAddress: ADDR,
    signAndBroadcast,
  } as unknown as TxClient;
  return { tx, signAndBroadcast };
}

/** A minimal ERC-20-style ABI for the EVM encoding path. */
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function decodeMsg(value: unknown): MsgCrossVMCall {
  // The composer stores a structurally-complete MsgCrossVMCall value object.
  return value as MsgCrossVMCall;
}

describe("VM_TYPES", () => {
  it("lists the three supported VMs", () => {
    expect(VM_TYPES).toEqual(["evm", "cosmwasm", "svm"]);
  });
});

describe("createCrossVMClient.buildCall", () => {
  it("builds MsgCrossVMCall with sender + default sourceVm 'evm' (raw payload)", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      targetVm: "svm",
      targetContract: "SoMeProgram1111111111111111111111111111111",
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(m.typeUrl).toBe("/qorechain.crossvm.v1.MsgCrossVMCall");
    const v = decodeMsg(m.value);
    expect(v.sender).toBe(ADDR);
    expect(v.sourceVm).toBe("evm");
    expect(v.targetVm).toBe("svm");
    expect(v.targetContract).toBe("SoMeProgram1111111111111111111111111111111");
    expect(v.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(v.funds).toEqual([]);
  });

  it("decodes a 0x-hex raw payload to bytes and carries funds + sourceVm", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      sourceVm: "cosmwasm",
      targetVm: "evm",
      targetContract: "0xabc",
      payload: "0xdeadbeef",
      funds: [{ denom: "uqor", amount: "100" }],
    });
    const v = decodeMsg(m.value);
    expect(v.sourceVm).toBe("cosmwasm");
    expect(v.payload).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(v.funds).toEqual([{ denom: "uqor", amount: "100" }]);
  });

  it("UTF-8 JSON-encodes a cosmwasm payload", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      targetVm: "cosmwasm",
      targetContract: "qor1contract",
      cosmwasm: { transfer: { recipient: "qor1x", amount: "5" } },
    });
    const v = decodeMsg(m.value);
    const expected = new TextEncoder().encode(
      JSON.stringify({ transfer: { recipient: "qor1x", amount: "5" } }),
    );
    expect(v.payload).toEqual(expected);
    expect(new TextDecoder().decode(v.payload)).toBe(
      '{"transfer":{"recipient":"qor1x","amount":"5"}}',
    );
  });

  it("passes through an svm instruction blob unchanged", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const blob = new Uint8Array([9, 8, 7, 6]);
    const m = xvm.buildCall({
      targetVm: "svm",
      targetContract: "Prog11111111111111111111111111111111111111",
      svm: { data: blob },
    });
    expect(decodeMsg(m.value).payload).toEqual(blob);
  });

  it("throws for EVM payloads (async ABI encode) on the sync build path", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    expect(() =>
      xvm.buildCall({
        targetVm: "evm",
        targetContract: "0xabc",
        evm: {
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: ["0x1111111111111111111111111111111111111111", 1n],
        },
      }),
    ).toThrow(/EVM payloads/);
  });
});

describe("createCrossVMClient.call", () => {
  it("ABI-encodes an EVM call (selector + args) and broadcasts one message", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      sourceVm: "cosmwasm",
      targetVm: "evm",
      targetContract: "0xToken",
      evm: {
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: ["0x1111111111111111111111111111111111111111", 1n],
      },
    });
    expect(res.result.transactionHash).toBe("DEADBEEF");
    expect(signAndBroadcast).toHaveBeenCalledOnce();
    const [messages, fee] = signAndBroadcast.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(fee).toBe("auto");
    const v = decodeMsg(messages[0].value);
    expect(v.targetVm).toBe("evm");
    // transfer(address,uint256) selector is 0xa9059cbb; payload begins with it.
    const hex =
      "0x" +
      Array.from(v.payload)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    expect(hex.startsWith("0xa9059cbb")).toBe(true);
    // 4-byte selector + two 32-byte words.
    expect(v.payload.length).toBe(4 + 32 + 32);
  });

  it("parses a messageId from broadcast events", async () => {
    const events = [
      {
        type: "crossvm_call",
        attributes: [{ key: "message_id", value: "msg-42" }],
      },
    ];
    const { tx } = fakeTx(events);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
    });
    expect(res.messageId).toBe("msg-42");
  });
});

describe("createCrossVMClient.callAtomic", () => {
  it("packs N MsgCrossVMCall into ONE transaction body across VMs", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const xvm = createCrossVMClient(tx);
    await xvm.callAtomic([
      {
        targetVm: "evm",
        targetContract: "0xToken",
        evm: {
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: ["0x1111111111111111111111111111111111111111", 2n],
        },
      },
      {
        targetVm: "svm",
        targetContract: "Prog",
        svm: { data: new Uint8Array([1, 2]) },
      },
      {
        targetVm: "cosmwasm",
        targetContract: "qor1c",
        cosmwasm: { ping: {} },
      },
    ]);
    expect(signAndBroadcast).toHaveBeenCalledOnce();
    const [messages] = signAndBroadcast.mock.calls[0];
    expect(messages).toHaveLength(3);
    expect(messages.every((m: { typeUrl: string }) =>
      m.typeUrl === "/qorechain.crossvm.v1.MsgCrossVMCall",
    )).toBe(true);
    const vms = messages.map((m: { value: unknown }) => decodeMsg(m.value).targetVm);
    expect(vms).toEqual(["evm", "svm", "cosmwasm"]);
    // Each carried its own encoded payload.
    expect(decodeMsg(messages[1].value).payload).toEqual(new Uint8Array([1, 2]));
    expect(new TextDecoder().decode(decodeMsg(messages[2].value).payload)).toBe(
      '{"ping":{}}',
    );
  });

  it("collects all messageIds from events", async () => {
    const events = [
      { type: "a", attributes: [{ key: "message_id", value: "m1" }] },
      { type: "b", attributes: [{ key: "messageId", value: "m2" }] },
    ];
    const { tx } = fakeTx(events);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.callAtomic([
      { targetVm: "svm", targetContract: "P", payload: "0x01" },
      { targetVm: "svm", targetContract: "Q", payload: "0x02" },
    ]);
    expect(res.messageIds).toEqual(["m1", "m2"]);
  });

  it("rejects an empty batch", async () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    await expect(xvm.callAtomic([])).rejects.toThrow(/at least one/);
  });
});

describe("createCrossVMClient.getMessage", () => {
  it("prefers the typed query client", async () => {
    const { tx } = fakeTx();
    const query = {
      message: vi.fn(async () => ({ message: { id: "x" }, found: true })),
    } as unknown as CrossVmQueryClient;
    const xvm = createCrossVMClient(tx, { query });
    const res = await xvm.getMessage("x");
    expect(query.message).toHaveBeenCalledWith({ id: "x" });
    expect(res).toEqual({ message: { id: "x" }, found: true });
  });

  it("falls back to qor_getCrossVMMessage when no query client", async () => {
    const { tx } = fakeTx();
    const qor = {
      getCrossVmMessage: vi.fn(async () => ({ id: "y" })),
    } as unknown as QorClient;
    const xvm = createCrossVMClient(tx, { qor });
    const res = await xvm.getMessage("y");
    expect(qor.getCrossVmMessage).toHaveBeenCalledWith("y");
    expect(res).toEqual({ id: "y" });
  });

  it("throws a clear error when neither read source is configured", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    expect(() => xvm.getMessage("z")).toThrow(/query client or a qor client/);
  });
});

// ---- chain v3.1.97: async flag + decoded MsgCrossVMCallResponse -----------

/** Encode a MsgCrossVMCallResponse the way the node returns it in msgResponses. */
function callResponse(fields: {
  messageId?: string;
  executed?: boolean;
  data?: Uint8Array;
  gasUsed?: string;
}) {
  return {
    typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCallResponse",
    value: MsgCrossVMCallResponse.encode(
      MsgCrossVMCallResponse.fromPartial({
        messageId: fields.messageId ?? "",
        executed: fields.executed ?? false,
        data: fields.data ?? new Uint8Array(0),
        gasUsed: fields.gasUsed ?? "0",
      }),
    ).finish(),
  };
}

describe("crossvm async flag", () => {
  it("defaults async to false (execute now and return the answer)", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
    });
    expect(decodeMsg(m.value).async).toBe(false);
  });

  it("round-trips async: true into the message", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
      async: true,
    });
    expect(decodeMsg(m.value).async).toBe(true);
  });

  it("survives a registry encode -> decode round-trip", () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const m = xvm.buildCall({
      targetVm: "cosmwasm",
      targetContract: "qor1c",
      cosmwasm: { ping: {} },
      async: true,
    });
    const bytes = MsgCrossVMCall.encode(decodeMsg(m.value)).finish();
    expect(MsgCrossVMCall.decode(bytes).async).toBe(true);
  });

  it("carries async through call() and callAtomic() per message", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const xvm = createCrossVMClient(tx);
    await xvm.call({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
      async: true,
    });
    expect(decodeMsg(signAndBroadcast.mock.calls[0][0][0].value).async).toBe(
      true,
    );

    const { tx: tx2, signAndBroadcast: sab2 } = fakeTx();
    const xvm2 = createCrossVMClient(tx2);
    await xvm2.callAtomic([
      { targetVm: "svm", targetContract: "P", payload: "0x01", async: true },
      { targetVm: "svm", targetContract: "Q", payload: "0x02" },
    ]);
    const msgs = sab2.mock.calls[0][0];
    expect(msgs.map((m: { value: unknown }) => decodeMsg(m.value).async)).toEqual(
      [true, false],
    );
  });
});

describe("crossvm response decoding", () => {
  it("surfaces executed / data / gasUsed from MsgCrossVMCallResponse", async () => {
    const data = new Uint8Array([0xca, 0xfe]);
    const { tx } = fakeTx(undefined, [
      callResponse({
        messageId: "m1",
        executed: true,
        data,
        gasUsed: "21000",
      }),
    ]);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      targetVm: "evm",
      targetContract: "0xabc",
      payload: "0x01",
    });
    expect(res.executed).toBe(true);
    expect(res.data).toEqual(data);
    expect(res.gasUsed).toBe(21000n);
  });

  it("reports a queued (async) call as not executed with no data", async () => {
    const { tx } = fakeTx(undefined, [
      callResponse({ messageId: "m1", executed: false }),
    ]);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
      async: true,
    });
    expect(res.executed).toBe(false);
    expect(res.data).toEqual(new Uint8Array(0));
    expect(res.gasUsed).toBe(0n);
  });

  it("falls back to an unknown outcome when the node returned no responses", async () => {
    const { tx } = fakeTx();
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
    });
    expect(res.executed).toBe(false);
    expect(res.data).toEqual(new Uint8Array(0));
    expect(res.gasUsed).toBe(0n);
    // The raw broadcast result is still returned untouched.
    expect(res.result.transactionHash).toBe("DEADBEEF");
  });

  it("decodes one outcome per call in callAtomic, in order", async () => {
    const { tx } = fakeTx(undefined, [
      callResponse({ executed: true, data: new Uint8Array([1]), gasUsed: "10" }),
      callResponse({ executed: true, data: new Uint8Array([2]), gasUsed: "20" }),
    ]);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.callAtomic([
      { targetVm: "svm", targetContract: "P", payload: "0x01" },
      { targetVm: "svm", targetContract: "Q", payload: "0x02" },
    ]);
    expect(res.outcomes).toHaveLength(2);
    expect(res.outcomes.map((o) => o.data)).toEqual([
      new Uint8Array([1]),
      new Uint8Array([2]),
    ]);
    expect(res.outcomes.map((o) => o.gasUsed)).toEqual([10n, 20n]);
  });

  it("ignores non-crossvm responses in a mixed transaction body", async () => {
    const { tx } = fakeTx(undefined, [
      { typeUrl: "/cosmos.bank.v1beta1.MsgSendResponse", value: new Uint8Array() },
      callResponse({ executed: true, data: new Uint8Array([7]), gasUsed: "5" }),
    ]);
    const xvm = createCrossVMClient(tx);
    const res = await xvm.call({
      targetVm: "svm",
      targetContract: "P",
      payload: "0x01",
    });
    expect(res.executed).toBe(true);
    expect(res.data).toEqual(new Uint8Array([7]));
    expect(res.gasUsed).toBe(5n);
  });
});
