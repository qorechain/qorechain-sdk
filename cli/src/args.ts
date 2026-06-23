/**
 * Hand-rolled, dependency-free argument parser for the CLI. Kept separate from
 * the prompt I/O so it can be unit-tested directly.
 */
import type { Network, PackageManager } from "./scaffold.js";
import { TEMPLATES } from "./templates.js";

/** Parsed CLI arguments. */
export interface ParsedArgs {
  /** Positional target directory (project dir), if given. */
  dir?: string;
  /** `--template <name>`. */
  template?: string;
  /** `--network <testnet>`. */
  network?: Network;
  /** `--package-manager <pnpm|npm|yarn>`. */
  packageManager?: PackageManager;
  /** `--yes`: skip prompts, use defaults. */
  yes: boolean;
  /** `--no-install`: skip dependency install. */
  install: boolean;
  /** `--local`: rewrite @qorechain/* deps to file: links into the monorepo. */
  local: boolean;
  /** `--help`. */
  help: boolean;
  /** `--version`. */
  version: boolean;
}

const VALID_PM: readonly PackageManager[] = ["pnpm", "npm", "yarn"];
const VALID_NETWORK: readonly Network[] = ["testnet"];

/** Thrown for malformed CLI input; carries a user-facing message. */
export class ArgError extends Error {}

function expectValue(name: string, value: string | undefined): string {
  if (value === undefined) throw new ArgError(`Missing value for ${name}.`);
  return value;
}

/**
 * Parse argv (excluding `node` and the script path). Throws {@link ArgError}
 * on malformed input.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    yes: false,
    install: true,
    local: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      case "-y":
      case "--yes":
        out.yes = true;
        break;
      case "--install":
        out.install = true;
        break;
      case "--no-install":
        out.install = false;
        break;
      case "--local":
        out.local = true;
        break;
      case "--template":
      case "-t":
        out.template = expectValue("--template", argv[++i]);
        break;
      case "--network":
        out.network = parseNetwork(expectValue("--network", argv[++i]));
        break;
      case "--package-manager":
      case "--pm":
        out.packageManager = parsePackageManager(
          expectValue("--package-manager", argv[++i]),
        );
        break;
      default: {
        if (arg.startsWith("--template=")) {
          out.template = arg.slice("--template=".length);
        } else if (arg.startsWith("--network=")) {
          out.network = parseNetwork(arg.slice("--network=".length));
        } else if (arg.startsWith("--package-manager=")) {
          out.packageManager = parsePackageManager(
            arg.slice("--package-manager=".length),
          );
        } else if (arg.startsWith("-")) {
          throw new ArgError(`Unknown option: ${arg}`);
        } else if (out.dir === undefined) {
          out.dir = arg;
        } else {
          throw new ArgError(`Unexpected argument: ${arg}`);
        }
      }
    }
  }

  return out;
}

function parsePackageManager(value: string): PackageManager {
  if ((VALID_PM as readonly string[]).includes(value)) {
    return value as PackageManager;
  }
  throw new ArgError(
    `Invalid --package-manager "${value}". Expected one of: ${VALID_PM.join(", ")}.`,
  );
}

function parseNetwork(value: string): Network {
  if ((VALID_NETWORK as readonly string[]).includes(value)) {
    return value as Network;
  }
  throw new ArgError(
    `Invalid --network "${value}". Expected one of: ${VALID_NETWORK.join(", ")} ` +
      `(mainnet is not yet live).`,
  );
}

/** The `--help` text. */
export function helpText(): string {
  const templates = TEMPLATES.map(
    (t) => `    ${t.id.padEnd(16)} ${t.hint}`,
  ).join("\n");
  return `create-qorechain-dapp — scaffold a new QoreChain dApp.

Usage:
  npm create qorechain-dapp <dir> [options]
  npx create-qorechain-dapp <dir> [options]

Arguments:
  <dir>                      Target directory for the new project.

Options:
  -t, --template <name>      Template to use. One of:
${templates}
      --network <name>       Network preset (testnet). mainnet is not yet live.
      --package-manager <pm> Package manager: pnpm | npm | yarn.
  -y, --yes                  Skip prompts and use defaults.
      --no-install           Do not install dependencies after scaffolding.
      --local                Rewrite @qorechain/* deps to local file: links
                             into this monorepo (for local/dev use before the
                             packages are published to npm).
  -h, --help                 Show this help.
  -v, --version              Print the version.

Examples:
  npm create qorechain-dapp my-dapp -- --template evm-solidity
  npx create-qorechain-dapp my-dapp --template fullstack-web --yes
  npx create-qorechain-dapp my-dapp -t evm-solidity --local --no-install
`;
}
