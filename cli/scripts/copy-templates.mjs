// Copy the monorepo's `templates/` into the CLI package so the published
// artifact is self-contained. Runs as part of `build` (and standalone via
// `prepare:templates`). Excludes node_modules/dist and other build noise.
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const src = join(cliRoot, "..", "templates");
const dest = join(cliRoot, "templates");

const SKIP = new Set(["node_modules", "dist", ".turbo", "coverage", ".env"]);

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
  // Don't ship the templates/README.md placeholder as a "template".
  console.log(`Copied templates → ${dest}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
