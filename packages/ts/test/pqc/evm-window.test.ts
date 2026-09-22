import { describe, it, expect, vi } from "vitest";

import {
  MAX_EVM_WINDOW_BLOCKS,
  MAX_EVM_WINDOW_TXS,
  openEvmWindowMsg,
  closeEvmWindowMsg,
  fetchEvmWindow,
  classifyEvmWindowRejection,
  isEvmWindowRejection,
} from "../../src/pqc/evm-window";
import { qorechainRegistry } from "../../src/messages/registry";
import { MsgOpenEVMWindow, MsgCloseEVMWindow } from "../../src/codegen/qorechain/pqc/v1/tx";

const SENDER = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";

describe("openEvmWindowMsg", () => {
  it("round-trips through the registry under the chain's type URL", () => {
    const m = openEvmWindowMsg({ sender: SENDER, blocks: 300, maxTxs: 5, maxValue: "2000000" });
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    const any = qorechainRegistry().encodeAsAny(m);
    expect(any.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    const back = MsgOpenEVMWindow.decode(any.value);
    expect(back).toMatchObject({
      sender: SENDER,
      blocks: "300",
      maxTxs: "5",
      maxValue: "2000000",
    });
  });

  it("accepts the chain's maximum bounds", () => {
    const m = openEvmWindowMsg({
      sender: SENDER,
      blocks: MAX_EVM_WINDOW_BLOCKS,
      maxTxs: MAX_EVM_WINDOW_TXS,
      maxValue: 1,
    });
    expect((m.value as { blocks: string }).blocks).toBe("17280");
    expect((m.value as { maxTxs: string }).maxTxs).toBe("1000");
  });

  it("keeps a maxValue above 2^53 exact", () => {
    const huge = "9007199254740993000";
    const m = openEvmWindowMsg({ sender: SENDER, blocks: 1, maxTxs: 1, maxValue: huge });
    expect((m.value as { maxValue: string }).maxValue).toBe(huge);
  });

  // The chain refuses each of these in ValidateBasic; failing here saves a
  // broadcast, and every field is required rather than defaulted.
  it.each([
    ["blocks 0", { blocks: 0, maxTxs: 5, maxValue: 1 }, /blocks must be greater than 0/],
    ["blocks over the max", { blocks: 17281, maxTxs: 5, maxValue: 1 }, /blocks must be at most 17280/],
    ["maxTxs 0", { blocks: 10, maxTxs: 0, maxValue: 1 }, /maxTxs must be greater than 0/],
    ["maxTxs over the max", { blocks: 10, maxTxs: 1001, maxValue: 1 }, /maxTxs must be at most 1000/],
    ["maxValue 0", { blocks: 10, maxTxs: 5, maxValue: 0 }, /maxValue must be greater than 0/],
    ["maxValue negative", { blocks: 10, maxTxs: 5, maxValue: -1 }, /maxValue must be greater than 0/],
  ])("refuses %s", (_name, partial, re) => {
    expect(() => openEvmWindowMsg({ sender: SENDER, ...(partial as never) })).toThrow(re);
  });

  it("refuses a missing sender and a non-integer bound", () => {
    expect(() => openEvmWindowMsg({ sender: "", blocks: 1, maxTxs: 1, maxValue: 1 })).toThrow(
      /sender is required/,
    );
    expect(() =>
      openEvmWindowMsg({ sender: SENDER, blocks: 1, maxTxs: 1, maxValue: "1.5" }),
    ).toThrow(/maxValue must be an integer/);
  });
});

describe("closeEvmWindowMsg", () => {
  it("round-trips through the registry", () => {
    const m = closeEvmWindowMsg(SENDER);
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgCloseEVMWindow");
    const any = qorechainRegistry().encodeAsAny(m);
    expect(MsgCloseEVMWindow.decode(any.value).sender).toBe(SENDER);
  });

  it("refuses a missing sender", () => {
    expect(() => closeEvmWindowMsg("")).toThrow(/sender is required/);
  });
});

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchEvmWindow", () => {
  const REST = "https://lcd.example";

  it("reads the live shape, keeping every number exact", async () => {
    const f = jsonFetch({
      found: true,
      live: true,
      opened_height: "6069608",
      expiry_height: "6069908",
      max_txs: "5",
      used_txs: "1",
      max_value: "2000000",
      used_value: "3363",
      remaining_blocks: "286",
      remaining_txs: "4",
      remaining_value: "1996637",
    });
    const w = await fetchEvmWindow({ rest: REST, address: SENDER, fetch: f });
    expect(w).toEqual({
      found: true,
      live: true,
      openedHeight: 6069608n,
      expiryHeight: 6069908n,
      maxTxs: 5n,
      usedTxs: 1n,
      maxValue: 2000000n,
      usedValue: 3363n,
      remainingBlocks: 286n,
      remainingTxs: 4n,
      remainingValue: 1996637n,
    });
    expect(f).toHaveBeenCalledWith(`${REST}/qorechain/pqc/v1/evm_window/${SENDER}`);
  });

  it("reads the no-window answer, which is a 200 and not an error", async () => {
    const w = await fetchEvmWindow({
      rest: `${REST}/`,
      address: SENDER,
      fetch: jsonFetch({
        found: false,
        live: false,
        opened_height: "0",
        expiry_height: "0",
        max_txs: "0",
        used_txs: "0",
        max_value: "",
        used_value: "",
        remaining_blocks: "0",
        remaining_txs: "0",
        remaining_value: "",
      }),
    });
    expect(w.found).toBe(false);
    expect(w.live).toBe(false);
    expect(w.maxValue).toBe(0n); // the chain sends "" for an unset Int
  });

  it("keeps a value beyond 2^53 exact rather than truncating through a float", async () => {
    const w = await fetchEvmWindow({
      rest: REST,
      address: SENDER,
      fetch: jsonFetch({ found: true, live: true, remaining_value: "9007199254740993" }),
    });
    expect(w.remainingValue).toBe(9007199254740993n);
    // Going through a float loses the last digit, which is why this stays BigInt.
    expect(BigInt(Number(w.remainingValue))).not.toBe(w.remainingValue);
  });

  it("throws on a transport failure", async () => {
    await expect(
      fetchEvmWindow({ rest: REST, address: SENDER, fetch: jsonFetch({}, 502) }),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe("classifyEvmWindowRejection", () => {
  it("classifies the codespace/code form", () => {
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 26 })).toBe("no-window");
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 27 })).toBe("exhausted");
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 28 })).toBe("invalid");
  });

  // Over EVM JSON-RPC the codespace does not survive; the chain's text does.
  it("classifies the chain's text as it arrives over JSON-RPC", () => {
    expect(
      classifyEvmWindowRejection(
        new Error(
          "failed to broadcast transaction: account qor1… has no open EVM authorisation window; open one with MsgOpenEVMWindow, signed on the Cosmos lane with the account's post-quantum key",
        ),
      ),
    ).toBe("no-window");
    expect(
      classifyEvmWindowRejection({ details: "EVM authorisation window exhausted" }),
    ).toBe("exhausted");
    // The handler's own wording, which carries the numbers a UI wants to show.
    expect(
      classifyEvmWindowRejection({
        rawLog:
          "the EVM authorisation window for qor1abc does not admit this transaction (remaining: 296 blocks, 4 transactions, 1996637 uqor; this transaction needs 2000000 uqor): EVM authorisation window exhausted",
      }),
    ).toBe("exhausted");
    expect(
      classifyEvmWindowRejection({ shortMessage: "invalid EVM authorisation window" }),
    ).toBe("invalid");
  });

  // A different state with a different remedy: register a key first. The chain
  // raises BOTH under ErrNoEVMWindow — code 26, verified in the ante handler —
  // so the code cannot separate them and the text must win.
  it("separates a missing PQC key from a missing window, under the chain's real code 26", () => {
    const noKey =
      "account qor1… has no registered post-quantum key; the EVM lane requires one, like every other lane";
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 26, rawLog: noKey })).toBe(
      "no-pqc-key",
    );
    // And over JSON-RPC, where only the text survives.
    expect(classifyEvmWindowRejection(new Error(noKey))).toBe("no-pqc-key");
    // Code 28 with the same text is classified the same way.
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 28, log: noKey })).toBe(
      "no-pqc-key",
    );
  });

  // The SAME condition carries a different code on each lane: 26 from the EVM
  // ante, 28 from the MsgOpenEVMWindow handler, with different wording too.
  // Both are pinned verbatim from the chain source.
  it("recognises the missing-key text of BOTH lanes", () => {
    const evmLane =
      "account qor1abc has no registered post-quantum key; the EVM lane requires one, like every other lane";
    const cosmosLane =
      "account qor1abc has no registered post-quantum key; register one before using the EVM lane";
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 26, rawLog: evmLane })).toBe(
      "no-pqc-key",
    );
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 28, rawLog: cosmosLane })).toBe(
      "no-pqc-key",
    );
    // Text alone, as it arrives over JSON-RPC with no codespace.
    expect(classifyEvmWindowRejection(new Error(cosmosLane))).toBe("no-pqc-key");
  });

  it("does not match anything else", () => {
    expect(classifyEvmWindowRejection({ codespace: "sdk", code: 26 })).toBeUndefined();
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 21 })).toBeUndefined();
    expect(classifyEvmWindowRejection(new Error("insufficient funds"))).toBeUndefined();
    expect(classifyEvmWindowRejection(undefined)).toBeUndefined();
    expect(isEvmWindowRejection(new Error("nonce too low"))).toBe(false);
  });
});
