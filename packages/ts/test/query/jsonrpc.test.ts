import { describe, it, expect, vi } from "vitest";
import { JsonRpcClient, JsonRpcError } from "../../src/query/jsonrpc";

function rpcResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("JsonRpcClient", () => {
  it("builds a valid JSON-RPC 2.0 request and returns result", async () => {
    const fetchMock = vi.fn(async () => rpcResponse({ jsonrpc: "2.0", id: 1, result: "0x539" }));
    const client = new JsonRpcClient("http://host:8545", { fetch: fetchMock });
    const result = await client.call<string>("eth_chainId", []);
    expect(result).toBe("0x539");
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toEqual({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  });

  it("auto-increments the request id across calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rpcResponse({ jsonrpc: "2.0", id: 1, result: "a" }))
      .mockResolvedValueOnce(rpcResponse({ jsonrpc: "2.0", id: 2, result: "b" }));
    const client = new JsonRpcClient("http://host", { fetch: fetchMock });
    await client.call("m1");
    await client.call("m2");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).id).toBe(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).id).toBe(2);
  });

  it("defaults params to an empty array when omitted", async () => {
    const fetchMock = vi.fn(async () => rpcResponse({ jsonrpc: "2.0", id: 1, result: null }));
    const client = new JsonRpcClient("http://host", { fetch: fetchMock });
    await client.call("net_version");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).params).toEqual([]);
  });

  it("throws JsonRpcError on an error response with code and data", async () => {
    const fetchMock = vi.fn(async () =>
      rpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "not found", data: { x: 1 } } }),
    );
    const client = new JsonRpcClient("http://host", { fetch: fetchMock });
    const err = await client.call("nope").catch((e) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect(err).toMatchObject({ code: -32601, data: { x: 1 } });
  });

  it("exposes thin EVM helpers that use call under the hood", async () => {
    const fetchMock = vi.fn(async () => rpcResponse({ jsonrpc: "2.0", id: 1, result: "0x10" }));
    const client = new JsonRpcClient("http://host", { fetch: fetchMock });
    const balance = await client.ethGetBalance("0xabc");
    expect(balance).toBe("0x10");
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.method).toBe("eth_getBalance");
    expect(body.params).toEqual(["0xabc", "latest"]);
  });
});
