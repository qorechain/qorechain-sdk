import { describe, it, expect } from "vitest";
import {
  explorerTxUrl,
  explorerAddressUrl,
  explorerBlockUrl,
  getNetwork,
} from "../src/index";

describe("explorer URL builders", () => {
  const cfg = { explorerUrl: "https://explorer.example" };

  it("builds a tx URL when explorerUrl is configured", () => {
    expect(explorerTxUrl(cfg, "ABC123")).toBe("https://explorer.example/tx/ABC123");
  });

  it("builds an address URL", () => {
    expect(explorerAddressUrl(cfg, "qor1abc")).toBe(
      "https://explorer.example/address/qor1abc",
    );
  });

  it("builds a block URL from a numeric height", () => {
    expect(explorerBlockUrl(cfg, 42)).toBe("https://explorer.example/block/42");
  });

  it("strips a trailing slash on the base URL", () => {
    expect(explorerTxUrl({ explorerUrl: "https://explorer.example/" }, "X")).toBe(
      "https://explorer.example/tx/X",
    );
  });

  it("throws a clear error when explorerUrl is not configured", () => {
    expect(() => explorerTxUrl({}, "X")).toThrow(
      /explorer URL not configured for this network/,
    );
  });

  it("built-in presets leave explorerUrl undefined (no baked hostname)", () => {
    expect(getNetwork("testnet").explorerUrl).toBeUndefined();
    expect(getNetwork("mainnet").explorerUrl).toBeUndefined();
    expect(() => explorerTxUrl(getNetwork("mainnet"), "X")).toThrow();
  });

  it("works with a network override carrying explorerUrl", () => {
    const net = { ...getNetwork("mainnet"), explorerUrl: "https://ex.test" };
    expect(explorerTxUrl(net, "H")).toBe("https://ex.test/tx/H");
  });
});
