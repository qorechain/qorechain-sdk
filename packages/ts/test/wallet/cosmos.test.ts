import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getCosmosWallet,
  suggestChainInfo,
  type InjectedCosmosWallet,
} from "../../src/wallet/cosmos";
import { getNetwork } from "../../src/config/networks";

const TESTNET = getNetwork("testnet");
const MAINNET = getNetwork("mainnet");

const FAKE_ACCOUNT = {
  address: "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu",
  pubkey: new Uint8Array([1, 2, 3]),
  algo: "secp256k1" as const,
};

/** A fake injected wallet (Keplr/Leap shape) capturing calls. */
function fakeWallet(): InjectedCosmosWallet & {
  experimentalSuggestChain: ReturnType<typeof vi.fn>;
  enable: ReturnType<typeof vi.fn>;
  getOfflineSignerAuto: ReturnType<typeof vi.fn>;
  getOfflineSigner: ReturnType<typeof vi.fn>;
} {
  const signer = {
    getAccounts: vi.fn(async () => [FAKE_ACCOUNT]),
    signDirect: vi.fn(),
  };
  return {
    experimentalSuggestChain: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    getOfflineSignerAuto: vi.fn(async () => signer),
    getOfflineSigner: vi.fn(() => signer),
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up any window stub.
  // @ts-expect-error test cleanup
  delete (globalThis as { window?: unknown }).window;
});

describe("suggestChainInfo", () => {
  it("produces correct chainId, bech32Config and currencies for testnet", () => {
    const info = suggestChainInfo(TESTNET);
    expect(info.chainId).toBe("qorechain-diana");
    expect(info.rpc).toBe(TESTNET.endpoints.rpc);
    expect(info.rest).toBe(TESTNET.endpoints.rest);
    expect(info.bip44.coinType).toBe(118);
    expect(info.bech32Config).toMatchObject({
      bech32PrefixAccAddr: "qor",
      bech32PrefixValAddr: "qorvaloper",
      bech32PrefixConsAddr: "qorvalcons",
      bech32PrefixAccPub: "qorpub",
    });
    expect(info.currencies[0]).toMatchObject({
      coinDenom: "QOR",
      coinMinimalDenom: "uqor",
      coinDecimals: 6,
    });
    expect(info.feeCurrencies[0].gasPriceStep).toBeDefined();
    expect(info.stakeCurrency.coinMinimalDenom).toBe("uqor");
  });

  it("produces the mainnet chainId", () => {
    expect(suggestChainInfo(MAINNET).chainId).toBe("qorechain-vladi");
  });
});

describe("getCosmosWallet", () => {
  it("suggests the chain, enables it, and returns the signer + accounts", async () => {
    const wallet = fakeWallet();
    const conn = await getCosmosWallet({ network: MAINNET, provider: wallet });

    expect(wallet.experimentalSuggestChain).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "qorechain-vladi" }),
    );
    expect(wallet.enable).toHaveBeenCalledWith("qorechain-vladi");
    expect(wallet.getOfflineSignerAuto).toHaveBeenCalledWith("qorechain-vladi");

    expect(conn.wallet).toBe("keplr");
    expect(conn.chainId).toBe("qorechain-vladi");
    expect(conn.accounts).toEqual([FAKE_ACCOUNT]);
    expect(conn.signer).toBe(await wallet.getOfflineSignerAuto.mock.results[0].value);
  });

  it("uses the Amino signer when preferAmino is set", async () => {
    const wallet = fakeWallet();
    await getCosmosWallet({
      network: TESTNET,
      provider: wallet,
      preferAmino: true,
    });
    expect(wallet.getOfflineSigner).toHaveBeenCalledWith("qorechain-diana");
    expect(wallet.getOfflineSignerAuto).not.toHaveBeenCalled();
  });

  it("reads window.leap when wallet is leap", async () => {
    const wallet = fakeWallet();
    (globalThis as { window?: unknown }).window = { leap: wallet };
    const conn = await getCosmosWallet({ network: TESTNET, wallet: "leap" });
    expect(conn.wallet).toBe("leap");
    expect(wallet.enable).toHaveBeenCalledWith("qorechain-diana");
  });

  it("throws a clear error when no provider and no window", async () => {
    await expect(getCosmosWallet({ network: TESTNET })).rejects.toThrow(
      /no browser .?window/i,
    );
  });

  it("throws when the named wallet is not injected", async () => {
    (globalThis as { window?: unknown }).window = {};
    await expect(
      getCosmosWallet({ network: TESTNET, wallet: "keplr" }),
    ).rejects.toThrow(/keplr wallet not found/i);
  });
});
