import { describe, it, expect, vi } from "vitest";
import {
  getTx,
  getBlock,
  getLatestBlock,
  searchTxs,
  buildEventsQuery,
} from "../src/search";
import type { RestClient } from "../src/query/rest";

/** A RestClient stub recording `get(path, query)` calls. */
function fakeRest() {
  const get = vi.fn(async () => ({ ok: true }));
  return { client: { get } as unknown as RestClient, get };
}

describe("buildEventsQuery", () => {
  it("renders string and numeric attribute filters", () => {
    expect(buildEventsQuery({ "message.sender": "qor1abc" })).toBe(
      "message.sender='qor1abc'",
    );
    expect(
      buildEventsQuery({ "message.sender": "qor1abc", "tx.height": 5 }),
    ).toBe("message.sender='qor1abc' AND tx.height=5");
  });
});

describe("getTx / getBlock / getLatestBlock", () => {
  it("hits the tx-by-hash path", async () => {
    const { client, get } = fakeRest();
    await getTx(client, "ABCD");
    expect(get).toHaveBeenCalledWith("/cosmos/tx/v1beta1/txs/ABCD");
  });

  it("hits the block-by-height path", async () => {
    const { client, get } = fakeRest();
    await getBlock(client, 42);
    expect(get).toHaveBeenCalledWith(
      "/cosmos/base/tendermint/v1beta1/blocks/42",
    );
  });

  it("hits the latest-block path", async () => {
    const { client, get } = fakeRest();
    await getLatestBlock(client);
    expect(get).toHaveBeenCalledWith(
      "/cosmos/base/tendermint/v1beta1/blocks/latest",
    );
  });
});

describe("searchTxs", () => {
  it("sends the `query` parameter (not `events`) with page and limit", async () => {
    const { client, get } = fakeRest();
    await searchTxs(client, { "message.sender": "qor1abc" }, {
      page: 2,
      limit: 50,
      orderBy: "desc",
    });
    expect(get).toHaveBeenCalledWith("/cosmos/tx/v1beta1/txs", {
      query: "message.sender='qor1abc'",
      limit: 50,
      order_by: "ORDER_BY_DESC",
      page: 2,
    });
  });

  it("accepts a raw query string and omits unset params", async () => {
    const { client, get } = fakeRest();
    await searchTxs(client, "message.action='/cosmos.bank.v1beta1.MsgSend'");
    const [path, params] = get.mock.calls[0];
    expect(path).toBe("/cosmos/tx/v1beta1/txs");
    expect(params.query).toBe("message.action='/cosmos.bank.v1beta1.MsgSend'");
    expect(params.events).toBeUndefined();
    expect(params.order_by).toBeUndefined();
    expect(params.limit).toBeUndefined();
    expect(params["pagination.limit"]).toBeUndefined();
  });

  it("joins several filters with AND in the `query` parameter", async () => {
    const { client, get } = fakeRest();
    await searchTxs(client, {
      "message.sender": "qor1abc",
      "transfer.recipient": "qor1def",
    });
    const [, params] = get.mock.calls[0];
    expect(params.query).toBe(
      "message.sender='qor1abc' AND transfer.recipient='qor1def'",
    );
    expect(params.query).not.toContain("&");
  });
});
