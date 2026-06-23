import { describe, it, expect, vi } from "vitest";
import { custom } from "viem";
import { createEvmClient } from "../src/index";

/**
 * Build a viem `custom` transport backed by a vitest mock so we can intercept
 * and assert raw JSON-RPC requests without any real network.
 */
function mockTransport(handler: (args: { method: string; params: unknown[] }) => unknown) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) =>
    handler({ method, params: (params ?? []) as unknown[] }),
  );
  return { transport: custom({ request }), request };
}

describe("createEvmClient", () => {
  it("auto-detects the chain id via eth_chainId and builds the chain object", async () => {
    const { transport, request } = mockTransport(({ method }) => {
      if (method === "eth_chainId") return "0x1a2b"; // 6699
      throw new Error(`unexpected method ${method}`);
    });

    const client = await createEvmClient({ rpcUrl: "http://localhost:8545", transport });

    expect(await client.getChainId()).toBe(6699);
    expect(client.chain.id).toBe(6699);
    expect(client.chain.rpcUrls.default.http).toContain("http://localhost:8545");
    // eth_chainId was actually issued for auto-detection.
    expect(
      request.mock.calls.some((c) => (c[0] as { method: string }).method === "eth_chainId"),
    ).toBe(true);
  });

  it("uses an explicitly provided chain id without calling eth_chainId", async () => {
    const { transport, request } = mockTransport(() => {
      throw new Error("should not issue any request when chainId is provided");
    });

    const client = await createEvmClient({
      rpcUrl: "http://localhost:8545",
      chainId: 4242,
      transport,
    });

    expect(client.chain.id).toBe(4242);
    expect(await client.getChainId()).toBe(4242);
    expect(request).not.toHaveBeenCalled();
  });

  it("defaults native currency to QOR with 18 decimals and allows overrides", async () => {
    const { transport } = mockTransport(() => "0x1");
    const client = await createEvmClient({ rpcUrl: "http://x", chainId: 1, transport });
    expect(client.chain.nativeCurrency).toMatchObject({ symbol: "QOR", decimals: 18 });

    const custom6 = await createEvmClient({
      rpcUrl: "http://x",
      chainId: 1,
      transport,
      decimals: 6,
    });
    expect(custom6.chain.nativeCurrency.decimals).toBe(6);
  });

  it("accepts a network endpoints object (evmRpc/evmWs)", async () => {
    const { transport } = mockTransport(() => "0x1");
    const client = await createEvmClient({
      endpoints: { evmRpc: "http://node:8545", evmWs: "ws://node:8546" },
      chainId: 7,
      transport,
    });
    expect(client.chain.rpcUrls.default.http).toContain("http://node:8545");
    expect(client.chain.rpcUrls.default.webSocket).toContain("ws://node:8546");
  });
});
