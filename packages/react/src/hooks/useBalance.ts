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

  // When the request key (client / address / denom / enabled) changes, drop the
  // previous key's result during render, so the old address's balance or error
  // is never shown for the new one — not even for a frame.
  const [key, setKey] = useState({ client, resolvedAddress, denom, enabled });
  if (
    key.client !== client ||
    key.resolvedAddress !== resolvedAddress ||
    key.denom !== denom ||
    key.enabled !== enabled
  ) {
    setKey({ client, resolvedAddress, denom, enabled });
    setData(undefined);
    setError(undefined);
    setIsLoading(false);
  }

  // Request generations. `genRef` is bumped on every key change and on unmount;
  // a request captures the generation it started in and commits state only if
  // that generation is still current, so a late response for an old address can
  // never overwrite the new one. `seqRef` orders requests within one key, so an
  // older refetch that resolves late cannot overwrite a newer result either.
  const genRef = useRef(0);
  const seqRef = useRef(0);
  const committedRef = useRef(0);
  // The refetch belonging to the live key. A refetch kept from an earlier render
  // (an older address or denom) is a no-op when called later.
  const liveRef = useRef<(() => Promise<void>) | null>(null);

  const refetch = useCallback(
    async function fetchBalance(): Promise<void> {
      if (liveRef.current !== fetchBalance) return;
      if (!resolvedAddress || !enabled) return;
      const gen = genRef.current;
      const seq = ++seqRef.current;
      const mayCommit = (): boolean =>
        gen === genRef.current && seq > committedRef.current;
      setIsLoading(true);
      try {
        const res = await client.rest.getBalance(resolvedAddress, denom);
        if (mayCommit()) {
          committedRef.current = seq;
          setData(res.balance ?? { denom, amount: "0" });
          setError(undefined);
        }
      } catch (err) {
        if (mayCommit()) {
          committedRef.current = seq;
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (gen === genRef.current && seq === seqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [client, resolvedAddress, denom, enabled],
  );

  // Declared before the fetch effect so the live refetch is registered before
  // it runs. The cleanup runs on every key change and on unmount.
  useEffect(() => {
    liveRef.current = refetch;
    return () => {
      genRef.current += 1;
      liveRef.current = null;
    };
  }, [refetch, client, resolvedAddress, denom, enabled]);

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
