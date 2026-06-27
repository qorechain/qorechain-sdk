/**
 * {@link useAccount} — the connected wallet's addresses and status.
 */

import { useQoreContext } from "../context";
import type {
  ConnectedAddresses,
  ConnectionStatus,
  ConnectedWalletKind,
} from "../context";

/** The shape returned by {@link useAccount}. */
export interface UseAccountResult {
  /** All connected addresses, by VM family (native / evm / svm). */
  addresses: ConnectedAddresses;
  /** The primary address (native preferred, then evm, then svm), if any. */
  address?: string;
  /** Whether a wallet is connected. */
  isConnected: boolean;
  /** The current connection status. */
  status: ConnectionStatus;
  /** Which wallet is connected, if any. */
  wallet?: ConnectedWalletKind;
}

/**
 * Return the connected account's address(es) — native (bech32), EVM (`0x...`),
 * and/or SVM (base58) — plus a convenience primary `address` and connection
 * status. Empty until a wallet is connected via {@link useConnect}.
 */
export function useAccount(): UseAccountResult {
  const { addresses, status, wallet } = useQoreContext();
  const address = addresses.native ?? addresses.evm ?? addresses.svm;
  return {
    addresses,
    address,
    isConnected: status === "connected" && address !== undefined,
    status,
    wallet,
  };
}
