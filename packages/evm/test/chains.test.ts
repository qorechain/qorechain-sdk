import { describe, it, expect } from "vitest";
import { createPublicClient, custom } from "viem";
import {
  qorechain,
  qorechainTestnet,
  QORECHAIN_CHAINS,
  QORECHAIN_REST_ENDPOINTS,
} from "../src/index";

describe("chain definitions", () => {
  it("describes mainnet (9801)", () => {
    expect(qorechain.id).toBe(9801);
    expect(qorechain.name).toBe("QoreChain");
    expect(qorechain.nativeCurrency).toEqual({ name: "QOR", symbol: "QOR", decimals: 18 });
    expect(qorechain.rpcUrls.default.http).toEqual(["https://evm.qore.host"]);
    expect(qorechain.blockExplorers?.default.url).toBe("https://explore.qore.network");
    expect(qorechain.testnet).toBeUndefined();
  });

  it("describes the testnet (9800) with its WebSocket endpoint", () => {
    expect(qorechainTestnet.id).toBe(9800);
    expect(qorechainTestnet.name).toBe("QoreChain Testnet");
    expect(qorechainTestnet.nativeCurrency.decimals).toBe(18);
    expect(qorechainTestnet.rpcUrls.default.http).toEqual(["https://evm-testnet.qore.host"]);
    expect(qorechainTestnet.rpcUrls.default.webSocket).toEqual(["wss://evm-ws-testnet.qore.host"]);
    expect(qorechainTestnet.blockExplorers?.default.url).toBe("https://explore.qore.network");
    expect(qorechainTestnet.testnet).toBe(true);
  });

  it("lists mainnet first and pairs each chain with its REST endpoint", () => {
    expect(QORECHAIN_CHAINS.map((c) => c.id)).toEqual([9801, 9800]);
    expect(QORECHAIN_REST_ENDPOINTS[9801]).toBe("https://api.qore.host");
    expect(QORECHAIN_REST_ENDPOINTS[9800]).toBe("https://api-testnet.qore.host");
  });

  it("works as a viem chain", async () => {
    const client = createPublicClient({
      chain: qorechainTestnet,
      transport: custom({ request: async () => "0x2648" }),
    });
    expect(client.chain.id).toBe(9800);
    expect(await client.getChainId()).toBe(9800);
  });
});
