import { describe, it, expect, vi } from "vitest";
import { custom } from "viem";
import { createEvmClient, estimateEip1559Fees, gasPrice } from "../src/index";

describe("estimateEip1559Fees", () => {
  it("returns viem's maxFeePerGas / maxPriorityFeePerGas pair", async () => {
    // base fee 1 gwei -> viem derives maxFeePerGas from base + tip.
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getBlockByNumber")
        return { baseFeePerGas: "0x3b9aca00", number: "0x1", gasLimit: "0x1c9c380" };
      if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00"; // 1 gwei tip
      throw new Error(`unexpected ${method}`);
    });
    const client = await createEvmClient({
      rpcUrl: "http://x",
      chainId: 1,
      transport: custom({ request }),
    });
    const f = await estimateEip1559Fees(client.publicClient);
    expect(typeof f.maxFeePerGas).toBe("bigint");
    expect(typeof f.maxPriorityFeePerGas).toBe("bigint");
    expect(f.maxPriorityFeePerGas).toBe(1_000_000_000n);
    // maxFeePerGas must cover base + tip.
    expect(f.maxFeePerGas).toBeGreaterThanOrEqual(f.maxPriorityFeePerGas);
  });
});

describe("gasPrice", () => {
  it("returns the legacy gas price from eth_gasPrice", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_gasPrice") return "0x3b9aca00";
      throw new Error(`unexpected ${method}`);
    });
    const client = await createEvmClient({
      rpcUrl: "http://x",
      chainId: 1,
      transport: custom({ request }),
    });
    expect(await gasPrice(client.publicClient)).toBe(1_000_000_000n);
  });
});
