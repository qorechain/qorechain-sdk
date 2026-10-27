// Copy the monorepo's `templates/` into the CLI package so the published
// artifact is self-contained. Runs as part of `build` (and standalone via
// `prepare:templates`). Excludes node_modules/dist and other build noise.
import { cp, rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const src = join(cliRoot, "..", "templates");
const dest = join(cliRoot, "templates");

// Build output of the Foundry, Hardhat and CosmWasm templates is skipped too, and
// `scaffold-eth-extension` is a Scaffold-ETH 2 extension, not a CLI template.
const SKIP = new Set([
  "node_modules",
  "dist",
  ".turbo",
  "coverage",
  ".env",
  "out",
  "cache",
  "artifacts",
  "target",
  "lib",
  "broadcast",
  "scaffold-eth-extension",
]);

// The workspace packages a template may depend on. Their ranges are rewritten
// to "^<current version>" on copy, so a published CLI always scaffolds against
// the SDK released with it (a hand-written "^0.3.0" kept installing 0.3.x).
const WORKSPACE = {
  "@qorechain/sdk": join(cliRoot, "..", "packages", "ts", "package.json"),
  "@qorechain/evm": join(cliRoot, "..", "packages", "evm", "package.json"),
  "@qorechain/svm": join(cliRoot, "..", "packages", "svm", "package.json"),
};

async function pinWorkspaceRanges(dir) {
  const versions = {};
  for (const [name, path] of Object.entries(WORKSPACE)) {
    versions[name] = JSON.parse(await readFile(path, "utf8")).version;
  }
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(dir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    for (const section of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (versions[name]) pkg[section][name] = `^${versions[name]}`;
      }
    }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

async function main() {
  if (!existsSync(src)) {
    throw new Error(`templates source not found at ${src}`);
  }
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(src, dest, {
    recursive: true,
    filter: (path) => {
      const parts = path.split(/[\\/]/);
      return !parts.some((p) => SKIP.has(p));
    },
  });
  await pinWorkspaceRanges(dest);
  // Don't ship the templates/README.md placeholder as a "template".
  console.log(`Copied templates → ${dest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
