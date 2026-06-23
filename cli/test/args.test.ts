import { describe, expect, it } from "vitest";

import { ArgError, parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("defaults: install true, not interactive flags set", () => {
    const a = parseArgs([]);
    expect(a.install).toBe(true);
    expect(a.yes).toBe(false);
    expect(a.local).toBe(false);
    expect(a.dir).toBeUndefined();
    expect(a.template).toBeUndefined();
  });

  it("parses positional dir and template flag", () => {
    const a = parseArgs(["my-dapp", "--template", "evm-solidity"]);
    expect(a.dir).toBe("my-dapp");
    expect(a.template).toBe("evm-solidity");
  });

  it("supports --template=value form and -t alias", () => {
    expect(parseArgs(["--template=fullstack-web"]).template).toBe("fullstack-web");
    expect(parseArgs(["-t", "evm-solidity"]).template).toBe("evm-solidity");
  });

  it("--no-install disables install", () => {
    expect(parseArgs(["--no-install"]).install).toBe(false);
  });

  it("--yes and --local set flags", () => {
    const a = parseArgs(["d", "--yes", "--local"]);
    expect(a.yes).toBe(true);
    expect(a.local).toBe(true);
  });

  it("parses package manager and network", () => {
    const a = parseArgs([
      "d",
      "--package-manager",
      "yarn",
      "--network",
      "testnet",
    ]);
    expect(a.packageManager).toBe("yarn");
    expect(a.network).toBe("testnet");
  });

  it("rejects an invalid package manager", () => {
    expect(() => parseArgs(["--package-manager", "bun"])).toThrow(ArgError);
  });

  it("rejects mainnet (not yet live)", () => {
    expect(() => parseArgs(["--network", "mainnet"])).toThrow(ArgError);
  });

  it("rejects unknown options", () => {
    expect(() => parseArgs(["--frobnicate"])).toThrow(ArgError);
  });

  it("rejects a missing value", () => {
    expect(() => parseArgs(["--template"])).toThrow(ArgError);
  });

  it("rejects a second positional argument", () => {
    expect(() => parseArgs(["a", "b"])).toThrow(ArgError);
  });

  it("sets help/version flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });
});
