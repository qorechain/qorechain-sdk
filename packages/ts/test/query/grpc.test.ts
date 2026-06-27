import { describe, it, expect, vi } from "vitest";
import { createQueryClients } from "../../src/query/grpc";
import { QueryAccountResponse } from "../../src/codegen/qorechain/pqc/v1/query";
import { QuerySlotResponse } from "../../src/codegen/qorechain/svm/v1/query";
import {
  QueryLayerResponse,
  QueryLayersResponse,
  QueryRoutingStatsView,
} from "../../src/codegen/qorechain/multilayer/v1/query";
import {
  QueryRollupResponse,
  QueryLatestBatchResponse,
} from "../../src/codegen/qorechain/rdk/v1/query";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

describe("typed query clients", () => {
  it("dispatches pqc.account by service/method and decodes the response", async () => {
    // The RPC client returns the encoded response for the requested method.
    const expected = QueryAccountResponse.fromPartial({ found: true });
    const request = vi.fn(async () =>
      QueryAccountResponse.encode(expected).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.pqc.account({ address: ADDR });

    expect(request).toHaveBeenCalledOnce();
    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.pqc.v1.Query");
    expect(method).toBe("Account");
    expect(res).toMatchObject({ found: true });
  });

  it("dispatches svm.slot to the correct service/method", async () => {
    const request = vi.fn(async () =>
      QuerySlotResponse.encode(QuerySlotResponse.fromPartial({ slot: "42" }))
        .finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.svm.slot({});

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.svm.v1.Query");
    expect(method).toBe("Slot");
    expect(res.slot).toBe("42");
  });

  it("dispatches multilayer.layer by service/method and decodes the response", async () => {
    const expected = QueryLayerResponse.fromPartial({
      layer: { layerId: "game-sidechain", status: "active" },
    });
    const request = vi.fn(async () =>
      QueryLayerResponse.encode(expected).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.multilayer.layer({ layerId: "game-sidechain" });

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.multilayer.v1.Query");
    expect(method).toBe("Layer");
    expect(res.layer?.layerId).toBe("game-sidechain");
  });

  it("dispatches multilayer.layers and multilayer.routingStats", async () => {
    const layersReq = vi.fn(async () =>
      QueryLayersResponse.encode(
        QueryLayersResponse.fromPartial({ layers: [{ layerId: "a" }] }),
      ).finish(),
    );
    const layersClients = createQueryClients({ request: layersReq } as never);
    const layers = await layersClients.multilayer.layers({});
    expect(layersReq.mock.calls[0][1]).toBe("Layers");
    expect(layers.layers).toHaveLength(1);

    const statsReq = vi.fn(async () =>
      QueryRoutingStatsView.encode(
        QueryRoutingStatsView.fromPartial({ stats: { totalRouted: "9" } }),
      ).finish(),
    );
    const statsClients = createQueryClients({ request: statsReq } as never);
    const stats = await statsClients.multilayer.routingStats({});
    expect(statsReq.mock.calls[0][0]).toBe("qorechain.multilayer.v1.Query");
    expect(statsReq.mock.calls[0][1]).toBe("RoutingStats");
    expect(stats.stats?.totalRouted).toBe("9");
  });

  it("dispatches rdk.rollup by service/method and decodes the response", async () => {
    const expected = QueryRollupResponse.fromPartial({
      rollup: { rollupId: "my-app-rollup", status: "active" },
    });
    const request = vi.fn(async () =>
      QueryRollupResponse.encode(expected).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.rdk.rollup({ rollupId: "my-app-rollup" });

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.rdk.v1.Query");
    expect(method).toBe("Rollup");
    expect(res.rollup?.rollupId).toBe("my-app-rollup");
  });

  it("dispatches rdk.latestBatch to the correct service/method", async () => {
    const request = vi.fn(async () =>
      QueryLatestBatchResponse.encode(
        QueryLatestBatchResponse.fromPartial({
          batch: { rollupId: "r1", batchIndex: "3" },
        }),
      ).finish(),
    );
    const clients = createQueryClients({ request } as never);

    const res = await clients.rdk.latestBatch({ rollupId: "r1" });

    const [service, method] = request.mock.calls[0];
    expect(service).toBe("qorechain.rdk.v1.Query");
    expect(method).toBe("LatestBatch");
    expect(res.batch?.batchIndex).toBe("3");
  });
});
