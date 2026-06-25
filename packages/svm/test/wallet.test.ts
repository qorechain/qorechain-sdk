import { describe, it, expect, vi, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  getSvmWallet,
  detectSvmProvider,
  type InjectedSvmWallet,
} from "../src/wallet";

const PUBKEY = new PublicKey("11111111111111111111111111111111");

/** A fake Phantom-style injected provider. */
function fakeProvider(overrides: Partial<InjectedSvmWallet> = {}): InjectedSvmWallet & {
  connect: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    isPhantom: true,
    connect: vi.fn(async () => ({ publicKey: PUBKEY })),
    signTransaction: vi.fn(async (tx: unknown) => tx),
    signAllTransactions: vi.fn(async (txs: unknown[]) => txs),
    ...overrides,
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test cleanup
  delete (globalThis as { window?: unknown }).window;
});

describe("getSvmWallet", () => {
  it("connects and returns the adapter (publicKey + signers)", async () => {
    const provider = fakeProvider();
    const wallet = await getSvmWallet({ provider });

    expect(provider.connect).toHaveBeenCalledOnce();
    expect(wallet.publicKey.equals(PUBKEY)).toBe(true);
    expect(wallet.provider).toBe(provider);

    const fakeTx = { id: "tx" } as never;
    await wallet.signTransaction(fakeTx);
    expect(provider.signTransaction).toHaveBeenCalledWith(fakeTx);
  });

  it("passes onlyIfTrusted through to connect", async () => {
    const provider = fakeProvider();
    await getSvmWallet({ provider, onlyIfTrusted: true });
    expect(provider.connect).toHaveBeenCalledWith({ onlyIfTrusted: true });
  });

  it("uses the provider's signAllTransactions when present", async () => {
    const provider = fakeProvider();
    const wallet = await getSvmWallet({ provider });
    const txs = [{ a: 1 }, { b: 2 }] as never[];
    await wallet.signAllTransactions(txs);
    expect(provider.signAllTransactions).toHaveBeenCalledWith(txs);
  });

  it("falls back to sequential signing when signAllTransactions is absent", async () => {
    const provider = fakeProvider({ signAllTransactions: undefined });
    const wallet = await getSvmWallet({ provider });
    const txs = [{ a: 1 }, { b: 2 }] as never[];
    const out = await wallet.signAllTransactions(txs);
    expect(provider.signTransaction).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
  });

  it("falls back to window.solana", async () => {
    const provider = fakeProvider();
    (globalThis as { window?: unknown }).window = { solana: provider };
    const wallet = await getSvmWallet();
    expect(wallet.publicKey.equals(PUBKEY)).toBe(true);
  });

  it("throws when no provider and no window", async () => {
    await expect(getSvmWallet()).rejects.toThrow(/no browser .?window/i);
  });

  it("throws when window has no solana provider", async () => {
    (globalThis as { window?: unknown }).window = {};
    await expect(getSvmWallet()).rejects.toThrow(/no injected Solana/i);
  });

  it("throws when connect returns no public key", async () => {
    const provider = fakeProvider({
      connect: vi.fn(async () => ({ publicKey: null })) as never,
    });
    await expect(getSvmWallet({ provider })).rejects.toThrow(/no public key/i);
  });
});

describe("detectSvmProvider", () => {
  it("returns undefined outside a browser", () => {
    expect(detectSvmProvider()).toBeUndefined();
  });

  it("returns window.solana when present", () => {
    const provider = fakeProvider();
    (globalThis as { window?: unknown }).window = { solana: provider };
    expect(detectSvmProvider()).toBe(provider);
  });
});
