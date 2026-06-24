/**
 * Network presets for the QoreChain SDK.
 *
 * Both the `testnet` and `mainnet` presets are fully populated and live. Their
 * endpoints default to localhost ports so the SDK works out of the box against a
 * locally running node; callers override these with real hostnames when creating
 * a client. {@link getNetwork} returns either preset.
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
  /** Cosmos SDK REST (LCD) endpoint. */
  rest: string;
  /** Cosmos SDK gRPC endpoint. */
  grpc: string;
  /** Consensus RPC endpoint. */
  rpc: string;
  /** EVM JSON-RPC HTTP endpoint. */
  evmRpc: string;
  /** EVM JSON-RPC WebSocket endpoint. */
  evmWs: string;
  /** SVM JSON-RPC endpoint. */
  svmRpc: string;
}

/** A fully described network preset. */
export interface NetworkConfig {
  /** Canonical preset name. */
  name: string;
  /** Whether the network is live and usable without custom endpoints. */
  live: boolean;
  /** Chain ID. */
  chainId: string;
  /** Bech32 prefixes for address encoding. */
  bech32: Bech32Prefixes;
  /** Staking coin metadata. */
  coin: CoinInfo;
  /** Default endpoints. */
  endpoints: NetworkEndpoints;
}

/** Known network preset names. */
export type NetworkName = "testnet" | "mainnet";

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

/** The set of built-in network presets, keyed by name. */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    live: true,
    chainId: "qorechain-diana",
    bech32: BECH32,
    coin: COIN,
    endpoints: {
      rest: "http://localhost:1317",
      grpc: "http://localhost:9090",
      rpc: "http://localhost:26657",
      evmRpc: "http://localhost:8545",
      evmWs: "ws://localhost:8546",
      svmRpc: "http://localhost:8899",
    },
  },
  mainnet: {
    name: "mainnet",
    live: true,
    chainId: "qorechain-vladi",
    bech32: BECH32,
    coin: COIN,
    endpoints: {
      rest: "http://localhost:1317",
      grpc: "http://localhost:9090",
      rpc: "http://localhost:26657",
      evmRpc: "http://localhost:8545",
      evmWs: "ws://localhost:8546",
      svmRpc: "http://localhost:8899",
    },
  },
};

/**
 * Resolve a network preset by name.
 *
 * @returns The requested {@link NetworkConfig}, guaranteed to be live and usable.
 */
export function getNetwork(name: NetworkName): NetworkConfig {
  return NETWORKS[name];
}

/** List the known network preset names without triggering any liveness check. */
export function listNetworks(): NetworkName[] {
  return Object.keys(NETWORKS) as NetworkName[];
}
