/**
 * Real-time SVM subscriptions over the `@solana/web3.js` `Connection`.
 *
 * The `Connection` owns the websocket and its lifecycle; these helpers are thin
 * wrappers that register a listener and return both the numeric subscription id
 * and an `off()` function that removes it via the matching
 * `remove*Listener` call. This keeps callers from having to remember which
 * removal method pairs with which subscription.
 */

import type {
  AccountChangeCallback,
  Commitment,
  Connection,
  LogsCallback,
  LogsFilter,
  PublicKey,
  SlotChangeCallback,
} from "@solana/web3.js";

/** A registered subscription: its id and a function to remove it. */
export interface SvmSubscription {
  /** The numeric subscription id returned by `@solana/web3.js`. */
  id: number;
  /** Remove the listener (idempotent best-effort). */
  off(): Promise<void>;
}

/**
 * Subscribe to transaction logs matching `filter`.
 *
 * @param connection - A `@solana/web3.js` `Connection`.
 * @param filter - A `LogsFilter` (`"all"`, `"allWithVotes"`, or a `PublicKey`).
 * @param callback - Invoked with each matching logs notification.
 * @param commitment - Optional commitment level.
 */
export function onLogs(
  connection: Connection,
  filter: LogsFilter,
  callback: LogsCallback,
  commitment?: Commitment,
): SvmSubscription {
  const id = connection.onLogs(filter, callback, commitment);
  return {
    id,
    off: () => connection.removeOnLogsListener(id),
  };
}

/**
 * Subscribe to changes of an account's data.
 *
 * @param connection - A `@solana/web3.js` `Connection`.
 * @param pubkey - The account to watch.
 * @param callback - Invoked with each account change.
 * @param commitment - Optional commitment level.
 */
export function onAccountChange(
  connection: Connection,
  pubkey: PublicKey,
  callback: AccountChangeCallback,
  commitment?: Commitment,
): SvmSubscription {
  const id = connection.onAccountChange(pubkey, callback, commitment);
  return {
    id,
    off: () => connection.removeAccountChangeListener(id),
  };
}

/**
 * Subscribe to slot changes (new slots as they are processed).
 *
 * @param connection - A `@solana/web3.js` `Connection`.
 * @param callback - Invoked with each slot change.
 */
export function onSlotChange(
  connection: Connection,
  callback: SlotChangeCallback,
): SvmSubscription {
  const id = connection.onSlotChange(callback);
  return {
    id,
    off: () => connection.removeSlotChangeListener(id),
  };
}
