/**
 * Block-explorer URL builders.
 *
 * These are config-driven: a URL is produced only when the network's
 * `explorerUrl` is set. No public explorer hostname is baked into the SDK — the
 * built-in presets leave `explorerUrl` undefined, and apps supply it through a
 * network override (e.g. `createClient({ network: { ...getNetwork("mainnet"),
 * explorerUrl: "https://explorer.example" } })`).
 */

import { joinUrl } from "./query/http";
import type { NetworkConfig } from "./config/networks";

/** Minimal shape consumed by the explorer helpers. */
export interface ExplorerConfig {
  /** Explorer base URL (no trailing slash required). */
  explorerUrl?: string;
}

function requireExplorerUrl(network: ExplorerConfig): string {
  if (!network.explorerUrl) {
    throw new Error(
      "explorer URL not configured for this network — set endpoints/explorerUrl",
    );
  }
  return network.explorerUrl;
}

/** Build the explorer URL for a transaction hash. */
export function explorerTxUrl(
  network: ExplorerConfig | NetworkConfig,
  hash: string,
): string {
  return joinUrl(requireExplorerUrl(network), `tx/${hash}`);
}

/** Build the explorer URL for an account/address. */
export function explorerAddressUrl(
  network: ExplorerConfig | NetworkConfig,
  address: string,
): string {
  return joinUrl(requireExplorerUrl(network), `address/${address}`);
}

/** Build the explorer URL for a block height. */
export function explorerBlockUrl(
  network: ExplorerConfig | NetworkConfig,
  height: number | string,
): string {
  return joinUrl(requireExplorerUrl(network), `block/${height}`);
}
