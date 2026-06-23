/**
 * Core scaffolding logic — pure and unit-testable, with no prompt I/O.
 *
 * `scaffold(...)` copies a template into a target directory, rewrites the
 * template's package.json name, generates `.env` from `.env.example`, optionally
 * rewrites `@qorechain/*` deps to local `file:` links, and optionally runs a
 * package-manager install. All side effects are confined to the target dir
 * (plus an optional `spawn` for install), so tests can drive it against a temp
 * dir with `install: false`.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findTemplate, templateIdList } from "./templates.js";

/** Supported package managers. */
export type PackageManager = "pnpm" | "npm" | "yarn";

/** Supported networks (mainnet is not yet live). */
export type Network = "testnet";

/** Options for {@link scaffold}. */
export interface ScaffoldOptions {
  /** Template id (must exist in the registry). */
  template: string;
  /** Absolute or relative target directory to create the project in. */
  targetDir: string;
  /** Project name written into the generated package.json. */
  projectName: string;
  /** Package manager to record/use. Defaults to `pnpm`. */
  packageManager?: PackageManager;
  /** Network preset. Defaults to `testnet`. */
  network?: Network;
  /** Run the package manager install after copying. Defaults to `false`. */
  install?: boolean;
  /**
   * Rewrite `@qorechain/*` dependencies to `file:` links into this monorepo so
   * the scaffolded project is runnable locally before the packages are
   * published. Defaults to `false` (keeps the published `^x.y.z` ranges).
   */
  local?: boolean;
  /**
   * Override the directory templates are resolved from. Primarily for tests.
   * When unset, templates are located relative to this package (see
   * {@link resolveTemplatesRoot}).
   */
  templatesRoot?: string;
  /**
   * Monorepo root used to compute `file:` links when `local` is set. Defaults
   * to the resolved repo root relative to this package.
   */
  monorepoRoot?: string;
}

/** Result of a successful {@link scaffold}. */
export interface ScaffoldResult {
  /** Absolute path to the created project. */
  targetDir: string;
  /** Whether install was run. */
  installed: boolean;
  /** Relative paths of the files written (sorted). */
  files: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the bundled `templates/` directory. Works both from source (where
 * templates live at the repo root, two levels up from `cli/src`) and from the
 * built/published package (where `copy-templates` placed them at `<pkg>/templates`).
 */
export function resolveTemplatesRoot(): string {
  // Built/published layout: dist/index.js → ../templates
  const bundled = resolve(here, "..", "templates");
  if (existsSync(bundled) && existsSync(join(bundled, "evm-solidity"))) {
    return bundled;
  }
  // Source layout: cli/src → ../../templates
  const sourceLevel = resolve(here, "..", "..", "templates");
  if (existsSync(sourceLevel) && existsSync(join(sourceLevel, "evm-solidity"))) {
    return sourceLevel;
  }
  // Fallback to the bundled path so the error message is actionable.
  return bundled;
}

/**
 * Locate the monorepo root (which contains `packages/`), used for `file:` links
 * in `--local` mode.
 */
function resolveMonorepoRoot(): string {
  const candidates = [
    resolve(here, "..", ".."), // source: cli/src → repo root
    resolve(here, "..", "..", ".."), // dist/index.js variants
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "packages", "ts", "package.json"))) return c;
  }
  return resolve(here, "..", "..");
}

const COPY_SKIP = new Set(["node_modules", "dist", ".turbo", "coverage"]);

/** Recursively collect relative file paths under `root`. */
function listFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      out.push(full.slice(base.length + 1));
    }
  }
  return out.sort();
}

/** Rewrite `@qorechain/*` deps in a parsed package.json to `file:` links. */
function rewriteLocalDeps(
  pkg: Record<string, unknown>,
  monorepoRoot: string,
): void {
  // Map of published package name → monorepo package dir.
  const localPackages: Record<string, string> = {
    "@qorechain/sdk": join(monorepoRoot, "packages", "ts"),
    "@qorechain/evm": join(monorepoRoot, "packages", "evm"),
    "@qorechain/svm": join(monorepoRoot, "packages", "svm"),
  };
  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      const dir = localPackages[name];
      if (dir) deps[name] = `file:${dir}`;
    }
  }
}

/** Install command for a given package manager. */
function installCommand(pm: PackageManager): { cmd: string; args: string[] } {
  return { cmd: pm, args: ["install"] };
}

/**
 * Scaffold a project. Pure with respect to everything except the target dir
 * (and the optional install subprocess).
 *
 * @throws if the template is unknown or the target dir already exists and is
 *   non-empty.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const {
    template,
    projectName,
    packageManager = "pnpm",
    install = false,
    local = false,
  } = options;

  const info = findTemplate(template);
  if (!info) {
    throw new Error(
      `Unknown template "${template}". Available templates: ${templateIdList()}.`,
    );
  }

  const templatesRoot = options.templatesRoot ?? resolveTemplatesRoot();
  const templateDir = join(templatesRoot, info.id);
  if (!existsSync(templateDir)) {
    throw new Error(
      `Template "${info.id}" not found on disk at ${templateDir}. ` +
        `The package may be built incorrectly.`,
    );
  }

  const targetDir = resolve(options.targetDir);
  if (existsSync(targetDir)) {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } else {
    mkdirSync(targetDir, { recursive: true });
  }

  // Copy template, skipping build artifacts.
  cpSync(templateDir, targetDir, {
    recursive: true,
    filter: (srcPath) => {
      const rel = srcPath.slice(templateDir.length + 1);
      const parts = rel.split(/[\\/]/);
      return !parts.some((p) => COPY_SKIP.has(p));
    },
  });

  // Rewrite package.json: name (+ optional local file: deps).
  const pkgPath = join(targetDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
      string,
      unknown
    >;
    pkg.name = projectName;
    if (local) {
      rewriteLocalDeps(pkg, options.monorepoRoot ?? resolveMonorepoRoot());
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Generate .env from .env.example if present and .env absent.
  const envExample = join(targetDir, ".env.example");
  const envPath = join(targetDir, ".env");
  if (existsSync(envExample) && !existsSync(envPath)) {
    writeFileSync(envPath, readFileSync(envExample, "utf8"));
  }

  let installed = false;
  if (install) {
    const { cmd, args } = installCommand(packageManager);
    const res = spawnSync(cmd, args, {
      cwd: targetDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      throw new Error(
        `Install failed (${cmd} ${args.join(" ")}) with exit code ${res.status ?? "unknown"}.`,
      );
    }
    installed = true;
  }

  return { targetDir, installed, files: listFiles(targetDir) };
}
