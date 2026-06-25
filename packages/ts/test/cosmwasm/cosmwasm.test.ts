import { describe, it, expect, vi } from "vitest";
import {
  queryContractSmart,
  getContractInfo,
  instantiate,
  execute,
  uploadCode,
  instantiate2,
  migrate,
  updateAdmin,
  clearAdmin,
  getCodes,
  getContracts,
  getCodeDetails,
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

describe("CosmWasm lifecycle wrappers", () => {
  it("instantiate2 forwards salt + threads opts", async () => {
    const result = { contractAddress: "qor1predict", transactionHash: "I2" };
    const client = {
      instantiate2: vi.fn(async () => result),
    } as unknown as CosmWasmSigningClient;
    const salt = new Uint8Array([9, 9, 9]);
    const funds = [{ denom: "uqor", amount: "1" }];
    const res = await instantiate2(client, SENDER, 4, salt, { init: true }, "lbl", {
      fee: FEE,
      funds,
      admin: "qor1admin",
    });
    expect(client.instantiate2).toHaveBeenCalledWith(
      SENDER,
      4,
      salt,
      { init: true },
      "lbl",
      FEE,
      { funds, admin: "qor1admin" },
    );
    expect(res).toBe(result);
  });

  it("instantiate2 defaults fee to auto", async () => {
    const client = {
      instantiate2: vi.fn(async () => ({ contractAddress: "qor1x" })),
    } as unknown as CosmWasmSigningClient;
    const salt = new Uint8Array([1]);
    await instantiate2(client, SENDER, 4, salt, {}, "lbl");
    expect(client.instantiate2).toHaveBeenCalledWith(
      SENDER,
      4,
      salt,
      {},
      "lbl",
      "auto",
      {},
    );
  });

  it("migrate forwards contract, codeId, msg, fee, memo", async () => {
    const result = { transactionHash: "M1" };
    const client = {
      migrate: vi.fn(async () => result),
    } as unknown as CosmWasmSigningClient;
    const res = await migrate(client, SENDER, CONTRACT, 12, { migrate: {} }, FEE, "bump");
    expect(client.migrate).toHaveBeenCalledWith(
      SENDER,
      CONTRACT,
      12,
      { migrate: {} },
      FEE,
      "bump",
    );
    expect(res).toBe(result);
  });

  it("updateAdmin forwards the new admin", async () => {
    const client = {
      updateAdmin: vi.fn(async () => ({ transactionHash: "U1" })),
    } as unknown as CosmWasmSigningClient;
    await updateAdmin(client, SENDER, CONTRACT, "qor1newadmin", FEE);
    expect(client.updateAdmin).toHaveBeenCalledWith(
      SENDER,
      CONTRACT,
      "qor1newadmin",
      FEE,
      undefined,
    );
  });

  it("clearAdmin forwards sender + contract", async () => {
    const client = {
      clearAdmin: vi.fn(async () => ({ transactionHash: "C1" })),
    } as unknown as CosmWasmSigningClient;
    await clearAdmin(client, SENDER, CONTRACT, FEE);
    expect(client.clearAdmin).toHaveBeenCalledWith(SENDER, CONTRACT, FEE, undefined);
  });
});

describe("CosmWasm read lifecycle helpers", () => {
  it("getCodes lists code metadata", async () => {
    const codes = [{ id: 1 }, { id: 2 }];
    const client = { getCodes: vi.fn(async () => codes) } as unknown as CosmWasmReadClient;
    expect(await getCodes(client)).toBe(codes);
    expect(client.getCodes).toHaveBeenCalledWith();
  });

  it("getContracts lists contracts for a code id", async () => {
    const client = {
      getContracts: vi.fn(async () => ["qor1a", "qor1b"]),
    } as unknown as CosmWasmReadClient;
    expect(await getContracts(client, 7)).toEqual(["qor1a", "qor1b"]);
    expect(client.getContracts).toHaveBeenCalledWith(7);
  });

  it("getCodeDetails fetches details for a code id", async () => {
    const details = { id: 7, checksum: "abc" };
    const client = {
      getCodeDetails: vi.fn(async () => details),
    } as unknown as CosmWasmReadClient;
    expect(await getCodeDetails(client, 7)).toBe(details);
    expect(client.getCodeDetails).toHaveBeenCalledWith(7);
  });
});
