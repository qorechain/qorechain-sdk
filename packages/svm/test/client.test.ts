import { describe, it, expect, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { createSvmClient } from "../src/index";

/**
 * A minimal fake `Connection` that records the constructor args and stubs the
 * RPC methods we call. We pass it in via the `connection` option so no real
 * network is touched.
 */
function fakeConnection(overrides: Record<string, unknown> = {}) {
  return {
    rpcEndpoint: "http://localhost:8899",
    commitment: "confirmed",
    getBalance: vi.fn(async () => 0),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: "FakeBlockhash1111111111111111111111111111111",
      lastValidBlockHeight: 100,
    })),
    ...overrides,
  };
}

describe("createSvmClient", () => {
  it("defaults the RPC endpoint to the testnet localhost:8899", () => {
    const client = createSvmClient();
    expect(client.connection.rpcEndpoint).toBe("http://localhost:8899");
  });

  it("targets the explicit rpcUrl and commitment", () => {
    const client = createSvmClient({ rpcUrl: "http://node:8899", commitment: "finalized" });
    expect(client.connection.rpcEndpoint).toBe("http://node:8899");
    expect(client.connection.commitment).toBe("finalized");
  });

  it("accepts a qorechain-sdk endpoints object (svmRpc)", () => {
    const client = createSvmClient({ endpoints: { svmRpc: "http://svm-node:8899" } });
    expect(client.connection.rpcEndpoint).toBe("http://svm-node:8899");
  });

  it("uses an injected connection as-is (for testing)", () => {
    const conn = fakeConnection({ rpcEndpoint: "http://injected:8899" });
    const client = createSvmClient({ connection: conn as never });
    expect(client.connection.rpcEndpoint).toBe("http://injected:8899");
  });

  it("getBalance calls through to the connection", async () => {
    const pk = new PublicKey("11111111111111111111111111111111");
    const conn = fakeConnection({ getBalance: vi.fn(async () => 42) });
    const client = createSvmClient({ connection: conn as never });
    const bal = await client.getBalance(pk);
    expect(bal).toBe(42);
    expect(conn.getBalance).toHaveBeenCalled();
    expect((conn.getBalance as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(pk);
  });

  it("getLatestBlockhash calls through and returns the parsed value", async () => {
    const conn = fakeConnection();
    const client = createSvmClient({ connection: conn as never });
    const bh = await client.getLatestBlockhash();
    expect(bh.blockhash).toBe("FakeBlockhash1111111111111111111111111111111");
    expect(conn.getLatestBlockhash).toHaveBeenCalled();
  });
});
