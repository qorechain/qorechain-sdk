/**
 * Network presets for the QoreChain SDK.
 *
 * - `mainnet` and `testnet` point at the public QoreChain endpoints, listed once
 *   in {@link PUBLIC_ENDPOINTS}. The testnet endpoints carry a per-IP rate limit
 *   at the edge; production traffic should run or use its own node and pass
 *   `endpoints`.
 * - `localnet` keeps the localhost ports of a node on your own machine (this
 *   was the default of every preset before 0.12.0).
 *
 * No preset sets a gRPC endpoint or an SVM endpoint (SVM transactions are not
 * open on either network), and mainnet has no public EVM WebSocket. Code that
 * needs one of those fails with an error naming the endpoint to pass instead of
 * falling back to localhost.
 *
 * `https://download.qore.host/<net>/latest.json` is a manifest (release
 * version, peers, state sync), not an API endpoint.
 */

/** Bech32 human-readable prefixes used across QoreChain address types. */
export interface Bech32Prefixes {
  /** Prefix for account addresses (e.g. `qor1...`). */
  account: string;
  /** Prefix for validator operator addresses (e.g. `qorvaloper1...`). */
  validator: string;
  /** Prefix for validator consensus addresses (e.g. `qorvalcons1...`). */
  consensus: string;
}

/** Display and base denomination metadata for the network's staking coin. */
export interface CoinInfo {
  /** Human-facing denomination (e.g. `QOR`). */
  display: string;
  /** Base (smallest) denomination used on-chain (e.g. `uqor`). */
  base: string;
  /** Decimal exponent relating base to display (1 display = 10^exponent base). */
  exponent: number;
}

/** Service endpoints for talking to a network across its supported VMs. */
export interface NetworkEndpoints {
  /** Native REST (LCD) endpoint. */
  rest: string;
  /** Native gRPC endpoint. Not set by the public presets. */
  grpc?: string;
  /** Consensus RPC endpoint. */
  rpc: string;
  /** EVM JSON-RPC HTTP endpoint. */
  evmRpc: string;
  /** EVM JSON-RPC WebSocket endpoint. Set by `testnet` and `localnet` only. */
  evmWs?: string;
  /** SVM JSON-RPC endpoint. Set by `localnet` only (SVM transactions are not open). */
  svmRpc?: string;
}

/** A fully described network preset. */
export interface NetworkConfig {
  /** Canonical preset name. */
  name: string;
  /** Whether the network is live and usable without custom endpoints. */
  live: boolean;
  /** Chain ID. */
  chainId: string;
  /** EVM chain id (EIP-155), when known for the preset. */
  evmChainId?: number;
  /** Bech32 prefixes for address encoding. */
  bech32: Bech32Prefixes;
  /** Staking coin metadata. */
  coin: CoinInfo;
  /** Default endpoints. */
  endpoints: NetworkEndpoints;
  /**
   * Block-explorer base URL (no trailing slash), used by the `explorer*Url`
   * helpers. Left `undefined` by default for both presets - no public explorer
   * hostname is baked in; apps set this via a network override.
   */
  explorerUrl?: string;
  /**
   * Faucet base URL, used by `requestFaucet`. Left `undefined` by default for
   * both presets - no public faucet hostname is baked in; apps set this via a
   * network override.
   */
  faucetUrl?: string;
}

/** Known network preset names. */
export type NetworkName = "testnet" | "mainnet" | "localnet";

/**
 * QoreChain uses the same token and address prefixes on every network, so these
 * are shared (not invented) values across the presets below.
 */
const BECH32: Bech32Prefixes = {
  account: "qor",
  validator: "qorvaloper",
  consensus: "qorvalcons",
};

const COIN: CoinInfo = {
  display: "QOR",
  base: "uqor",
  exponent: 6,
};

/**
 * The public endpoints of the two networks: the only place their hostnames are
 * written. Endpoints a network does not serve publicly are left out.
 */
export const PUBLIC_ENDPOINTS: Readonly<Record<"mainnet" | "testnet", Readonly<NetworkEndpoints>>> = {
  mainnet: {
    rest: "https://api.qore.host",
    rpc: "https://rpc.qore.host",
    evmRpc: "https://evm.qore.host",
  },
  testnet: {
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host",
    evmWs: "wss://evm-ws-testnet.qore.host",
  },
};

/** The default ports of a node running on this machine (the `localnet` preset). */
export const LOCALNET_ENDPOINTS: Readonly<NetworkEndpoints> = {
  rest: "http://localhost:1317",
  grpc: "http://localhost:9090",
  rpc: "http://localhost:26657",
  evmRpc: "http://localhost:8545",
  evmWs: "ws://localhost:8546",
  svmRpc: "http://localhost:8899",
};

/** The set of built-in network presets, keyed by name. */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    live: true,
    chainId: "qorechain-diana",
    evmChainId: 9800,
    bech32: BECH32,
    coin: COIN,
    endpoints: { ...PUBLIC_ENDPOINTS.testnet },
  },
  mainnet: {
    name: "mainnet",
    live: true,
    chainId: "qorechain-vladi",
    evmChainId: 9801,
    bech32: BECH32,
    coin: COIN,
    endpoints: { ...PUBLIC_ENDPOINTS.mainnet },
  },
  localnet: {
    name: "localnet",
    live: true,
    // The chain id of the core repository's local devnet; pass `chainId` to
    // createClient when your local chain uses another.
    chainId: "qorechain-devnet",
    bech32: BECH32,
    coin: COIN,
    endpoints: { ...LOCALNET_ENDPOINTS },
  },
};

/**
 * Read an endpoint a feature needs, or throw an error that names it.
 *
 * @param network - The resolved network (its `name` is used in the message).
 * @param key - The endpoint the caller needs.
 */
export function requireNetworkEndpoint(
  network: Pick<NetworkConfig, "name" | "endpoints">,
  key: keyof NetworkEndpoints,
): string {
  const value = network.endpoints?.[key];
  if (!value) {
    const svm = key === "svmRpc" ? " SVM transactions are not open on the public networks." : "";
    throw new Error(
      `endpoint "${key}" is not configured for the ${network.name} preset; pass it via ` +
        `createClient({ endpoints: { ${key}: "..." } }) (or use your own node).${svm}`,
    );
  }
  return value;
}

/**
 * Resolve a network preset by name.
 *
 * @returns The requested {@link NetworkConfig}.
 */
export function getNetwork(name: NetworkName): NetworkConfig {
  return NETWORKS[name];
}

/** List the known network preset names without triggering any liveness check. */
export function listNetworks(): NetworkName[] {
  return Object.keys(NETWORKS) as NetworkName[];
}
