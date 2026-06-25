import { describe, it, expect, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { onLogs, onAccountChange, onSlotChange } from "../src/subscribe";

function fakeConnection() {
  return {
    onLogs: vi.fn(() => 1),
    removeOnLogsListener: vi.fn(async () => {}),
    onAccountChange: vi.fn(() => 2),
    removeAccountChangeListener: vi.fn(async () => {}),
    onSlotChange: vi.fn(() => 3),
    removeSlotChangeListener: vi.fn(async () => {}),
  };
}

describe("onLogs", () => {
  it("registers a logs listener and returns id + off", async () => {
    const conn = fakeConnection();
    const cb = vi.fn();
    const sub = onLogs(conn as unknown as Connection, "all", cb, "confirmed");
    expect(conn.onLogs).toHaveBeenCalledWith("all", cb, "confirmed");
    expect(sub.id).toBe(1);
    await sub.off();
    expect(conn.removeOnLogsListener).toHaveBeenCalledWith(1);
  });
});

describe("onAccountChange", () => {
  it("registers an account listener and cleans up", async () => {
    const conn = fakeConnection();
    const cb = vi.fn();
    const key = new PublicKey("11111111111111111111111111111111");
    const sub = onAccountChange(conn as unknown as Connection, key, cb);
    expect(conn.onAccountChange).toHaveBeenCalledWith(key, cb, undefined);
    expect(sub.id).toBe(2);
    await sub.off();
    expect(conn.removeAccountChangeListener).toHaveBeenCalledWith(2);
  });
});

describe("onSlotChange", () => {
  it("registers a slot listener and cleans up", async () => {
    const conn = fakeConnection();
    const cb = vi.fn();
    const sub = onSlotChange(conn as unknown as Connection, cb);
    expect(conn.onSlotChange).toHaveBeenCalledWith(cb);
    expect(sub.id).toBe(3);
    await sub.off();
    expect(conn.removeSlotChangeListener).toHaveBeenCalledWith(3);
  });
});
