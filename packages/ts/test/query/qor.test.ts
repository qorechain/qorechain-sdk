import { describe, it, expect, vi } from "vitest";
import { QorClient } from "../../src/query/qor";

function rpcResponse(result: unknown = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    text: async () => "",
  } as unknown as Response;
}

function setup(result: unknown = {}) {
  const fetchMock = vi.fn(async () => rpcResponse(result));
  const client = new QorClient("http://host:8545", { fetch: fetchMock });
  return { fetchMock, client };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
}

describe("QorClient representative methods", () => {
  it("getPqcKeyStatus sends qor_getPQCKeyStatus with the address", async () => {
    const { fetchMock, client } = setup({ enabled: true });
    const res = await client.getPqcKeyStatus("qor1abc");
    expect(res).toEqual({ enabled: true });
    expect(sentBody(fetchMock)).toMatchObject({
      jsonrpc: "2.0",
      method: "qor_getPQCKeyStatus",
      params: ["qor1abc"],
    });
  });

  it("getSettlementBatch passes rollupId and batchIndex in order", async () => {
    const { fetchMock, client } = setup({});
    await client.getSettlementBatch("rollup-1", 7);
    expect(sentBody(fetchMock).params).toEqual(["rollup-1", 7]);
  });

  it("getDaBlobStatus passes rollupId and blobIndex in order", async () => {
    const { fetchMock, client } = setup({});
    await client.getDaBlobStatus("rollup-1", 3);
    expect(sentBody(fetchMock)).toMatchObject({
      method: "qor_getDABlobStatus",
      params: ["rollup-1", 3],
    });
  });
});

// Table of every method -> EXACT wire method string + expected params.
// The casing here is load-bearing and must match the chain exactly.
type Call = (c: QorClient) => Promise<unknown>;
const table: Array<[Call, string, unknown[]]> = [
  [(c) => c.getPqcKeyStatus("a"), "qor_getPQCKeyStatus", ["a"]],
  [(c) => c.getHybridSignatureMode(), "qor_getHybridSignatureMode", []],
  [(c) => c.getAiStats(), "qor_getAIStats", []],
  [(c) => c.getCrossVmMessage("m1"), "qor_getCrossVMMessage", ["m1"]],
  [(c) => c.getReputationScore("v1"), "qor_getReputationScore", ["v1"]],
  [(c) => c.getLayerInfo("l1"), "qor_getLayerInfo", ["l1"]],
  [(c) => c.getBridgeStatus("c1"), "qor_getBridgeStatus", ["c1"]],
  [(c) => c.getRlAgentStatus(), "qor_getRLAgentStatus", []],
  [(c) => c.getRlObservation(), "qor_getRLObservation", []],
  [(c) => c.getRlReward(), "qor_getRLReward", []],
  [(c) => c.getPoolClassification("v1"), "qor_getPoolClassification", ["v1"]],
  [(c) => c.getBurnStats(), "qor_getBurnStats", []],
  [(c) => c.getXqorePosition("a"), "qor_getXQOREPosition", ["a"]],
  [(c) => c.getInflationRate(), "qor_getInflationRate", []],
  [(c) => c.getTokenomicsOverview(), "qor_getTokenomicsOverview", []],
  [(c) => c.getRollupStatus("r1"), "qor_getRollupStatus", ["r1"]],
  [(c) => c.listRollups(), "qor_listRollups", []],
  [(c) => c.getSettlementBatch("r1", 2), "qor_getSettlementBatch", ["r1", 2]],
  [(c) => c.suggestRollupProfile("defi"), "qor_suggestRollupProfile", ["defi"]],
  [(c) => c.getDaBlobStatus("r1", 4), "qor_getDABlobStatus", ["r1", 4]],
  [(c) => c.getBtcStakingPosition("a"), "qor_getBTCStakingPosition", ["a"]],
  [(c) => c.getAbstractAccount("a"), "qor_getAbstractAccount", ["a"]],
  [(c) => c.getFairBlockStatus(), "qor_getFairBlockStatus", []],
  [(c) => c.getGasAbstractionConfig(), "qor_getGasAbstractionConfig", []],
  [(c) => c.getLaneConfiguration(), "qor_getLaneConfiguration", []],
];

describe("QorClient covers all 25 qor_ methods with exact wire names", () => {
  it("has exactly 25 entries in the table", () => {
    expect(table).toHaveLength(25);
    const names = new Set(table.map(([, m]) => m));
    expect(names.size).toBe(25);
  });

  it.each(table)("%# sends the exact method and params", async (invoke, method, params) => {
    const { fetchMock, client } = setup({});
    await invoke(client);
    const body = sentBody(fetchMock);
    expect(body.method).toBe(method);
    expect(body.params).toEqual(params);
    expect(body.jsonrpc).toBe("2.0");
  });
});
