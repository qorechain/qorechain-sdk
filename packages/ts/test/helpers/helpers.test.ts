import { describe, it, expect, vi } from "vitest";

import {
  createMultilayerClient,
  createRollupClient,
} from "../../src/helpers";
import type { TxClient } from "../../src/tx/builder";
import type {
  MultilayerQueryClient,
  RdkQueryClient,
} from "../../src/query/grpc";
import type { QorClient } from "../../src/query/qor";

const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

/** A fake TxClient capturing the messages handed to signAndBroadcast. */
function fakeTx() {
  const signAndBroadcast = vi.fn(async () => ({
    transactionHash: "DEADBEEF",
    code: 0,
  }));
  const tx = {
    senderAddress: ADDR,
    signAndBroadcast,
  } as unknown as TxClient;
  return { tx, signAndBroadcast };
}

describe("createMultilayerClient", () => {
  it("builds registerSidechain with the sender as creator and string-coerced ints", () => {
    const { tx } = fakeTx();
    const multi = createMultilayerClient(tx);
    const m = multi.registerSidechainMsg({
      layerId: "game-sidechain",
      targetBlockTimeMs: 500,
      maxTransactionsPerBlock: 10_000n,
      minValidators: 3,
      settlementIntervalBlocks: "100",
      supportedVmTypes: ["evm"],
    });
    expect(m.typeUrl).toBe("/qorechain.multilayer.v1.MsgRegisterSidechain");
    const v = m.value as Record<string, unknown>;
    expect(v.creator).toBe(ADDR);
    expect(v.layerId).toBe("game-sidechain");
    // uint64 fields are carried as strings by the generated codec.
    expect(v.targetBlockTimeMs).toBe("500");
    expect(v.maxTransactionsPerBlock).toBe("10000");
    expect(v.settlementIntervalBlocks).toBe("100");
    expect(v.minValidators).toBe(3);
  });

  it("anchorState uses the sender as relayer and routeTransaction as sender", () => {
    const { tx } = fakeTx();
    const multi = createMultilayerClient(tx);

    const anchor = multi.anchorStateMsg({
      layerId: "l1",
      layerHeight: 7,
      stateRoot: new Uint8Array([1, 2, 3]),
    });
    expect(anchor.typeUrl).toBe("/qorechain.multilayer.v1.MsgAnchorState");
    expect((anchor.value as Record<string, unknown>).relayer).toBe(ADDR);

    const route = multi.routeTransactionMsg({
      transactionPayload: new Uint8Array([9]),
      preferredLayer: "l1",
    });
    expect(route.typeUrl).toBe("/qorechain.multilayer.v1.MsgRouteTransaction");
    expect((route.value as Record<string, unknown>).sender).toBe(ADDR);
  });

  it("registerSidechain broadcasts the composed message via the TxClient", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const multi = createMultilayerClient(tx);
    const res = await multi.registerSidechain({ layerId: "x" });
    expect(res.transactionHash).toBe("DEADBEEF");
    expect(signAndBroadcast).toHaveBeenCalledOnce();
    const [messages, fee] = signAndBroadcast.mock.calls[0];
    expect(messages[0].typeUrl).toBe(
      "/qorechain.multilayer.v1.MsgRegisterSidechain",
    );
    expect(fee).toBe("auto");
  });

  it("read methods delegate to the query client", async () => {
    const { tx } = fakeTx();
    const query = {
      layer: vi.fn(async () => ({ layer: { layerId: "x" } })),
      layers: vi.fn(async () => ({ layers: [] })),
      routingStats: vi.fn(async () => ({ stats: undefined })),
      params: vi.fn(async () => ({ params: undefined })),
    } as unknown as MultilayerQueryClient;
    const multi = createMultilayerClient(tx, { query });

    await multi.getLayer("x");
    await multi.listLayers();
    await multi.routingStats();
    expect((query.layer as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      layerId: "x",
    });
    expect(query.layers).toHaveBeenCalled();
    expect(query.routingStats).toHaveBeenCalled();
  });

  it("read methods throw a clear error without a query client", () => {
    const { tx } = fakeTx();
    const multi = createMultilayerClient(tx);
    expect(() => multi.getLayer("x")).toThrow(/query client/);
  });
});

describe("createRollupClient", () => {
  it("createRollup uses the sender as creator; executeWithdrawal as submitter", () => {
    const { tx } = fakeTx();
    const rollup = createRollupClient(tx);

    const create = rollup.createRollupMsg({
      rollupId: "r1",
      profile: "default",
      vmType: "evm",
      stakeAmount: 1_000_000,
    });
    expect(create.typeUrl).toBe("/qorechain.rdk.v1.MsgCreateRollup");
    const cv = create.value as Record<string, unknown>;
    expect(cv.creator).toBe(ADDR);
    expect(cv.stakeAmount).toBe("1000000");

    const wd = rollup.executeWithdrawalMsg({
      rollupId: "r1",
      batchIndex: 0,
      withdrawalIndex: 1,
      recipient: ADDR,
      denom: "uqor",
      amount: 500_000,
      proof: [new Uint8Array([1])],
    });
    expect(wd.typeUrl).toBe("/qorechain.rdk.v1.MsgExecuteWithdrawal");
    const wv = wd.value as Record<string, unknown>;
    expect(wv.submitter).toBe(ADDR);
    expect(wv.batchIndex).toBe("0");
    expect(wv.withdrawalIndex).toBe("1");
    expect(wv.amount).toBe("500000");
    expect((wv.proof as Uint8Array[]).length).toBe(1);
  });

  it("submitBatch carries the withdrawalsRoot and sequencer", async () => {
    const { tx, signAndBroadcast } = fakeTx();
    const rollup = createRollupClient(tx);
    await rollup.submitBatch({
      rollupId: "r1",
      batchIndex: 3,
      stateRoot: new Uint8Array([1]),
      withdrawalsRoot: new Uint8Array([2, 2, 2]),
    });
    const [messages] = signAndBroadcast.mock.calls[0];
    const v = messages[0].value as Record<string, unknown>;
    expect(messages[0].typeUrl).toBe("/qorechain.rdk.v1.MsgSubmitBatch");
    expect(v.sequencer).toBe(ADDR);
    expect(v.batchIndex).toBe("3");
    expect(v.withdrawalsRoot).toEqual(new Uint8Array([2, 2, 2]));
  });

  it("typed reads delegate to the query client (getBatch coerces the index)", async () => {
    const { tx } = fakeTx();
    const query = {
      rollup: vi.fn(async () => ({ rollup: undefined })),
      rollups: vi.fn(async () => ({ rollups: [] })),
      batch: vi.fn(async () => ({ batch: undefined })),
      latestBatch: vi.fn(async () => ({ batch: undefined })),
      params: vi.fn(async () => ({ params: undefined })),
    } as unknown as RdkQueryClient;
    const rollup = createRollupClient(tx, { query });

    await rollup.getBatch("r1", 5);
    expect(query.batch).toHaveBeenCalledWith({
      rollupId: "r1",
      batchIndex: "5",
    });
    await rollup.getLatestBatch("r1");
    expect(query.latestBatch).toHaveBeenCalledWith({ rollupId: "r1" });
  });

  it("qor_ conveniences delegate to the qor client", async () => {
    const { tx } = fakeTx();
    const qor = {
      getRollupStatus: vi.fn(async () => ({ ok: true })),
      suggestRollupProfile: vi.fn(async () => ({ profile: "p" })),
      getDaBlobStatus: vi.fn(async () => ({ available: true })),
    } as unknown as QorClient;
    const rollup = createRollupClient(tx, { qor });

    await rollup.getRollupStatus("r1");
    await rollup.suggestRollupProfile("payments");
    await rollup.getDaBlobStatus("r1", 0);
    expect(qor.getRollupStatus).toHaveBeenCalledWith("r1");
    expect(qor.suggestRollupProfile).toHaveBeenCalledWith("payments");
    expect(qor.getDaBlobStatus).toHaveBeenCalledWith("r1", 0);
  });

  it("reads throw clear errors when their client is missing", () => {
    const { tx } = fakeTx();
    const rollup = createRollupClient(tx);
    expect(() => rollup.getRollup("r1")).toThrow(/query client/);
    expect(() => rollup.getRollupStatus("r1")).toThrow(/qor client/);
  });
});
