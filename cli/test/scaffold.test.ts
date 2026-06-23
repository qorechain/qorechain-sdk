import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveTemplatesRoot, scaffold } from "../src/scaffold.js";

// Templates live at the monorepo root (cli/test → ../../templates).
const here = fileURLToPath(new URL(".", import.meta.url));
const templatesRoot = resolve(here, "..", "..", "templates");
const monorepoRoot = resolve(here, "..", "..");

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "cqd-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("resolveTemplatesRoot", () => {
  it("finds a directory containing evm-solidity", () => {
    const root = resolveTemplatesRoot();
    expect(existsSync(join(root, "evm-solidity"))).toBe(true);
  });
});

describe("scaffold(evm-solidity)", () => {
  it("copies expected files, rewrites name, creates .env, skips install", () => {
    const target = join(workdir, "my-evm-dapp");
    const result = scaffold({
      template: "evm-solidity",
      targetDir: target,
      projectName: "my-evm-dapp",
      packageManager: "pnpm",
      install: false,
      templatesRoot,
    });

    expect(result.installed).toBe(false);
    expect(result.targetDir).toBe(resolve(target));

    // Expected files present.
    expect(existsSync(join(target, "package.json"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(existsSync(join(target, "README.md"))).toBe(true);
    expect(
      existsSync(join(target, "contracts", "Counter.sol")),
    ).toBe(true);
    expect(existsSync(join(target, "scripts", "deploy.ts"))).toBe(true);

    // package.json name rewritten.
    const pkg = JSON.parse(
      readFileSync(join(target, "package.json"), "utf8"),
    ) as { name: string; dependencies?: Record<string, string> };
    expect(pkg.name).toBe("my-evm-dapp");
    // Without --local, the published range is preserved.
    expect(pkg.dependencies?.["@qorechain/evm"]).toMatch(/^\^/);

    // .env generated from .env.example.
    expect(existsSync(join(target, ".env"))).toBe(true);
    expect(readFileSync(join(target, ".env"), "utf8")).toBe(
      readFileSync(join(target, ".env.example"), "utf8"),
    );

    // node_modules not copied.
    expect(existsSync(join(target, "node_modules"))).toBe(false);
  });

  it("rewrites @qorechain/* deps to file: links with local=true", () => {
    const target = join(workdir, "local-dapp");
    scaffold({
      template: "evm-solidity",
      targetDir: target,
      projectName: "local-dapp",
      install: false,
      local: true,
      templatesRoot,
      monorepoRoot,
    });
    const pkg = JSON.parse(
      readFileSync(join(target, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@qorechain/evm"]).toBe(
      `file:${join(monorepoRoot, "packages", "evm")}`,
    );
  });
});

describe("scaffold(fullstack-web)", () => {
  it("copies the Vite app and rewrites the name", () => {
    const target = join(workdir, "web-dapp");
    scaffold({
      template: "fullstack-web",
      targetDir: target,
      projectName: "web-dapp",
      install: false,
      templatesRoot,
    });
    expect(existsSync(join(target, "index.html"))).toBe(true);
    expect(existsSync(join(target, "src", "App.tsx"))).toBe(true);
    expect(existsSync(join(target, "vite.config.ts"))).toBe(true);
    const pkg = JSON.parse(
      readFileSync(join(target, "package.json"), "utf8"),
    ) as { name: string };
    expect(pkg.name).toBe("web-dapp");
  });
});

describe("scaffold errors", () => {
  it("throws clearly on an unknown template", () => {
    expect(() =>
      scaffold({
        template: "nope",
        targetDir: join(workdir, "x"),
        projectName: "x",
        templatesRoot,
      }),
    ).toThrow(/Unknown template "nope"/);
  });

  it("throws when the target dir is non-empty", () => {
    const target = join(workdir, "dapp");
    scaffold({
      template: "evm-solidity",
      targetDir: target,
      projectName: "dapp",
      templatesRoot,
    });
    // Second scaffold into the now-populated dir fails.
    expect(() =>
      scaffold({
        template: "evm-solidity",
        targetDir: target,
        projectName: "dapp",
        templatesRoot,
      }),
    ).toThrow(/not empty/);
  });
});
