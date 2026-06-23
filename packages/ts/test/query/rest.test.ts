import { describe, it, expect, vi } from "vitest";
import { RestClient } from "../../src/query/rest";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function setup(body: unknown = {}) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  const client = new RestClient("http://host:1317", { fetch: fetchMock });
  return { fetchMock, client };
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls[0][0] as string;
}

describe("RestClient bank endpoints", () => {
  it("getAllBalances hits the standard Cosmos path", async () => {
    const { fetchMock, client } = setup({ balances: [] });
    await client.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("getBalance hits the by_denom path with the denom query", async () => {
    const { fetchMock, client } = setup({ balance: { denom: "uqor", amount: "1" } });
    await client.getBalance("qor1abc", "uqor");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/cosmos/bank/v1beta1/balances/qor1abc/by_denom?denom=uqor",
    );
  });

  it("URL-encodes path params", async () => {
    const { fetchMock, client } = setup({ balances: [] });
    await client.getAllBalances("qor1 a/b");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/cosmos/bank/v1beta1/balances/qor1%20a%2Fb",
    );
  });

  it("applies Cosmos-style pagination params", async () => {
    const { fetchMock, client } = setup({ balances: [] });
    await client.getAllBalances("qor1abc", { pagination: { key: "abc", limit: 50 } });
    const url = calledUrl(fetchMock);
    expect(url).toContain("pagination.key=abc");
    expect(url).toContain("pagination.limit=50");
  });

  it("joins base and path without double slashes when base has a trailing slash", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = new RestClient("http://host:1317/", { fetch: fetchMock });
    await client.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "http://host:1317/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });
});

describe("RestClient custom QoreChain module reads", () => {
  const cases: Array<[string, (c: RestClient) => Promise<unknown>, string]> = [
    ["getAiStats", (c) => c.getAiStats(), "http://host:1317/qorechain/ai/v1/stats"],
    [
      "getFeeEstimate",
      (c) => c.getFeeEstimate("fast"),
      "http://host:1317/qorechain/ai/v1/fee-estimate?urgency=fast",
    ],
    ["getBridgeChains", (c) => c.getBridgeChains(), "http://host:1317/qorechain/bridge/v1/chains"],
    [
      "getPqcAccount",
      (c) => c.getPqcAccount("qor1abc"),
      "http://host:1317/qorechain/pqc/v1/accounts/qor1abc",
    ],
    [
      "getReputation",
      (c) => c.getReputation("qorvaloper1xyz"),
      "http://host:1317/qorechain/reputation/v1/validators/qorvaloper1xyz",
    ],
    ["getBurnStats", (c) => c.getBurnStats(), "http://host:1317/qorechain/burn/v1/stats"],
    [
      "getXqorePosition",
      (c) => c.getXqorePosition("qor1abc"),
      "http://host:1317/qorechain/xqore/v1/position/qor1abc",
    ],
    ["getInflationRate", (c) => c.getInflationRate(), "http://host:1317/qorechain/inflation/v1/rate"],
  ];

  it.each(cases)("%s hits the correct path", async (_name, invoke, expected) => {
    const { fetchMock, client } = setup({});
    await invoke(client);
    expect(calledUrl(fetchMock)).toBe(expected);
  });

  it("generic get<T> escape hatch builds path and query", async () => {
    const { fetchMock, client } = setup({ data: 1 });
    await client.get("/qorechain/custom/v1/thing", { foo: "bar" });
    expect(calledUrl(fetchMock)).toBe("http://host:1317/qorechain/custom/v1/thing?foo=bar");
  });

  it("parses and returns the JSON body", async () => {
    const { client } = setup({ balances: [{ denom: "uqor", amount: "100" }] });
    const res = await client.getAllBalances("qor1abc");
    expect(res).toEqual({ balances: [{ denom: "uqor", amount: "100" }] });
  });
});
