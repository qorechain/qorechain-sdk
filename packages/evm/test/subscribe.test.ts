import { describe, it, expect, vi } from "vitest";
import { custom, type PublicClient } from "viem";
import {
  createEvmSubscriptionClient,
  watchBlocks,
  watchEvent,
  watchContractEvent,
  watchPendingTransactions,
} from "../src/subscribe";

describe("createEvmSubscriptionClient", () => {
  it("builds a public client over a provided transport", () => {
    const transport = custom({ request: vi.fn(async () => null) });
    const client = createEvmSubscriptionClient({ transport });
    expect(typeof client.watchBlocks).toBe("function");
    expect(typeof client.watchPendingTransactions).toBe("function");
  });

  it("requires a ws url, endpoints, or transport", () => {
    expect(() => createEvmSubscriptionClient({})).toThrow(/wsUrl|evmWs|transport/);
  });

  it("accepts endpoints.evmWs", () => {
    const client = createEvmSubscriptionClient({
      endpoints: { evmWs: "ws://localhost:8546" },
    });
    expect(typeof client.watchEvent).toBe("function");
  });
});

describe("watch* passthroughs", () => {
  function fakeClient() {
    const unwatch = vi.fn();
    return {
      client: {
        watchBlocks: vi.fn(() => unwatch),
        watchEvent: vi.fn(() => unwatch),
        watchContractEvent: vi.fn(() => unwatch),
        watchPendingTransactions: vi.fn(() => unwatch),
      } as unknown as PublicClient,
      unwatch,
    };
  }

  it("wires watchBlocks to the viem client and returns unwatch", () => {
    const { client, unwatch } = fakeClient();
    const args = { onBlock: vi.fn() } as never;
    const off = watchBlocks(client, args);
    expect(client.watchBlocks).toHaveBeenCalledWith(args);
    expect(off).toBe(unwatch);
  });

  it("wires watchEvent", () => {
    const { client } = fakeClient();
    const args = { onLogs: vi.fn() } as never;
    watchEvent(client, args);
    expect(client.watchEvent).toHaveBeenCalledWith(args);
  });

  it("wires watchContractEvent", () => {
    const { client } = fakeClient();
    const args = { address: "0x0000000000000000000000000000000000000001", abi: [], onLogs: vi.fn() } as never;
    watchContractEvent(client, args);
    expect(client.watchContractEvent).toHaveBeenCalledWith(args);
  });

  it("wires watchPendingTransactions", () => {
    const { client } = fakeClient();
    const args = { onTransactions: vi.fn() } as never;
    watchPendingTransactions(client, args);
    expect(client.watchPendingTransactions).toHaveBeenCalledWith(args);
  });
});
