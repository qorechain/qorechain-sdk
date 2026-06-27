/**
 * {@link useTx} — send a transaction and track its status.
 */

import { useCallback, useState } from "react";
import type {
  EncodeObject,
  BroadcastResult,
  TxFeeInput,
  Coin,
} from "@qorechain/sdk";
import { useQoreContext } from "../context";

/** The lifecycle status of a {@link useTx} send. */
export type TxStatus = "idle" | "pending" | "success" | "error";

/** Options for {@link UseTxResult.send}. */
export interface SendOptions {
  /** Fee: an explicit `StdFee` or `"auto"`. Default `"auto"`. */
  fee?: TxFeeInput;
  /** Optional memo. */
  memo?: string;
}

/** The shape returned by {@link useTx}. */
export interface UseTxResult {
  /** Sign + broadcast arbitrary messages with the connected signer. */
  send(messages: EncodeObject[], opts?: SendOptions): Promise<BroadcastResult>;
  /** Convenience: send a bank transfer of `amount` to `toAddress`. */
  sendTokens(
    toAddress: string,
    amount: Coin[],
    opts?: SendOptions,
  ): Promise<BroadcastResult>;
  /** The current send status. */
  status: TxStatus;
  /** The last broadcast result, on success. */
  data?: BroadcastResult;
  /** The last error, on failure. */
  error?: Error;
  /** Whether a send is in flight. */
  isPending: boolean;
  /** Reset status/data/error back to idle. */
  reset(): void;
}

/**
 * Send transactions with the connected signer and track `{ status, data, error }`.
 *
 * Requires a connected wallet that produced a `TxClient` (the Cosmos path of
 * {@link useConnect}). `send` takes raw `{ typeUrl, value }` messages (use the
 * `msg.*` composers from `@qorechain/sdk`); `sendTokens` is a bank-transfer
 * shortcut.
 */
export function useTx(): UseTxResult {
  const { tx } = useQoreContext();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [data, setData] = useState<BroadcastResult | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);

  const requireTx = useCallback(() => {
    if (!tx) {
      throw new Error(
        "useTx: no connected signer. Connect a Cosmos wallet (Keplr/Leap) via useConnect() first.",
      );
    }
    return tx;
  }, [tx]);

  const run = useCallback(
    async (fn: () => Promise<BroadcastResult>): Promise<BroadcastResult> => {
      setStatus("pending");
      setError(undefined);
      try {
        const res = await fn();
        setData(res);
        setStatus("success");
        return res;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
        throw e;
      }
    },
    [],
  );

  const send = useCallback(
    (messages: EncodeObject[], opts: SendOptions = {}) =>
      run(() =>
        requireTx().signAndBroadcast(messages, opts.fee ?? "auto", opts.memo ?? ""),
      ),
    [run, requireTx],
  );

  const sendTokens = useCallback(
    (toAddress: string, amount: Coin[], opts: SendOptions = {}) =>
      run(() =>
        requireTx().bankSend(toAddress, amount, {
          fee: opts.fee ?? "auto",
          memo: opts.memo ?? "",
        }),
      ),
    [run, requireTx],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setData(undefined);
    setError(undefined);
  }, []);

  return {
    send,
    sendTokens,
    status,
    data,
    error,
    isPending: status === "pending",
    reset,
  };
}
