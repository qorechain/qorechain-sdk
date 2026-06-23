/**
 * Client factory for the QoreChain EVM Engine.
 *
 * This is a thin convenience layer over viem: it builds a viem `Chain` object
 * from the network's EVM endpoints, resolves the numeric EVM chain id (either
 * supplied explicitly or auto-detected via `eth_chainId`), and returns ready-to-
 * use viem public and wallet clients.
 *
 * The numeric EVM chain id for QoreChain networks is intentionally not hardcoded
 * here: it is auto-detected at connect time unless the caller provides it.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

/** Subset of a qorechain-sdk network's endpoints relevant to the EVM Engine. */
export interface EvmEndpoints {
  /** EVM JSON-RPC HTTP endpoint. */
  evmRpc: string;
  /** EVM JSON-RPC WebSocket endpoint (optional). */
  evmWs?: string;
}

/** Options for {@link createEvmClient}. */
export interface CreateEvmClientOptions {
  /** EVM JSON-RPC HTTP URL. Mutually exclusive with `endpoints`. */
  rpcUrl?: string;
  /** EVM JSON-RPC WebSocket URL. */
  wsUrl?: string;
  /** A qorechain-sdk network endpoints object (uses `evmRpc`/`evmWs`). */
  endpoints?: EvmEndpoints;
  /**
   * Numeric EVM chain id. If omitted, it is auto-detected via `eth_chainId`.
   *
   * The canonical chain id for QoreChain networks is not pinned in this package
   * on purpose — always detect it, or pass it explicitly here.
   */
  chainId?: number;
  /**
   * Native currency decimals for EVM display. Defaults to 18 (the EVM
   * convention). Note: this is the EVM-side representation of QOR and is
   * distinct from the Cosmos `uqor` base denomination (10^6). Confirm the
   * canonical wrapped/native EVM decimals against your target node.
   */
  decimals?: number;
  /**
   * Custom viem transport. When provided it is used instead of an HTTP
   * transport built from the resolved RPC URL — primarily for testing.
   */
  transport?: Transport;
}

/** A configured QoreChain EVM client bundle. */
export interface EvmClient {
  /** viem public (read) client bound to the resolved chain + transport. */
  publicClient: PublicClient;
  /** Build a viem wallet (write) client for the given account. */
  getWalletClient: (account: Account) => WalletClient;
  /** The viem `Chain` object describing the connected network. */
  chain: Chain;
  /** Return the resolved numeric EVM chain id. */
  getChainId: () => Promise<number>;
}

function resolveRpcUrl(opts: CreateEvmClientOptions): string {
  const url = opts.rpcUrl ?? opts.endpoints?.evmRpc;
  if (!url) {
    throw new Error("createEvmClient: provide `rpcUrl` or `endpoints.evmRpc`");
  }
  return url;
}

function resolveWsUrl(opts: CreateEvmClientOptions): string | undefined {
  return opts.wsUrl ?? opts.endpoints?.evmWs;
}

/**
 * Create a QoreChain EVM client bundle.
 *
 * Auto-detects the EVM chain id via `eth_chainId` unless `chainId` is supplied.
 */
export async function createEvmClient(
  opts: CreateEvmClientOptions,
): Promise<EvmClient> {
  const rpcUrl = resolveRpcUrl(opts);
  const wsUrl = resolveWsUrl(opts);
  const transport: Transport = opts.transport ?? http(rpcUrl);
  const decimals = opts.decimals ?? 18;

  let chainId = opts.chainId;
  if (chainId === undefined) {
    // Auto-detect via a transient public client (no chain bound yet).
    const probe = createPublicClient({ transport });
    chainId = await probe.getChainId();
  }

  const chain = defineChain({
    id: chainId,
    name: "QoreChain EVM",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals },
    rpcUrls: {
      default: {
        http: [rpcUrl],
        ...(wsUrl ? { webSocket: [wsUrl] } : {}),
      },
    },
  });

  const publicClient = createPublicClient({ chain, transport });

  const getWalletClient = (account: Account): WalletClient =>
    createWalletClient({ account, chain, transport });

  return {
    publicClient,
    getWalletClient,
    chain,
    getChainId: async () => chainId,
  };
}
