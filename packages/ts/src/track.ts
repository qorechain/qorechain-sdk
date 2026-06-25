/**
 * Transaction tracking, broadcast-and-wait, and a transient-error retry helper.
 *
 * After a `sync`/`async` broadcast you hold only a tx hash; the tx is in the
 * mempool but not yet in a block. {@link waitForTx} polls the REST tx endpoint
 * until the tx is included (or a timeout elapses), decoding the result and
 * throwing a typed {@link QoreTxError} if it landed with a non-zero code.
 *
 * {@link broadcastAndWait} chains a `sync` broadcast with {@link waitForTx}.
 * {@link withRetry} retries a function with exponential backoff — useful for
 * wrapping flaky read RPC calls.
 */

import { QoreHttpError } from "./query/http";
import { txErrorFrom } from "./errors";
import { getTx, type GetTxResponse } from "./search";
import type { RestClient } from "./query/rest";

/** A function that fetches a tx by hash; defaults to {@link getTx} over REST. */
export type GetTxFn = (hash: string) => Promise<GetTxResponse>;

/** Options for {@link waitForTx}. */
export interface WaitForTxOptions {
  /** Total time to wait before giving up, in ms. Defaults to 60000. */
  timeoutMs?: number;
  /** Delay between polls, in ms. Defaults to 2000. */
  pollIntervalMs?: number;
}

/** The decoded result of an included transaction. */
export interface IncludedTx {
  /** The transaction hash. */
  txHash: string;
  /** Block height the tx was included in. */
  height: number;
  /** ABCI result code (`0` = success). */
  code: number;
  /** Gas used, when reported. */
  gasUsed?: bigint;
  /** Gas wanted, when reported. */
  gasWanted?: bigint;
  /** Raw ABCI log. */
  rawLog?: string;
  /** The full REST response, for callers that need more. */
  raw: GetTxResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A REST "tx not found yet" error (404 / NotFound code) is expected while polling. */
function isNotFound(err: unknown): boolean {
  if (err instanceof QoreHttpError) {
    if (err.status === 404) return true;
    // gRPC-gateway returns 400/500 with a NotFound code in the body for an
    // unknown hash on some node versions.
    if (err.body && /not\s*found|tx not found|code\s*=\s*5/i.test(err.body)) {
      return true;
    }
  }
  return false;
}

/** Map a REST tx response into the decoded {@link IncludedTx}. */
function toIncludedTx(hash: string, res: GetTxResponse): IncludedTx {
  const r = res.tx_response;
  const code = r?.code ?? 0;
  return {
    txHash: r?.txhash ?? hash,
    height: r?.height ? Number(r.height) : 0,
    code,
    gasUsed: r?.gas_used ? BigInt(r.gas_used) : undefined,
    gasWanted: r?.gas_wanted ? BigInt(r.gas_wanted) : undefined,
    rawLog: r?.raw_log,
    raw: res,
  };
}

/**
 * Poll for a transaction until it is included in a block or the timeout elapses.
 *
 * @param fetcher - A {@link RestClient} (uses {@link getTx}) or a custom
 *   {@link GetTxFn}.
 * @param txHash - The transaction hash to wait for.
 * @param opts - Timeout and poll interval.
 * @returns The decoded {@link IncludedTx} once found.
 * @throws A {@link QoreTxError} if the tx is included with a non-zero code, or a
 *   timeout `Error` if it is not included within `timeoutMs`.
 */
export async function waitForTx(
  fetcher: RestClient | GetTxFn,
  txHash: string,
  opts: WaitForTxOptions = {},
): Promise<IncludedTx> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
  const get: GetTxFn =
    typeof fetcher === "function" ? fetcher : (h) => getTx(fetcher, h);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let res: GetTxResponse | undefined;
    try {
      res = await get(txHash);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    if (res?.tx_response) {
      const included = toIncludedTx(txHash, res);
      if (included.code !== 0) {
        throw txErrorFrom({
          code: included.code,
          codespace: res.tx_response.codespace,
          rawLog: included.rawLog,
          txHash: included.txHash,
        });
      }
      return included;
    }

    if (Date.now() + pollIntervalMs > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for tx ${txHash} to be included`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

/** A broadcaster returning a tx hash (e.g. `TxClient.signAndBroadcast` in sync mode). */
export type SyncBroadcaster = () => Promise<{ transactionHash: string }>;

/**
 * Broadcast (sync) and then wait for inclusion.
 *
 * @param broadcast - A function that submits the tx and resolves to its hash.
 * @param fetcher - A {@link RestClient} or {@link GetTxFn} used to poll.
 * @param opts - {@link WaitForTxOptions}.
 */
export async function broadcastAndWait(
  broadcast: SyncBroadcaster,
  fetcher: RestClient | GetTxFn,
  opts: WaitForTxOptions = {},
): Promise<IncludedTx> {
  const { transactionHash } = await broadcast();
  return waitForTx(fetcher, transactionHash, opts);
}

/** Options for {@link withRetry}. */
export interface RetryOptions {
  /** Number of retries after the first attempt. Defaults to 3. */
  retries?: number;
  /** Initial backoff in ms (doubled each retry). Defaults to 250. */
  backoff?: number;
  /** Maximum backoff in ms. Defaults to 5000. */
  maxBackoff?: number;
  /** Predicate deciding whether an error is retryable. Defaults to retry all. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

/**
 * Run `fn`, retrying on failure with exponential backoff.
 *
 * @param fn - The operation to run (receives the 0-based attempt number).
 * @param opts - Retry count, backoff, and an optional retry predicate.
 * @returns The first successful result.
 * @throws The last error if all attempts fail or `shouldRetry` returns false.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseBackoff = opts.backoff ?? 250;
  const maxBackoff = opts.maxBackoff ?? 5_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err, attempt)) throw err;
      const delay = Math.min(baseBackoff * 2 ** attempt, maxBackoff);
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastError;
}
