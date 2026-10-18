import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { VERSION } from "../src/index";

describe("VERSION", () => {
  it("matches package.json, so a release cannot ship a stale constant", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
