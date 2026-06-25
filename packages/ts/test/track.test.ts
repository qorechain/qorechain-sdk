import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForTx, broadcastAndWait, withRetry } from "../src/track";
import { QoreTxError } from "../src/errors";
import { QoreHttpError } from "../src/query/http";
import type { GetTxResponse } from "../src/search";

const HASH = "ABCDEF";

function included(code = 0, height = "10"): GetTxResponse {
  return {
    tx_response: {
      txhash: HASH,
      height,
      code,
      raw_log: code === 0 ? "" : "boom",
      codespace: code === 0 ? "" : "sdk",
      gas_used: "50000",
      gas_wanted: "80000",
    },
  };
}

describe("waitForTx", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls past not-found errors and resolves on inclusion", async () => {
    const getFn = vi
      .fn<(h: string) => Promise<GetTxResponse>>()
      .mockRejectedValueOnce(new QoreHttpError(404, "/txs/ABCDEF"))
      .mockResolvedValueOnce({}) // present but not yet committed
      .mockResolvedValueOnce(included(0));

    const p = waitForTx(getFn, HASH, { timeoutMs: 60_000, pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    const res = await p;
    expect(res.code).toBe(0);
    expect(res.height).toBe(10);
    expect(res.gasUsed).toBe(50000n);
    expect(getFn).toHaveBeenCalledTimes(3);
  });

  it("throws a typed QoreTxError when included with a non-zero code", async () => {
    const getFn = vi.fn(async () => included(5));
    const p = waitForTx(getFn, HASH, { pollIntervalMs: 100 });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(QoreTxError);
    expect(err.code).toBe(5);
    expect(err.txHash).toBe(HASH);
  });

  it("rejects on timeout if never included", async () => {
    const getFn = vi.fn(async () => ({}) as GetTxResponse);
    const p = waitForTx(getFn, HASH, { timeoutMs: 5000, pollIntervalMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
  });
});

describe("broadcastAndWait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("broadcasts then waits for the returned hash", async () => {
    const broadcast = vi.fn(async () => ({ transactionHash: HASH }));
    const getFn = vi.fn(async () => included(0));
    const res = await broadcastAndWait(broadcast, getFn, { pollIntervalMs: 100 });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(getFn).toHaveBeenCalledWith(HASH);
    expect(res.txHash).toBe(HASH);
  });
});

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries transient failures then succeeds", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ < 2) throw new Error("transient");
      return "ok";
    });
    const p = withRetry(fn, { retries: 3, backoff: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    const p = withRetry(fn, { retries: 2, backoff: 50 });
    const assertion = expect(p).rejects.toThrow(/always/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(
      withRetry(fn, { retries: 5, shouldRetry: () => false }),
    ).rejects.toThrow(/fatal/);
    expect(fn).toHaveBeenCalledOnce();
  });
});
