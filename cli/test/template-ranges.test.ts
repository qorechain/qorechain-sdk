import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const workspace: Record<string, string> = {
  "@qorechain/sdk": "packages/ts",
  "@qorechain/evm": "packages/evm",
  "@qorechain/svm": "packages/svm",
};

/** Whether a caret range admits `version` (on 0.x the caret pins the minor). */
function caretAdmits(range: string, version: string): boolean {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) return false;
  const [maj, min, pat] = m.slice(1).map(Number);
  const [vMaj, vMin, vPat] = version.split(".").map(Number);
  if (maj !== vMaj) return false;
  if (maj === 0) return min === vMin && vPat >= pat;
  return vMin > min || (vMin === min && vPat >= pat);
}

describe("templates depend on the SDK released with the CLI", () => {
  const templates = readdirSync(join(root, "templates"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, "templates", d.name, "package.json")))
    .map((d) => d.name);

  it.each(templates)("%s", (name) => {
    const pkg = JSON.parse(readFileSync(join(root, "templates", name, "package.json"), "utf8"));
    for (const section of ["dependencies", "devDependencies"]) {
      for (const [dep, range] of Object.entries((pkg[section] ?? {}) as Record<string, string>)) {
        const dir = workspace[dep];
        if (!dir) continue;
        const version = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).version;
        expect(caretAdmits(range, version), `${name}: ${dep} ${range} does not admit ${version}`).toBe(true);
      }
    }
  });
});
