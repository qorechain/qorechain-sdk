/**
 * SVM browser-wallet integration for QoreChain (Phantom and Wallet-Standard).
 *
 * Adapts an injected Solana provider (Phantom's `window.solana` is the baseline)
 * into a shape usable with `@solana/web3.js`, so apps can sign and send via the
 * existing SVM client.
 *
 * ```ts
 * import { getSvmWallet } from "@qorechain/svm";
 * import { createSvmClient } from "@qorechain/svm";
 *
 * const wallet = await getSvmWallet();
 * const signed = await wallet.signTransaction(tx);
 * // ...then send with createSvmClient(...).sendRawTransaction(...)
 * ```
 */

import type { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/** A transaction the wallet can sign (legacy or versioned). */
export type SvmSignableTransaction = Transaction | VersionedTransaction;

/**
 * The minimal injected Solana-wallet surface used here. Phantom (and most
 * Wallet-Standard providers) implement at least these. Declared structurally so
 * no wallet types package is required.
 */
export interface InjectedSvmWallet {
  /** Phantom marker; present on the Phantom provider. */
  isPhantom?: boolean;
  /** Connect and return the account public key. */
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  /** Disconnect the wallet. */
  disconnect?(): Promise<void>;
  /** The connected account public key (populated after `connect`). */
  publicKey?: PublicKey | null;
  /** Sign a single transaction. */
  signTransaction<T extends SvmSignableTransaction>(tx: T): Promise<T>;
  /** Sign multiple transactions. */
  signAllTransactions?<T extends SvmSignableTransaction>(txs: T[]): Promise<T[]>;
}

/** Window augmentation for the default injected Solana provider. */
interface SolanaWindow {
  solana?: InjectedSvmWallet;
}

/** Options for {@link getSvmWallet}. */
export interface GetSvmWalletOptions {
  /** The injected provider to use. Defaults to `window.solana` (Phantom). */
  provider?: InjectedSvmWallet;
  /** Pass through to the provider's `connect` (e.g. silent reconnect). */
  onlyIfTrusted?: boolean;
}

/**
 * A connected SVM wallet adapted for use with `@solana/web3.js`.
 *
 * `signTransaction` / `signAllTransactions` accept and return web3.js
 * `Transaction` / `VersionedTransaction` objects, so they drop into the existing
 * SVM client's send path.
 */
export interface SvmWalletConnection {
  /** The connected account public key. */
  publicKey: PublicKey;
  /** Sign a single transaction. */
  signTransaction<T extends SvmSignableTransaction>(tx: T): Promise<T>;
  /** Sign multiple transactions (falls back to sequential signing). */
  signAllTransactions<T extends SvmSignableTransaction>(txs: T[]): Promise<T[]>;
  /** The underlying injected provider. */
  provider: InjectedSvmWallet;
}

/** Resolve the injected Solana provider from options or `window`, or throw. */
function resolveProvider(provider?: InjectedSvmWallet): InjectedSvmWallet {
  if (provider) return provider;
  if (typeof window === "undefined") {
    throw new Error(
      "getSvmWallet: no browser `window` available. Run in a browser, or pass `provider` explicitly.",
    );
  }
  const injected = (window as unknown as SolanaWindow).solana;
  if (!injected) {
    throw new Error(
      "getSvmWallet: no injected Solana provider found (window.solana). Install Phantom, or pass `provider`.",
    );
  }
  return injected;
}

/**
 * Connect to an injected Solana wallet (Phantom by default) and return an
 * adapter usable with `@solana/web3.js`.
 *
 * Browser-only: throws a clear error if no `window` or no injected provider.
 */
export async function getSvmWallet(
  opts: GetSvmWalletOptions = {},
): Promise<SvmWalletConnection> {
  const provider = resolveProvider(opts.provider);
  const { publicKey } = await provider.connect(
    opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined,
  );
  if (!publicKey) {
    throw new Error("getSvmWallet: wallet connected but returned no public key");
  }

  const signTransaction = <T extends SvmSignableTransaction>(tx: T): Promise<T> =>
    provider.signTransaction(tx);

  const signAllTransactions = async <T extends SvmSignableTransaction>(
    txs: T[],
  ): Promise<T[]> => {
    if (provider.signAllTransactions) return provider.signAllTransactions(txs);
    // Fall back to signing sequentially for providers without batch support.
    const out: T[] = [];
    for (const tx of txs) out.push(await provider.signTransaction(tx));
    return out;
  };

  return { publicKey, signTransaction, signAllTransactions, provider };
}

/**
 * Detect a Wallet-Standard / Phantom Solana provider on `window`.
 *
 * Returns the injected provider if present, else `undefined`. Phantom's
 * `window.solana` is the baseline; this is a light convenience for apps that
 * want to feature-detect before prompting a connection.
 */
export function detectSvmProvider(): InjectedSvmWallet | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as SolanaWindow).solana;
}
