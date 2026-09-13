/**
 * Broadcast-mode definitions and the broadcast result shape for native txs.
 *
 * QoreChain Native nodes accept transactions in three modes:
 * - `sync`  — return after `CheckTx` (mempool admission); you get a tx hash but
 *   not an on-chain result.
 * - `async` — return immediately after submission, without waiting for
 *   `CheckTx`; fire-and-forget.
 * - `commit` — wait until the tx is included in a block; you get the full
 *   delivery result (height, gas used, events). This is the default and is what
 *   cosmjs's `signAndBroadcast` does.
 *
 * cosmjs surfaces only two transport methods: `signAndBroadcast` (poll-to-commit)
 * and `signAndBroadcastSync` (return after `CheckTx`). We map `sync` and `async`
 * onto `signAndBroadcastSync` (both return after submission without polling for a
 * block) and `commit` onto `signAndBroadcast`.
 */

/** Broadcast mode for a signed transaction. */
export type BroadcastMode = "sync" | "async" | "commit";

/**
 * The normalized result of broadcasting a transaction.
 *
 * For `commit` mode all fields are populated from the delivery result. For
 * `sync`/`async` mode only `transactionHash` (and `code = 0`) is known, since
 * the tx has not yet been included in a block.
 */
export interface BroadcastResult {
  /** The transaction hash (uppercase hex). */
  transactionHash: string;
  /**
   * The ABCI result code. `0` means success. For `sync`/`async` this is `0`
   * once the tx is accepted into the mempool (a non-zero `CheckTx` code throws).
   */
  code: number;
  /** Block height the tx was included in (only for `commit`). */
  height?: number;
  /** Gas used by the tx (only for `commit`). */
  gasUsed?: bigint;
  /** Gas wanted by the tx (only for `commit`). */
  gasWanted?: bigint;
  /** Raw ABCI log, when present. */
  rawLog?: string;
  /**
   * The ABCI events emitted by the tx (only for `commit`).
   *
   * Helpers that read typed attributes out of a delivery — e.g. the cross-VM
   * client's message-id extraction — read them from here.
   */
  events?: ReadonlyArray<{
    type: string;
    attributes: ReadonlyArray<{ key: string; value: string }>;
  }>;
  /**
   * The protobuf-encoded `Msg*Response` for each message in the tx, in order
   * (only for `commit`).
   *
   * Each entry is the response's `typeUrl` plus its encoded bytes, so a caller
   * can decode the typed response — e.g. `MsgCrossVMCallResponse` to read a
   * cross-VM callee's return value — without a second round-trip.
   */
  msgResponses?: ReadonlyArray<{ typeUrl: string; value: Uint8Array }>;
}
