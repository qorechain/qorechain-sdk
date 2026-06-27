/**
 * {@link useBalance} — a bank balance with optional auto-refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Coin } from "@qorechain/sdk";
import { useQoreContext } from "../context";

/** Options for {@link useBalance}. */
export interface UseBalanceOptions {
  /**
   * The denom to read. Defaults to the network's base denom (e.g. `uqor`).
   */
  denom?: string;
  /**
   * Auto-refresh interval in milliseconds. `0` (the default) disables polling;
   * the balance is then fetched once on mount / address change.
   */
  refreshInterval?: number;
  /** Skip fetching entirely (e.g. while disconnected). Defaults to `false`. */
  enabled?: boolean;
}

/** The shape returned by {@link useBalance}. */
export interface UseBalanceResult {
  /** The balance coin (`{ denom, amount }`), once loaded. */
  data?: Coin;
  /** Whether a fetch is in flight. */
  isLoading: boolean;
  /** The last fetch error, if any. */
  error?: Error;
  /** Manually re-fetch the balance. */
  refetch(): Promise<void>;
}

/**
 * Read the bank balance of `address` (or the connected account when omitted) in
 * a denom. Re-fetches on address / denom change and, when `refreshInterval > 0`,
 * polls on that interval. Returns `{ data, isLoading, error, refetch }`.
 */
export function useBalance(
  address?: string,
  options: UseBalanceOptions = {},
): UseBalanceResult {
  const { client, addresses } = useQoreContext();
  const resolvedAddress = address ?? addresses.native;
  const denom = options.denom ?? client.network.coin.base;
  const refreshInterval = options.refreshInterval ?? 0;
  const enabled = options.enabled ?? true;

  const [data, setData] = useState<Coin | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Guard against setting state after unmount / stale responses.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    if (!resolvedAddress || !enabled) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const res = await client.rest.getBalance(resolvedAddress, denom);
      if (activeRef.current) {
        setData(res.balance ?? { denom, amount: "0" });
      }
    } catch (err) {
      if (activeRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (activeRef.current) setIsLoading(false);
    }
  }, [client, resolvedAddress, denom, enabled]);

  useEffect(() => {
    void refetch();
    if (refreshInterval > 0 && resolvedAddress && enabled) {
      const id = setInterval(() => {
        void refetch();
      }, refreshInterval);
      return () => clearInterval(id);
    }
    return undefined;
  }, [refetch, refreshInterval, resolvedAddress, enabled]);

  return { data, isLoading, error, refetch };
}
