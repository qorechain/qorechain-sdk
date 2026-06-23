import { describe, it, expect, vi } from "vitest";
import {
  queryContractSmart,
  getContractInfo,
  instantiate,
  execute,
  uploadCode,
  type CosmWasmReadClient,
  type CosmWasmSigningClient,
} from "../../src/cosmwasm";

const CONTRACT = "qor1contract";
const SENDER = "qor1sender";
const FEE = { amount: [{ denom: "uqor", amount: "1000" }], gas: "200000" };

describe("CosmWasm read wrappers", () => {
  it("queryContractSmart forwards address + query and returns the result", async () => {
    const client = {
      queryContractSmart: vi.fn(async () => ({ count: 7 })),
    } as unknown as CosmWasmReadClient;
    const res = await queryContractSmart(client, CONTRACT, { get_count: {} });
    expect(client.queryContractSmart).toHaveBeenCalledWith(CONTRACT, {
      get_count: {},
    });
    expect(res).toEqual({ count: 7 });
  });

  it("getContractInfo forwards the address and returns contract metadata", async () => {
    const info = { address: CONTRACT, codeId: 3, creator: "qor1c", admin: undefined };
    const client = {
      getContract: vi.fn(async () => info),
    } as unknown as CosmWasmReadClient;
    const res = await getContractInfo(client, CONTRACT);
    expect(client.getContract).toHaveBeenCalledWith(CONTRACT);
    expect(res).toBe(info);
  });
});

describe("CosmWasm signing wrappers", () => {
  it("instantiate forwards args and threads opts.fee + funds/admin/memo", async () => {
    const result = { contractAddress: "qor1new", transactionHash: "ABC" };
    const client = {
      instantiate: vi.fn(async () => result),
    } as unknown as CosmWasmSigningClient;
    const funds = [{ denom: "uqor", amount: "5" }];
    const res = await instantiate(client, SENDER, 9, { init: true }, "my-label", {
      fee: FEE,
      funds,
      admin: "qor1admin",
      memo: "hello",
    });
    expect(client.instantiate).toHaveBeenCalledWith(
      SENDER,
      9,
      { init: true },
      "my-label",
      FEE,
      { funds, admin: "qor1admin", memo: "hello" },
    );
    expect(res).toBe(result);
  });

  it("instantiate defaults fee to auto when no opts given", async () => {
    const client = {
      instantiate: vi.fn(async () => ({ contractAddress: "qor1new" })),
    } as unknown as CosmWasmSigningClient;
    await instantiate(client, SENDER, 9, { init: true }, "my-label");
    expect(client.instantiate).toHaveBeenCalledWith(
      SENDER,
      9,
      { init: true },
      "my-label",
      "auto",
      {},
    );
  });

  it("execute forwards address, msg, fee, and funds", async () => {
    const result = { transactionHash: "DEF" };
    const client = {
      execute: vi.fn(async () => result),
    } as unknown as CosmWasmSigningClient;
    const funds = [{ denom: "uqor", amount: "2" }];
    const res = await execute(client, SENDER, CONTRACT, { bump: {} }, FEE, funds);
    expect(client.execute).toHaveBeenCalledWith(
      SENDER,
      CONTRACT,
      { bump: {} },
      FEE,
      undefined,
      funds,
    );
    expect(res).toBe(result);
  });

  it("uploadCode forwards sender, bytes, and fee", async () => {
    const result = { codeId: 12, transactionHash: "GHI" };
    const client = {
      upload: vi.fn(async () => result),
    } as unknown as CosmWasmSigningClient;
    const bytes = new Uint8Array([0, 1, 2]);
    const res = await uploadCode(client, SENDER, bytes, FEE);
    expect(client.upload).toHaveBeenCalledWith(SENDER, bytes, FEE);
    expect(res).toBe(result);
  });
});
