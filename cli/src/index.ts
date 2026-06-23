/**
 * `create-qorechain-dapp` entry point.
 *
 * Parses flags (non-interactive / CI mode) and falls back to interactive prompts
 * for any missing inputs. All scaffolding side effects are delegated to the pure
 * {@link scaffold} function in `./scaffold`.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";

import { ArgError, helpText, parseArgs } from "./args.js";
import {
  scaffold,
  type Network,
  type PackageManager,
} from "./scaffold.js";
import { findTemplate, TEMPLATES, templateIdList } from "./templates.js";

const VERSION = "0.1.0";

function isEmptyOrMissing(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

/** Validate a directory name segment for a project name fallback. */
function defaultProjectName(dir: string): string {
  const base = basename(resolve(dir));
  // npm package names: lowercase, no spaces.
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-~._]/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "qorechain-dapp";
}

async function promptDir(initial?: string): Promise<string> {
  if (initial) return initial;
  const value = await text({
    message: "Where should we create your project?",
    placeholder: "./my-qorechain-dapp",
    defaultValue: "./my-qorechain-dapp",
    validate: (v) => {
      const dir = v || "./my-qorechain-dapp";
      if (!isEmptyOrMissing(resolve(dir))) {
        return `Directory ${dir} already exists and is not empty.`;
      }
      return undefined;
    },
  });
  if (isCancel(value)) bail();
  return (value as string) || "./my-qorechain-dapp";
}

async function promptTemplate(initial?: string): Promise<string> {
  if (initial) {
    if (!findTemplate(initial)) {
      cancel(`Unknown template "${initial}". Available: ${templateIdList()}.`);
      process.exit(1);
    }
    return initial;
  }
  const value = await select({
    message: "Pick a template",
    options: TEMPLATES.map((t) => ({
      value: t.id,
      label: t.label,
      hint: t.hint,
    })),
  });
  if (isCancel(value)) bail();
  return value as string;
}

async function promptNetwork(initial?: Network): Promise<Network> {
  if (initial) return initial;
  // testnet is the only live network today; surface it but note mainnet status.
  const value = await select({
    message: "Which network?",
    options: [
      { value: "testnet", label: "testnet", hint: "live" },
      {
        value: "mainnet-disabled",
        label: "mainnet",
        hint: "not yet live — unavailable",
      },
    ],
  });
  if (isCancel(value)) bail();
  if (value === "mainnet-disabled") {
    log.warn("mainnet is not yet live; using testnet.");
    return "testnet";
  }
  return value as Network;
}

async function promptPackageManager(
  initial?: PackageManager,
): Promise<PackageManager> {
  if (initial) return initial;
  const value = await select({
    message: "Package manager?",
    options: [
      { value: "pnpm", label: "pnpm" },
      { value: "npm", label: "npm" },
      { value: "yarn", label: "yarn" },
    ],
    initialValue: "pnpm",
  });
  if (isCancel(value)) bail();
  return value as PackageManager;
}

function bail(): never {
  cancel("Operation cancelled.");
  process.exit(0);
}

function nextSteps(
  dir: string,
  pm: PackageManager,
  installed: boolean,
  template: string,
): string {
  const lines: string[] = [`cd ${dir}`];
  if (!installed) lines.push(`${pm} install`);
  const run = pm === "npm" ? "npm run" : pm;
  if (template === "fullstack-web") {
    lines.push(`${run} dev`);
  } else {
    lines.push(`${run} deploy   # see README for prerequisites`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(pc.red(err.message));
      console.error(`\nRun ${pc.cyan("create-qorechain-dapp --help")} for usage.`);
      process.exit(1);
    }
    throw err;
  }

  if (parsed.help) {
    console.log(helpText());
    return;
  }
  if (parsed.version) {
    console.log(VERSION);
    return;
  }

  intro(pc.bgCyan(pc.black(" create-qorechain-dapp ")));

  // Resolve each input: flags first, then prompts (unless --yes fills defaults).
  const dir = parsed.dir ?? (parsed.yes ? "./my-qorechain-dapp" : await promptDir());
  const template =
    parsed.template ??
    (parsed.yes ? TEMPLATES[0].id : await promptTemplate());
  // Validate the (possibly flag-provided) template eagerly.
  if (!findTemplate(template)) {
    cancel(`Unknown template "${template}". Available: ${templateIdList()}.`);
    process.exit(1);
  }
  const network =
    parsed.network ?? (parsed.yes ? "testnet" : await promptNetwork());
  const packageManager =
    parsed.packageManager ??
    (parsed.yes ? "pnpm" : await promptPackageManager());

  const projectName = defaultProjectName(dir);

  // In interactive mode, default install to the flag (true unless --no-install).
  const install = parsed.install;

  try {
    if (install) log.step("Scaffolding and installing dependencies…");
    else log.step("Scaffolding…");

    const result = scaffold({
      template,
      targetDir: dir,
      projectName,
      packageManager,
      network,
      install,
      local: parsed.local,
    });

    if (parsed.local) {
      note(
        "Dependencies were rewritten to local file: links into this monorepo.\n" +
          "Build the workspace packages first (pnpm -r build at the repo root).",
        "Local mode",
      );
    }

    note(nextSteps(dir, packageManager, result.installed, template), "Next steps");
    outro(pc.green(`Done! Created ${projectName} at ${result.targetDir}`));
  } catch (err) {
    cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
