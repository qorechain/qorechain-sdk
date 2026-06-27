/**
 * {@link usePqcStatus} — read an address's quantum-safe (PQC) registration state.
 *
 * Built on the SDK's quantum-safe DX helpers ({@link getPqcStatus} /
 * {@link isPqcRegistered}), which call `qor_getPQCKeyStatus`. Powers the
 * {@link QuantumSafeBadge} component.
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
 * Read whether `address` (or the connected account when omitted) is quantum-safe
 * — i.e. has a registered PQC key on QoreChain. Returns
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
      const status = await getPqcStatus(client, resolvedAddress);
      if (activeRef.current) setData(status);
    } catch (err) {
      if (activeRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (activeRef.current) setIsLoading(false);
    }
  }, [client, resolvedAddress, enabled]);

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
