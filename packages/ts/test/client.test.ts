import { describe, it, expect, vi } from "vitest";
import { createClient } from "../src/client";
import { NETWORKS } from "../src/config/networks";
import * as sdk from "../src/index";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>, i = 0): string {
  return fetchMock.mock.calls[i][0] as string;
}

describe("createClient network resolution", () => {
  it("defaults to testnet with the live chain id and endpoints", () => {
    const client = createClient();
    expect(client.network.name).toBe("testnet");
    expect(client.network.chainId).toBe("qorechain-diana");
    expect(client.network.endpoints).toEqual(NETWORKS.testnet.endpoints);
  });

  it("constructs the rest client against the testnet rest endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = createClient({ fetch: fetchMock });
    await client.rest.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "http://localhost:1317/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("constructs the evm and qor clients against the testnet evmRpc endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    );
    const client = createClient({ fetch: fetchMock });
    await client.evm.ethChainId();
    expect(calledUrl(fetchMock)).toBe("http://localhost:8545");
    await client.qor.getAiStats();
    expect(calledUrl(fetchMock, 1)).toBe("http://localhost:8545");
  });

  it("applies a partial endpoint override on testnet", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = createClient({
      endpoints: { rest: "https://rest.example" },
      fetch: fetchMock,
    });
    expect(client.network.endpoints?.rest).toBe("https://rest.example");
    // Non-overridden endpoints keep the testnet defaults.
    expect(client.network.endpoints?.evmRpc).toBe("http://localhost:8545");
    await client.rest.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "https://rest.example/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("builds a working mainnet client with localhost defaults", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = createClient({ network: "mainnet", fetch: fetchMock });
    expect(client.network.name).toBe("mainnet");
    expect(client.network.chainId).toBe("qorechain-vladi");
    expect(client.network.endpoints).toEqual(NETWORKS.mainnet.endpoints);
    await client.rest.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "http://localhost:1317/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("builds a working client for mainnet with custom endpoints", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = createClient({
      network: "mainnet",
      endpoints: {
        rest: "https://rest.main",
        rpc: "https://rpc.main",
        evmRpc: "https://evm.main",
      },
      fetch: fetchMock,
    });
    expect(client.network.name).toBe("mainnet");
    expect(client.network.chainId).toBe("qorechain-vladi");
    expect(client.network.endpoints?.rest).toBe("https://rest.main");
    await client.rest.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "https://rest.main/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("keeps the mainnet preset chain id when none is supplied", () => {
    const client = createClient({ network: "mainnet" });
    expect(client.network.chainId).toBe("qorechain-vladi");
  });

  it("applies a chainId override", () => {
    const client = createClient({ network: "mainnet", chainId: "qorechain-1" });
    expect(client.network.chainId).toBe("qorechain-1");
  });
});

describe("createClient sub-clients and fees", () => {
  it("fees.estimate calls the fee-estimate endpoint with the urgency", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ suggested_fee_uqor: "1200" }),
    );
    const client = createClient({ fetch: fetchMock });
    const fee = await client.fees.estimate("fast");
    expect(calledUrl(fetchMock)).toBe(
      "http://localhost:1317/qorechain/ai/v1/fee-estimate?urgency=fast",
    );
    expect(fee.amount).toEqual([{ denom: "uqor", amount: "1200" }]);
  });

  it("crossvm.message hits the crossvm message path via the rest client", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: { id: "5" } }));
    const client = createClient({ fetch: fetchMock });
    await client.crossvm.message("5");
    expect(calledUrl(fetchMock)).toBe(
      "http://localhost:1317/qorechain/crossvm/v1/message/5",
    );
  });

  it("crossvm.pending and crossvm.params hit their paths", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = createClient({ fetch: fetchMock });
    await client.crossvm.pending();
    expect(calledUrl(fetchMock, 0)).toBe(
      "http://localhost:1317/qorechain/crossvm/v1/pending",
    );
    await client.crossvm.params();
    expect(calledUrl(fetchMock, 1)).toBe(
      "http://localhost:1317/qorechain/crossvm/v1/params",
    );
  });

  it("cosmwasm() memoizes a single read client and requires the rpc endpoint", async () => {
    const connectSpy = vi
      .spyOn(
        await import("@cosmjs/cosmwasm-stargate").then((m) => m.CosmWasmClient),
        "connect",
      )
      .mockResolvedValue({} as never);
    const client = createClient();
    const a = await client.cosmwasm();
    const b = await client.cosmwasm();
    expect(a).toBe(b);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith("http://localhost:26657");
    connectSpy.mockRestore();
  });

  it("throws an actionable error when a needed endpoint is missing", () => {
    // Explicitly blanking evmRpc leaves evm/qor without an endpoint, so they throw.
    const client = createClient({
      network: "mainnet",
      endpoints: { evmRpc: "" },
    });
    expect(() => client.evm).toThrow(/evmRpc/);
    expect(() => client.qor).toThrow(/evmRpc/);
    // rest keeps its preset default, so it must not throw.
    expect(() => client.rest).not.toThrow();
  });

  it("exposes the documented public surface from the package root", () => {
    const expected = [
      // factory + version
      "createClient",
      "VERSION",
      // networks
      "getNetwork",
      "listNetworks",
      "NETWORKS",
      // utils
      "toBase",
      "fromBase",
      "isValidBech32",
      // accounts
      "generateMnemonic",
      "validateMnemonic",
      "deriveNativeAccount",
      "deriveEvmAccount",
      "deriveSvmAccount",
      // pqc
      "PqcSigner",
      "HybridSigner",
      "buildHybridSignatureExtension",
      // query clients
      "RestClient",
      "JsonRpcClient",
      "QorClient",
      // cross-VM reads
      "getCrossVmMessage",
      "getPendingCrossVmMessages",
      "getCrossVmParams",
      // cosmwasm
      "createCosmWasmClient",
      "connectCosmWasmSigner",
      "queryContractSmart",
      "getContractInfo",
      "instantiate",
      "execute",
      "uploadCode",
      // tx
      "TxClient",
      "estimateFee",
      "directSignerFromPrivateKey",
      "attachHybridExtension",
    ];
    for (const name of expected) {
      expect(sdk).toHaveProperty(name);
      expect((sdk as Record<string, unknown>)[name]).toBeDefined();
    }
  });

  it("connectTx wires the signer through to TxClient.connect", async () => {
    const connectSpy = vi
      .spyOn(
        (await import("../src/tx/builder")).TxClient,
        "connect",
      )
      .mockResolvedValue({ senderAddress: "qor1abc" } as never);
    const client = createClient();
    const signer = { getAccounts: async () => [] } as never;
    await client.connectTx(signer);
    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rpcEndpoint: "http://localhost:26657", signer }),
    );
    connectSpy.mockRestore();
  });
});
