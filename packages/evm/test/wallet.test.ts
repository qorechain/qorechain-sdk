import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getEvmWalletClient,
  addQoreChainNetwork,
  switchChain,
  requestAccounts,
  toHexChainId,
  type Eip1193Provider,
} from "../src/wallet";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const NETWORK = {
  endpoints: { evmRpc: "http://node:8545", evmWs: "ws://node:8546" },
  coin: { display: "QOR" },
};

/** A fake EIP-1193 provider whose `request` is a vitest mock. */
function fakeProvider(
  handler: (method: string, params: unknown[]) => unknown,
): Eip1193Provider & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] | object }) =>
    handler(method, (params ?? []) as unknown[]),
  );
  return { request } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup
  delete (globalThis as { window?: unknown }).window;
});

describe("toHexChainId", () => {
  it("hex-encodes a numeric chain id", () => {
    expect(toHexChainId(6699)).toBe("0x1a2b");
  });
});

describe("requestAccounts", () => {
  it("returns accounts via eth_requestAccounts", async () => {
    const provider = fakeProvider((method) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      throw new Error(method);
    });
    expect(await requestAccounts(provider)).toEqual([ADDRESS]);
  });

  it("throws when no accounts are returned", async () => {
    const provider = fakeProvider(() => []);
    await expect(requestAccounts(provider)).rejects.toThrow(/no accounts/i);
  });
});

describe("getEvmWalletClient", () => {
  it("requests accounts and builds a wallet client on the detected chain", async () => {
    const provider = fakeProvider((method) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return "0x1a2b"; // 6699
      throw new Error(method);
    });

    const conn = await getEvmWalletClient({ provider });
    expect(conn.address).toBe(ADDRESS);
    expect(conn.chain.id).toBe(6699);
    expect(conn.walletClient.account?.address).toBe(ADDRESS);
    expect(conn.provider).toBe(provider);
  });

  it("uses an explicit chainId without calling eth_chainId", async () => {
    const provider = fakeProvider((method) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") throw new Error("should not detect");
      throw new Error(method);
    });
    const conn = await getEvmWalletClient({ provider, chainId: 4242 });
    expect(conn.chain.id).toBe(4242);
  });

  it("falls back to window.ethereum", async () => {
    const provider = fakeProvider((method) => {
      if (method === "eth_requestAccounts") return [ADDRESS];
      if (method === "eth_chainId") return "0x1";
      throw new Error(method);
    });
    (globalThis as { window?: unknown }).window = { ethereum: provider };
    const conn = await getEvmWalletClient();
    expect(conn.address).toBe(ADDRESS);
  });

  it("throws when no provider and no window", async () => {
    await expect(getEvmWalletClient()).rejects.toThrow(/no browser .?window/i);
  });

  it("throws when window has no injected provider", async () => {
    (globalThis as { window?: unknown }).window = {};
    await expect(getEvmWalletClient()).rejects.toThrow(/no injected/i);
  });
});

describe("addQoreChainNetwork", () => {
  it("sends wallet_addEthereumChain with the right params", async () => {
    const provider = fakeProvider((method) => {
      if (method === "eth_chainId") return "0x1a2b";
      return undefined;
    });
    await addQoreChainNetwork(provider, NETWORK, {
      blockExplorerUrl: "https://explorer.example",
    });

    const call = provider.request.mock.calls.find(
      (c) => (c[0] as { method: string }).method === "wallet_addEthereumChain",
    );
    expect(call).toBeDefined();
    const param = (call![0] as { params: unknown[] }).params[0] as Record<string, unknown>;
    expect(param.chainId).toBe("0x1a2b");
    expect(param.rpcUrls).toEqual(["http://node:8545"]);
    expect(param.nativeCurrency).toMatchObject({ symbol: "QOR", decimals: 18 });
    expect(param.blockExplorerUrls).toEqual(["https://explorer.example"]);
  });

  it("uses an explicit chainId when provided", async () => {
    const provider = fakeProvider(() => {
      throw new Error("should not call eth_chainId");
    });
    // eth_chainId must not be called; only wallet_addEthereumChain.
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "wallet_addEthereumChain") return undefined;
      throw new Error(method);
    });
    await addQoreChainNetwork(provider, NETWORK, { chainId: 99 });
    const param = (provider.request.mock.calls[0][0] as { params: unknown[] })
      .params[0] as Record<string, unknown>;
    expect(param.chainId).toBe("0x63");
  });
});

describe("switchChain", () => {
  it("sends wallet_switchEthereumChain with hex chain id", async () => {
    const provider = fakeProvider(() => undefined);
    await switchChain(provider, 6699);
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1a2b" }],
    });
  });
});
