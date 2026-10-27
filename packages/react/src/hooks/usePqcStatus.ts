/**
 * {@link usePqcStatus} - read an address's PQC key registration state.
 *
 * Built on the SDK's PQC key helpers ({@link getPqcStatus} /
 * {@link isPqcRegistered}), which call `qor_getPQCKeyStatus`. Powers the
 * {@link PqcStatusBadge} component.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getPqcStatus, type PqcStatus } from "@qorechain/sdk";
import { useQoreContext } from "../context";

/** Options for {@link usePqcStatus}. */
export interface UsePqcStatusOptions {
  /** Skip fetching (e.g. while disconnected). Defaults to `false`. */
  enabled?: boolean;
  /**
   * Auto-refresh interval in milliseconds. `0` (default) disables polling; the
   * status is fetched once per address change.
   */
  refreshInterval?: number;
}

/** The shape returned by {@link usePqcStatus}. */
export interface UsePqcStatusResult {
  /** The normalized PQC status, once loaded. */
  data?: PqcStatus;
  /** Whether the address has a registered PQC key (convenience). */
  isRegistered: boolean;
  /** Whether a fetch is in flight. */
  isLoading: boolean;
  /** The last fetch error, if any. */
  error?: Error;
  /** Manually re-fetch the status. */
  refetch(): Promise<void>;
}

/**
 * Read whether `address` (or the connected account when omitted) has a
 * registered PQC (ML-DSA-87) key on QoreChain. Returns
 * `{ data, isRegistered, isLoading, error, refetch }`.
 */
export function usePqcStatus(
  address?: string,
  options: UsePqcStatusOptions = {},
): UsePqcStatusResult {
  const { client, addresses } = useQoreContext();
  const resolvedAddress = address ?? addresses.native ?? addresses.evm;
  const enabled = options.enabled ?? true;
  const refreshInterval = options.refreshInterval ?? 0;

  const [data, setData] = useState<PqcStatus | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // When the request key (client / address / enabled) changes, drop the
  // previous key's result during render, so one address's status is never
  // reported for another - not even for a frame.
  const [key, setKey] = useState({ client, resolvedAddress, enabled });
  if (
    key.client !== client ||
    key.resolvedAddress !== resolvedAddress ||
    key.enabled !== enabled
  ) {
    setKey({ client, resolvedAddress, enabled });
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
  // (an older address) is a no-op when called later.
  const liveRef = useRef<(() => Promise<void>) | null>(null);

  const refetch = useCallback(
    async function fetchPqcStatus(): Promise<void> {
      if (liveRef.current !== fetchPqcStatus) return;
      if (!resolvedAddress || !enabled) return;
      const gen = genRef.current;
      const seq = ++seqRef.current;
      const mayCommit = (): boolean =>
        gen === genRef.current && seq > committedRef.current;
      setIsLoading(true);
      try {
        const status = await getPqcStatus(client, resolvedAddress);
        if (mayCommit()) {
          committedRef.current = seq;
          setData(status);
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
    [client, resolvedAddress, enabled],
  );

  // Declared before the fetch effect so the live refetch is registered before
  // it runs. The cleanup runs on every key change and on unmount.
  useEffect(() => {
    liveRef.current = refetch;
    return () => {
      genRef.current += 1;
      liveRef.current = null;
    };
  }, [refetch, client, resolvedAddress, enabled]);

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

  return {
    data,
    isRegistered: data?.registered ?? false,
    isLoading,
    error,
    refetch,
  };
}
