import { describe, it, expect, vi } from "vitest";
import {
  subscribeNewBlocks,
  subscribeTx,
  buildTxQuery,
  type SubscriptionClient,
  type EventStream,
} from "../src/subscribe";

/** A fake xstream-style stream recording subscribe/unsubscribe. */
function fakeStream<T>() {
  const unsubscribe = vi.fn();
  let observer: { next?: (v: T) => void; error?: (e: unknown) => void } | undefined;
  const stream: EventStream<T> = {
    subscribe(obs) {
      observer = obs;
      return { unsubscribe };
    },
  };
  return {
    stream,
    unsubscribe,
    emit: (v: T) => observer?.next?.(v),
    fail: (e: unknown) => observer?.error?.(e),
  };
}

describe("buildTxQuery", () => {
  it("always includes the Tx event and ANDs attribute filters", () => {
    expect(buildTxQuery()).toBe("tm.event='Tx'");
    expect(buildTxQuery({ "message.sender": "qor1abc" })).toBe(
      "tm.event='Tx' AND message.sender='qor1abc'",
    );
    expect(buildTxQuery({ "tx.height": 42 })).toBe(
      "tm.event='Tx' AND tx.height=42",
    );
  });
});

describe("subscribeNewBlocks", () => {
  it("registers a handler and returns a working unsubscribe", () => {
    const blocks = fakeStream<{ header: { height: number } }>();
    const client: SubscriptionClient = {
      subscribeNewBlock: () => blocks.stream as never,
      subscribeTx: () => fakeStream().stream as never,
    };
    const handler = vi.fn();
    const off = subscribeNewBlocks(client, handler);
    blocks.emit({ header: { height: 7 } });
    expect(handler).toHaveBeenCalledWith({ header: { height: 7 } });
    off();
    expect(blocks.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("subscribeTx", () => {
  it("passes a built query to the client and forwards events", () => {
    const txs = fakeStream<{ height: number }>();
    const subscribeTxFn = vi.fn(() => txs.stream as never);
    const client: SubscriptionClient = {
      subscribeNewBlock: () => fakeStream().stream as never,
      subscribeTx: subscribeTxFn,
    };
    const handler = vi.fn();
    const off = subscribeTx(client, { "message.sender": "qor1abc" }, handler);
    expect(subscribeTxFn).toHaveBeenCalledWith(
      "tm.event='Tx' AND message.sender='qor1abc'",
    );
    txs.emit({ height: 9 });
    expect(handler).toHaveBeenCalledWith({ height: 9 });
    off();
    expect(txs.unsubscribe).toHaveBeenCalledOnce();
  });

  it("accepts a raw query string", () => {
    const txs = fakeStream();
    const subscribeTxFn = vi.fn(() => txs.stream as never);
    const client: SubscriptionClient = {
      subscribeNewBlock: () => fakeStream().stream as never,
      subscribeTx: subscribeTxFn,
    };
    subscribeTx(client, "tm.event='Tx'", vi.fn());
    expect(subscribeTxFn).toHaveBeenCalledWith("tm.event='Tx'");
  });
});
