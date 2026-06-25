/**
 * Faucet request helper.
 *
 * Config-driven: the faucet endpoint comes from the network's `faucetUrl` (or an
 * explicit override), and a clear error is thrown when neither is configured.
 * No public faucet hostname is baked into the SDK — the built-in presets leave
 * `faucetUrl` undefined; apps supply it via a network override or the `faucetUrl`
 * option here. (For the SVM runtime, `@qorechain/svm` exposes `requestAirdrop`.)
 */

import type { FetchLike } from "./query/http";
import type { NetworkConfig } from "./config/networks";

/** Minimal shape consumed by {@link requestFaucet}. */
export interface FaucetConfig {
  /** Faucet base URL. */
  faucetUrl?: string;
}

/** Options for {@link requestFaucet}. */
export interface RequestFaucetOptions {
  /** Override the network's `faucetUrl`. */
  faucetUrl?: string;
  /** Denomination to request (added to the POST body when set). */
  denom?: string;
  /** Injectable `fetch`. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
}

/**
 * Request testnet funds for `address` from the configured faucet.
 *
 * POSTs `{ address, denom? }` as JSON to the faucet URL. Throws a clear error
 * when no faucet URL is configured, and surfaces non-2xx responses.
 *
 * @returns The parsed JSON response (faucet-specific shape), or `undefined` for
 *   an empty body.
 */
export async function requestFaucet<T = unknown>(
  network: FaucetConfig | NetworkConfig,
  address: string,
  options: RequestFaucetOptions = {},
): Promise<T | undefined> {
  const base = options.faucetUrl ?? network.faucetUrl;
  if (!base) {
    throw new Error(
      "faucet URL not configured for this network — set endpoints/faucetUrl",
    );
  }
  const doFetch = options.fetch ?? (globalThis.fetch as FetchLike);
  const body: Record<string, string> = { address };
  if (options.denom !== undefined) body.denom = options.denom;

  const url = base.replace(/\/+$/, "");
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`faucet request failed: HTTP ${res.status} ${text}`.trim());
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : undefined;
}
