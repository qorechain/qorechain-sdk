/**
 * EVM browser-wallet integration for QoreChain (MetaMask and any EIP-1193
 * provider, with optional EIP-6963 multi-wallet discovery).
 *
 * Builds a viem `WalletClient` over an injected provider so dApps can request
 * accounts, add/switch the QoreChain EVM network, and sign + send transactions.
 *
 * ```ts
 * import { getEvmWalletClient, addQoreChainNetwork } from "@qorechain/evm";
 * import { getNetwork } from "@qorechain/sdk";
 *
 * await addQoreChainNetwork(window.ethereum, getNetwork("mainnet"));
 * const { walletClient, address } = await getEvmWalletClient();
 * ```
 */

import {
  createWalletClient,
  custom,
  defineChain,
  type Address,
  type Chain,
  type WalletClient,
} from "viem";

/**
 * The minimal EIP-1193 provider surface used here. Declared structurally so no
 * wallet types package is required; `window.ethereum` is structurally
 * compatible.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Window augmentation for the default injected EVM provider. */
interface EthereumWindow {
  ethereum?: Eip1193Provider;
}

/** Subset of a qorechain-sdk network needed to add the EVM chain to a wallet. */
export interface EvmNetworkInfo {
  /** EVM endpoints (`evmRpc`, optional `evmWs`). */
  endpoints: { evmRpc: string; evmWs?: string };
  /** Display coin info (used for the native currency). */
  coin: { display: string };
}

/** Options for {@link getEvmWalletClient}. */
export interface GetEvmWalletClientOptions {
  /** The EIP-1193 provider to use. Defaults to `window.ethereum`. */
  provider?: Eip1193Provider;
  /**
   * Numeric EVM chain id. If omitted, it is auto-detected via `eth_chainId` on
   * the connected provider.
   */
  chainId?: number;
  /** Native currency decimals for the viem chain. Defaults to 18. */
  decimals?: number;
}

/** The result of {@link getEvmWalletClient}. */
export interface EvmWalletConnection {
  /** viem wallet client bound to the connected account and chain. */
  walletClient: WalletClient;
  /** The connected (first) account address. */
  address: Address;
  /** The underlying EIP-1193 provider. */
  provider: Eip1193Provider;
  /** The viem `Chain` object describing the connected network. */
  chain: Chain;
}

/** Resolve the EIP-1193 provider from options or `window`, or throw. */
function resolveProvider(provider?: Eip1193Provider): Eip1193Provider {
  if (provider) return provider;
  if (typeof window === "undefined") {
    throw new Error(
      "EVM wallet: no browser `window` available. Run in a browser, or pass `provider` explicitly.",
    );
  }
  const injected = (window as unknown as EthereumWindow).ethereum;
  if (!injected) {
    throw new Error(
      "EVM wallet: no injected EIP-1193 provider found (window.ethereum). Install MetaMask, or pass `provider`.",
    );
  }
  return injected;
}

/** Convert a numeric chain id to its `0x`-prefixed hex form. */
export function toHexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

/**
 * Request the provider's accounts via `eth_requestAccounts`.
 *
 * @returns The authorized account addresses (the first is the active account).
 */
export async function requestAccounts(
  provider: Eip1193Provider,
): Promise<Address[]> {
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as Address[];
  if (!accounts || accounts.length === 0) {
    throw new Error("EVM wallet: provider returned no accounts");
  }
  return accounts;
}

/**
 * Add the QoreChain EVM network to the wallet via `wallet_addEthereumChain`.
 *
 * The EVM chain id is auto-detected (via `eth_chainId` against the network's
 * `evmRpc`) unless provided. Native currency is QOR with 18 decimals (the EVM
 * convention).
 */
export async function addQoreChainNetwork(
  provider: Eip1193Provider,
  network: EvmNetworkInfo,
  opts: { chainId?: number; blockExplorerUrl?: string } = {},
): Promise<void> {
  const chainId =
    opts.chainId ?? Number(await provider.request({ method: "eth_chainId" }));
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: toHexChainId(chainId),
        chainName:
          network.coin.display === "QOR" ? "QoreChain EVM" : network.coin.display,
        nativeCurrency: {
          name: network.coin.display,
          symbol: network.coin.display,
          decimals: 18,
        },
        rpcUrls: [network.endpoints.evmRpc],
        ...(opts.blockExplorerUrl
          ? { blockExplorerUrls: [opts.blockExplorerUrl] }
          : {}),
      },
    ],
  });
}

/**
 * Switch the wallet to the given EVM chain via `wallet_switchEthereumChain`.
 */
export async function switchChain(
  provider: Eip1193Provider,
  chainId: number,
): Promise<void> {
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: toHexChainId(chainId) }],
  });
}

/**
 * Connect to an injected EVM wallet and return a viem `WalletClient`.
 *
 * Requests accounts (`eth_requestAccounts`), resolves the EVM chain id (supplied
 * or auto-detected), and builds a wallet client over a viem `custom` transport.
 *
 * Browser-only: throws a clear error if no `window` or no injected provider.
 */
export async function getEvmWalletClient(
  opts: GetEvmWalletClientOptions = {},
): Promise<EvmWalletConnection> {
  const provider = resolveProvider(opts.provider);
  const accounts = await requestAccounts(provider);
  const address = accounts[0];

  const chainId =
    opts.chainId ?? Number(await provider.request({ method: "eth_chainId" }));
  const decimals = opts.decimals ?? 18;

  const chain = defineChain({
    id: chainId,
    name: "QoreChain EVM",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals },
    rpcUrls: { default: { http: [] } },
  });

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(provider),
  });

  return { walletClient, address, provider, chain };
}

/** A provider announced via the EIP-6963 discovery protocol. */
export interface Eip6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: Eip1193Provider;
}

/**
 * Discover injected EVM providers via EIP-6963 (`eip6963:requestProvider`).
 *
 * Returns the providers that announce themselves within `timeoutMs` (default
 * 200ms). `window.ethereum` remains the baseline default for the other helpers;
 * use this when you want to let the user pick among multiple installed wallets.
 *
 * Resolves to an empty array outside a browser environment.
 */
export function discoverEvmProviders(
  timeoutMs = 200,
): Promise<Eip6963ProviderDetail[]> {
  if (typeof window === "undefined") return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map<string, Eip6963ProviderDetail>();
    const onAnnounce = (event: Event): void => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (detail?.info?.uuid) found.set(detail.info.uuid, detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener(
        "eip6963:announceProvider",
        onAnnounce as EventListener,
      );
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
