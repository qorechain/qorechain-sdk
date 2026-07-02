/**
 * Cosmos browser-wallet integration for QoreChain (Keplr and Leap).
 *
 * Keplr and Leap inject the same API shape under `window.keplr` / `window.leap`,
 * so this module targets both through a light structural interface — it does not
 * take a hard dependency on `@keplr-wallet/types`.
 *
 * The typical flow:
 *
 * ```ts
 * import { getCosmosWallet } from "@qorechain/sdk";
 * import { getNetwork, TxClient } from "@qorechain/sdk";
 *
 * const network = getNetwork("mainnet");
 * const { signer } = await getCosmosWallet({ wallet: "keplr", network });
 * const tx = await TxClient.connect({ rpcEndpoint: network.endpoints.rpc, signer });
 * // `signer` plugs straight into TxClient and can carry any registered message
 * // (standard Cosmos + QoreChain custom) via DIRECT signing.
 * ```
 */

import type { OfflineSigner } from "@cosmjs/proto-signing";
import type { NetworkConfig } from "../config/networks";

/** Supported Cosmos wallet providers (same injected API shape). */
export type CosmosWalletName = "keplr" | "leap";

/**
 * A bech32 address config for a single account type, matching the shape Keplr
 * and Leap expect in {@link KeplrChainInfo.bech32Config}.
 */
export interface Bech32Config {
  bech32PrefixAccAddr: string;
  bech32PrefixAccPub: string;
  bech32PrefixValAddr: string;
  bech32PrefixValPub: string;
  bech32PrefixConsAddr: string;
  bech32PrefixConsPub: string;
}

/** A currency descriptor in a {@link KeplrChainInfo}. */
export interface KeplrCurrency {
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  coinGeckoId?: string;
}

/** A fee currency, i.e. a {@link KeplrCurrency} with optional gas price steps. */
export interface KeplrFeeCurrency extends KeplrCurrency {
  gasPriceStep?: { low: number; average: number; high: number };
}

/**
 * The subset of Keplr/Leap's `ChainInfo` that {@link suggestChainInfo} produces.
 * Kept structural so apps don't need `@keplr-wallet/types` installed.
 */
export interface KeplrChainInfo {
  chainId: string;
  chainName: string;
  rpc: string;
  rest: string;
  bip44: { coinType: number };
  bech32Config: Bech32Config;
  currencies: KeplrCurrency[];
  feeCurrencies: KeplrFeeCurrency[];
  stakeCurrency: KeplrCurrency;
  features?: string[];
}

/**
 * The minimal injected-wallet surface this module uses. Both Keplr and Leap
 * implement (at least) these methods. Declared structurally so no wallet types
 * package is required; apps that have `@keplr-wallet/types` can pass a real
 * `Keplr` here — it is structurally compatible.
 */
export interface InjectedCosmosWallet {
  experimentalSuggestChain(chainInfo: KeplrChainInfo): Promise<void>;
  enable(chainIds: string | string[]): Promise<void>;
  getOfflineSigner(chainId: string): OfflineSigner;
  getOfflineSignerAuto(chainId: string): Promise<OfflineSigner>;
}

/** Window augmentation for the injected Cosmos wallets. */
interface CosmosWalletWindow {
  keplr?: InjectedCosmosWallet;
  leap?: InjectedCosmosWallet;
}

/** Options for {@link getCosmosWallet}. */
export interface GetCosmosWalletOptions {
  /** Which injected wallet to use. Defaults to `"keplr"`. */
  wallet?: CosmosWalletName;
  /** The QoreChain network to connect to. */
  network: NetworkConfig;
  /**
   * Provide the injected wallet object directly instead of reading it off
   * `window` — primarily for testing or non-browser embedding.
   */
  provider?: InjectedCosmosWallet;
  /**
   * Use Amino signing (`getOfflineSigner` Amino path) instead of the auto
   * signer. Defaults to `false` — `getOfflineSignerAuto` is used, which picks
   * DIRECT (preferred; required for QoreChain custom messages) or Amino.
   */
  preferAmino?: boolean;
}

/** The result of a successful {@link getCosmosWallet} connection. */
export interface CosmosWalletConnection {
  /** The CosmJS offline signer. Plugs into `TxClient.connect`. */
  signer: OfflineSigner;
  /** The accounts exposed by the wallet for this chain. */
  accounts: readonly { address: string; pubkey: Uint8Array }[];
  /** Which wallet was connected. */
  wallet: CosmosWalletName;
  /** The connected chain id. */
  chainId: string;
}

/**
 * Build a Keplr/Leap `ChainInfo` object from a QoreChain {@link NetworkConfig}.
 *
 * Pass the result to a wallet's `experimentalSuggestChain` so the wallet learns
 * about the chain (Keplr and Leap require this for non-registry chains). It is
 * exported so apps can call `experimentalSuggestChain(suggestChainInfo(network))`
 * directly if they manage the connection themselves.
 */
export function suggestChainInfo(network: NetworkConfig): KeplrChainInfo {
  const { bech32, coin, endpoints, chainId } = network;
  const currency: KeplrCurrency = {
    coinDenom: coin.display,
    coinMinimalDenom: coin.base,
    coinDecimals: coin.exponent,
  };
  const feeCurrency: KeplrFeeCurrency = {
    ...currency,
    gasPriceStep: { low: 0.1, average: 0.15, high: 0.25 },
  };

  return {
    chainId,
    chainName: network.name === "mainnet" ? "QoreChain" : "QoreChain Testnet",
    rpc: endpoints.rpc,
    rest: endpoints.rest,
    bip44: { coinType: 118 },
    bech32Config: {
      bech32PrefixAccAddr: bech32.account,
      bech32PrefixAccPub: `${bech32.account}pub`,
      bech32PrefixValAddr: bech32.validator,
      bech32PrefixValPub: `${bech32.validator}pub`,
      bech32PrefixConsAddr: bech32.consensus,
      bech32PrefixConsPub: `${bech32.consensus}pub`,
    },
    currencies: [currency],
    feeCurrencies: [feeCurrency],
    stakeCurrency: currency,
    features: ["ibc-transfer", "ibc-go"],
  };
}

/** Resolve the injected wallet from options or `window`, or throw. */
function resolveProvider(
  opts: GetCosmosWalletOptions,
): { provider: InjectedCosmosWallet; name: CosmosWalletName } {
  const name = opts.wallet ?? "keplr";
  if (opts.provider) return { provider: opts.provider, name };

  if (typeof window === "undefined") {
    throw new Error(
      "getCosmosWallet: no browser `window` available. Run in a browser, or pass `provider` explicitly.",
    );
  }
  const injected = (window as unknown as CosmosWalletWindow)[name];
  if (!injected) {
    throw new Error(
      `getCosmosWallet: ${name} wallet not found. Install the ${name} extension, or pass \`provider\`.`,
    );
  }
  return { provider: injected, name };
}

/**
 * Detect a Keplr/Leap wallet, register the QoreChain network with it, enable it,
 * and return a CosmJS {@link OfflineSigner} plus the connected accounts.
 *
 * The returned `signer` plugs straight into
 * `TxClient.connect(network.endpoints.rpc, signer)` and can send any registered
 * message — standard Cosmos *and* QoreChain custom messages — via DIRECT mode,
 * which both Keplr and Leap support. (Amino mode covers standard messages only
 * until custom-module Amino converters land; see `TxClient` `aminoTypes`.)
 *
 * Browser-only: throws a clear error if no `window` or no injected provider.
 */
export async function getCosmosWallet(
  opts: GetCosmosWalletOptions,
): Promise<CosmosWalletConnection> {
  const { provider, name } = resolveProvider(opts);
  const { chainId } = opts.network;

  await provider.experimentalSuggestChain(suggestChainInfo(opts.network));
  await provider.enable(chainId);

  const signer = opts.preferAmino
    ? provider.getOfflineSigner(chainId)
    : await provider.getOfflineSignerAuto(chainId);

  const accounts = await signer.getAccounts();

  return { signer, accounts, wallet: name, chainId };
}
