import { describe, it, expect, vi } from "vitest";
import {
  custom,
  encodeFunctionResult,
  decodeFunctionData,
  type Hex,
} from "viem";
import { createEvmClient, erc20, ERC20_ABI } from "../src/index";

const ERC20_ADDR = "0x00000000000000000000000000000000000000ff" as const;
const HOLDER = "0x1111111111111111111111111111111111111111" as const;

function evmClientWith(call: (to: Hex, data: Hex) => Hex) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_call") {
      const { to, data } = (params as { to: Hex; data: Hex }[])[0];
      return call(to, data);
    }
    throw new Error(`unexpected ${method}`);
  });
  return { transport: custom({ request }), request };
}

describe("erc20 read helpers", () => {
  it("balanceOf issues eth_call to the token with balanceOf(address) calldata and decodes the result", async () => {
    let seenTo: Hex | undefined;
    let seenData: Hex | undefined;
    const { transport } = evmClientWith((to, data) => {
      seenTo = to;
      seenData = data;
      return encodeFunctionResult({
        abi: ERC20_ABI,
        functionName: "balanceOf",
        result: 123_456n,
      });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });

    const balance = await erc20.balanceOf(client.publicClient, ERC20_ADDR, HOLDER);

    expect(balance).toBe(123_456n);
    expect(seenTo?.toLowerCase()).toBe(ERC20_ADDR);
    // calldata decodes back to the right function + args
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: seenData! });
    expect(decoded.functionName).toBe("balanceOf");
    expect((decoded.args as readonly unknown[])[0]).toBe(HOLDER);
  });

  it("metadata reads name/symbol/decimals", async () => {
    const { transport } = evmClientWith((_to, data) => {
      const { functionName } = decodeFunctionData({ abi: ERC20_ABI, data });
      if (functionName === "name")
        return encodeFunctionResult({ abi: ERC20_ABI, functionName: "name", result: "Qore Token" });
      if (functionName === "symbol")
        return encodeFunctionResult({ abi: ERC20_ABI, functionName: "symbol", result: "QT" });
      if (functionName === "decimals")
        return encodeFunctionResult({ abi: ERC20_ABI, functionName: "decimals", result: 18 });
      throw new Error(`unexpected fn ${functionName}`);
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });

    const meta = await erc20.metadata(client.publicClient, ERC20_ADDR);
    expect(meta).toEqual({ name: "Qore Token", symbol: "QT", decimals: 18 });
  });

  it("allowance issues allowance(owner,spender) calldata", async () => {
    const spender = "0x2222222222222222222222222222222222222222" as const;
    let seenData: Hex | undefined;
    const { transport } = evmClientWith((_to, data) => {
      seenData = data;
      return encodeFunctionResult({ abi: ERC20_ABI, functionName: "allowance", result: 7n });
    });
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });

    const allowance = await erc20.allowance(client.publicClient, ERC20_ADDR, HOLDER, spender);
    expect(allowance).toBe(7n);
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data: seenData! });
    expect(decoded.functionName).toBe("allowance");
    expect(decoded.args).toEqual([HOLDER, spender]);
  });
});
