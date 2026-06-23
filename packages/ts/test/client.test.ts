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

  it("throws the not-yet-live error for mainnet without endpoints", () => {
    expect(() => createClient({ network: "mainnet" })).toThrow(
      /mainnet is not yet live — pass custom endpoints via createClient\(\{ endpoints \}\)/,
    );
  });

  it("builds a working client for mainnet when endpoints are supplied", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balances: [] }));
    const client = createClient({
      network: "mainnet",
      endpoints: {
        rest: "https://rest.main",
        rpc: "https://rpc.main",
        evmRpc: "https://evm.main",
      },
      chainId: "qorechain-1",
      fetch: fetchMock,
    });
    expect(client.network.name).toBe("mainnet");
    expect(client.network.chainId).toBe("qorechain-1");
    expect(client.network.endpoints?.rest).toBe("https://rest.main");
    await client.rest.getAllBalances("qor1abc");
    expect(calledUrl(fetchMock)).toBe(
      "https://rest.main/cosmos/bank/v1beta1/balances/qor1abc",
    );
  });

  it("leaves mainnet chainId as the metadata value when none supplied", () => {
    const client = createClient({
      network: "mainnet",
      endpoints: {
        rest: "https://rest.main",
        rpc: "https://rpc.main",
        evmRpc: "https://evm.main",
      },
    });
    expect(client.network.chainId).toBeNull();
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

  it("throws an actionable error when a needed endpoint is missing", () => {
    // Mainnet built from only rest+rpc: evmRpc is absent, so evm/qor must throw.
    const client = createClient({
      network: "mainnet",
      endpoints: { rest: "https://rest.main", rpc: "https://rpc.main" },
    });
    expect(() => client.evm).toThrow(/evmRpc/);
    expect(() => client.qor).toThrow(/evmRpc/);
    // rest is present, so it must not throw.
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
