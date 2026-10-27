import { describe, it, expect, vi } from "vitest";
import {
  evmWindowStatus,
  openEvmWindowMessage,
  classifyEvmWindowRejection,
  isEvmWindowRejection,
  evmWindowCost,
  weiToUqorCeil,
  toQorAddress,
  toEvmAddress,
  OPEN_EVM_WINDOW_TYPE_URL,
  MAX_EVM_WINDOW_BLOCKS,
  MAX_EVM_WINDOW_TXS,
  MAX_EVM_WINDOW_TARGETS,
} from "../src/index";
import * as windowSubpath from "../src/window";

// An eth-native account seen on the testnet: the same 20 bytes in both forms.
const QOR = "qor1x47hsvyhv90s4nnv3pjkd6u9x9wfptxruvjzl2";
const HEX = "0x357D783097615F0AcE6c886566eB85315c90ACc3";
const REST = "https://api-testnet.qore.host";

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async (url: string) => ({
    url,
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe("openEvmWindowMessage", () => {
  it("composes MsgOpenEVMWindow with decimal-string integers", () => {
    const m = openEvmWindowMessage({ sender: QOR, blocks: 300, maxTxs: 5n, maxValue: "2000000" });
    expect(m.typeUrl).toBe(OPEN_EVM_WINDOW_TYPE_URL);
    expect(m.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    expect(m.value).toEqual({
      sender: QOR,
      blocks: "300",
      maxTxs: "5",
      maxValue: "2000000",
      nativeOnly: false,
      allowedTargets: [],
    });
  });

  it("carries the v3.2.3 narrowing fields", () => {
    const m = openEvmWindowMessage({
      sender: QOR,
      blocks: 10,
      maxTxs: 1,
      maxValue: 1,
      nativeOnly: true,
      allowedTargets: [HEX],
    });
    expect(m.value.nativeOnly).toBe(true);
    expect(m.value.allowedTargets).toEqual([HEX]);
  });

  it.each([
    [{ blocks: 0, maxTxs: 1, maxValue: 1 }, /blocks must be greater than 0/],
    [{ blocks: MAX_EVM_WINDOW_BLOCKS + 1n, maxTxs: 1, maxValue: 1 }, /blocks must be at most 17280/],
    [{ blocks: 1, maxTxs: 0, maxValue: 1 }, /maxTxs must be greater than 0/],
    [{ blocks: 1, maxTxs: MAX_EVM_WINDOW_TXS + 1n, maxValue: 1 }, /maxTxs must be at most 1000/],
    [{ blocks: 1, maxTxs: 1, maxValue: 0 }, /maxValue must be greater than 0/],
    [{ blocks: 1, maxTxs: 1, maxValue: "1.5" }, /maxValue must be an integer/],
  ])("refuses out-of-bounds parameters %#", (partial, re) => {
    expect(() => openEvmWindowMessage({ sender: QOR, ...(partial as never) })).toThrow(re);
  });

  it("refuses a missing sender and bad targets", () => {
    expect(() => openEvmWindowMessage({ sender: "", blocks: 1, maxTxs: 1, maxValue: 1 })).toThrow(/sender/);
    expect(() =>
      openEvmWindowMessage({ sender: QOR, blocks: 1, maxTxs: 1, maxValue: 1, allowedTargets: ["0x1234"] }),
    ).toThrow(/not a 0x-prefixed 20-byte address/);
    expect(() =>
      openEvmWindowMessage({
        sender: QOR,
        blocks: 1,
        maxTxs: 1,
        maxValue: 1,
        allowedTargets: [HEX, HEX.toLowerCase()],
      }),
    ).toThrow(/more than once/);
    const many = Array.from({ length: MAX_EVM_WINDOW_TARGETS + 1 }, (_, i) =>
      `0x${(i + 1).toString(16).padStart(40, "0")}`,
    );
    expect(() =>
      openEvmWindowMessage({ sender: QOR, blocks: 1, maxTxs: 1, maxValue: 1, allowedTargets: many }),
    ).toThrow(/maximum is 16/);
  });
});

describe("window sizing", () => {
  it("rounds wei up to uqor", () => {
    expect(weiToUqorCeil(0n)).toBe(0n);
    expect(weiToUqorCeil(1n)).toBe(1n);
    expect(weiToUqorCeil(1_000_000_000_000n)).toBe(1n);
    expect(weiToUqorCeil(1_000_000_000_001n)).toBe(2n);
  });

  it("counts value plus the maximum fee", () => {
    // 1,000 uqor sent with 21,000 gas at 112.5 gwei consumes 3,363 uqor.
    expect(
      evmWindowCost({ value: 1000n * 10n ** 12n, gas: 21_000n, maxFeePerGas: 112_500_000_000n }),
    ).toBe(3363n);
  });
});

describe("evmWindowStatus", () => {
  it("reads and parses the REST answer (numbers as strings, empty = 0)", async () => {
    const f = jsonFetch({
      found: true,
      live: true,
      opened_height: "100",
      expiry_height: "400",
      max_txs: "5",
      used_txs: "1",
      max_value: "2000000",
      used_value: "",
      remaining_blocks: "296",
      remaining_txs: "4",
      remaining_value: "9007199254740993",
      native_only: false,
      allowed_targets: [HEX],
    });
    const w = await evmWindowStatus({ rest: `${REST}/`, address: QOR, fetch: f });
    expect(f).toHaveBeenCalledWith(`${REST}/qorechain/pqc/v1/evm_window/${QOR}`);
    expect(w.found).toBe(true);
    expect(w.live).toBe(true);
    expect(w.expiryHeight).toBe(400n);
    expect(w.usedValue).toBe(0n);
    expect(w.remainingValue).toBe(9007199254740993n);
    expect(w.allowedTargets).toEqual([HEX]);
  });

  it("accepts the 0x form of an eth-native account", async () => {
    const f = jsonFetch({ found: false, live: false });
    const w = await evmWindowStatus({ rest: REST, address: HEX, fetch: f });
    expect(f).toHaveBeenCalledWith(`${REST}/qorechain/pqc/v1/evm_window/${QOR}`);
    expect(w).toMatchObject({ found: false, live: false, remainingTxs: 0n });
  });

  it("throws on a transport failure", async () => {
    await expect(evmWindowStatus({ rest: REST, address: QOR, fetch: jsonFetch({}, 502) })).rejects.toThrow(
      /HTTP 502/,
    );
  });
});

describe("address forms", () => {
  it("converts between 0x and qor1 for the same 20 bytes", () => {
    expect(toQorAddress(HEX)).toBe(QOR);
    expect(toEvmAddress(QOR)).toBe(HEX.toLowerCase());
  });

  it("refuses malformed input", () => {
    expect(() => toQorAddress("0x1234")).toThrow();
    expect(() => toEvmAddress(QOR.slice(0, -1) + (QOR.endsWith("2") ? "3" : "2"))).toThrow(/checksum/);
  });
});

describe("classifyEvmWindowRejection", () => {
  it("reads the chain's text, including through a viem cause chain", () => {
    const viemLike = {
      shortMessage: "Execution reverted",
      cause: { details: "account qor1abc has no open EVM authorisation window; open one with MsgOpenEVMWindow" },
    };
    expect(classifyEvmWindowRejection(viemLike)).toBe("no-window");
    expect(
      classifyEvmWindowRejection(
        new Error("account qor1abc has no registered post-quantum key; the EVM lane requires one, like every other lane"),
      ),
    ).toBe("no-pqc-key");
    expect(classifyEvmWindowRejection("EVM authorisation window exhausted")).toBe("exhausted");
  });

  it("falls back to the codespace/code form", () => {
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 26 })).toBe("no-window");
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 27 })).toBe("exhausted");
    expect(classifyEvmWindowRejection({ codespace: "pqc", code: 28 })).toBe("invalid");
  });

  it("does not match anything else", () => {
    expect(classifyEvmWindowRejection(new Error("insufficient funds"))).toBeUndefined();
    expect(classifyEvmWindowRejection({ codespace: "sdk", code: 26 })).toBeUndefined();
    expect(classifyEvmWindowRejection(undefined)).toBeUndefined();
    expect(isEvmWindowRejection(new Error("nonce too low"))).toBe(false);
  });
});

describe("@qorechain/evm/window subpath", () => {
  it("exposes the same functions", () => {
    expect(windowSubpath.evmWindowStatus).toBe(evmWindowStatus);
    expect(windowSubpath.openEvmWindowMessage).toBe(openEvmWindowMessage);
  });
});
