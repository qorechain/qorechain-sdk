/**
 * {@link useConnect} / {@link useWallet} — multi-wallet connect.
 *
 * Wraps the EXISTING wallet adapters so a component connects with one call and
 * the resolved signer + addresses land in the provider's connection state:
 *  - Keplr / Leap (Cosmos) via `@qorechain/sdk`'s {@link getCosmosWallet}, which
 *    suggests + enables the chain and returns a CosmJS signer; the signer is
 *    connected through `client.connectTx` so `useTx` can sign.
 *  - MetaMask / any EIP-1193 wallet (EVM) via `eth_requestAccounts` on the
 *    injected provider (`window.ethereum` by default).
 *  - Phantom / Wallet-Standard (SVM) via the injected Solana provider
 *    (`window.solana`); returns the connected base58 address.
 *
 * The hook keeps its dependencies light: the EVM and SVM paths talk to the
 * injected provider's standard request API directly, so neither viem nor a
 * Solana SDK is pulled in. For full EVM/SVM tooling, use `@qorechain/evm` /
 * `@qorechain/svm` alongside this hook.
 */

import { useCallback } from "react";
import {
  getCosmosWallet,
  type CosmosWalletName,
} from "@qorechain/sdk";
import { useQoreContext } from "../context";
import type { ConnectedWalletKind } from "../context";

/** A minimal EIP-1193 provider surface (MetaMask et al.). */
export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** A minimal injected Solana provider surface (Phantom / Wallet-Standard). */
export interface SolanaProviderLike {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  publicKey?: { toString(): string } | null;
}

/** Which wallet to connect via {@link UseConnectResult.connect}. */
export type ConnectKind = "keplr" | "leap" | "evm" | "svm";

/** Options for a single {@link UseConnectResult.connect} call. */
export interface ConnectOptions {
  /** Which wallet to connect. Defaults to `"keplr"`. */
  kind?: ConnectKind;
  /**
   * Inject the wallet provider directly instead of reading it off `window`
   * (primarily for tests). The accepted shape depends on `kind`.
   */
  provider?: unknown;
  /** Use Amino signing for the Cosmos path (forwarded to `getCosmosWallet`). */
  preferAmino?: boolean;
}

/** The shape returned by {@link useConnect} / {@link useWallet}. */
export interface UseConnectResult {
  /** Connect a wallet; updates the provider's connection state. */
  connect(opts?: ConnectOptions): Promise<void>;
  /** Disconnect: clears the connection state. */
  disconnect(): void;
  /** The current connection status. */
  status: ReturnType<typeof useQoreContext>["status"];
  /** Whether a connection attempt is in flight. */
  isConnecting: boolean;
  /** The last connection error, if any. */
  error?: Error;
}

function getWindow(): Record<string, unknown> | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as Record<string, unknown>);
}

/**
 * Multi-wallet connect bound to the {@link QoreChainProvider}.
 *
 * On success the provider's connection state holds the resolved addresses, the
 * connected wallet kind, and (for Cosmos) a `TxClient` for signing.
 */
export function useConnect(): UseConnectResult {
  const ctx = useQoreContext();
  const { client, status, error, setConnection } = ctx;

  const connect = useCallback(
    async (opts: ConnectOptions = {}): Promise<void> => {
      const kind: ConnectKind = opts.kind ?? "keplr";
      setConnection({ status: "connecting", addresses: ctx.addresses });

      try {
        if (kind === "keplr" || kind === "leap") {
          const conn = await getCosmosWallet({
            wallet: kind as CosmosWalletName,
            network: client.network,
            provider: opts.provider as never,
            preferAmino: opts.preferAmino,
          });
          const native = conn.accounts[0]?.address;
          const tx = await client.connectTx(conn.signer as never);
          setConnection({
            status: "connected",
            addresses: { native },
            wallet: kind as ConnectedWalletKind,
            tx,
          });
          return;
        }

        if (kind === "evm") {
          const provider = (opts.provider ??
            getWindow()?.ethereum) as Eip1193Like | undefined;
          if (!provider) {
            throw new Error(
              "useConnect(evm): no EIP-1193 provider found (window.ethereum). Install MetaMask, or pass `provider`.",
            );
          }
          const accounts = (await provider.request({
            method: "eth_requestAccounts",
          })) as string[];
          const evm = accounts?.[0];
          if (!evm) throw new Error("useConnect(evm): no account returned");
          setConnection({
            status: "connected",
            addresses: { evm },
            wallet: "evm",
          });
          return;
        }

        // kind === "svm"
        const provider = (opts.provider ??
          getWindow()?.solana) as SolanaProviderLike | undefined;
        if (!provider) {
          throw new Error(
            "useConnect(svm): no Solana / Wallet-Standard provider found (window.solana). Install Phantom, or pass `provider`.",
          );
        }
        const { publicKey } = await provider.connect();
        const svm = publicKey?.toString();
        if (!svm) throw new Error("useConnect(svm): no public key returned");
        setConnection({
          status: "connected",
          addresses: { svm },
          wallet: "svm",
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setConnection({ status: "error", error: e });
        throw e;
      }
    },
    [client, ctx.addresses, setConnection],
  );

  const disconnect = useCallback((): void => {
    setConnection({ status: "disconnected", addresses: {} });
  }, [setConnection]);

  return {
    connect,
    disconnect,
    status,
    isConnecting: status === "connecting",
    error,
  };
}

/** Alias for {@link useConnect} — the multi-wallet connect hook. */
export const useWallet = useConnect;
