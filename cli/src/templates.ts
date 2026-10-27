/**
 * Template registry.
 *
 * Each entry describes a starter template that lives in the monorepo's
 * `templates/<dir>` directory (copied into this package at build time). The
 * registry is structured so more languages/templates can be added later without
 * touching the scaffolding logic.
 */

/** The main language a template targets. */
export type TemplateLanguage = "typescript" | "solidity" | "rust";

/** A scaffoldable starter template. */
export interface TemplateInfo {
  /** Registry id and on-disk directory name under `templates/`. */
  id: string;
  /** Short human label shown in the interactive picker. */
  label: string;
  /** One-line description. */
  hint: string;
  /** Source language. */
  language: TemplateLanguage;
}

/** All templates the CLI can scaffold. */
export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: "evm-solidity",
    label: "EVM + Solidity",
    hint: "A Solidity contract with a viem deploy/interact script using @qorechain/evm.",
    language: "typescript",
  },
  {
    id: "fullstack-web",
    label: "Full-stack web (Vite + React)",
    hint: "A minimal Vite + React dApp using @qorechain/sdk to read balances and tokenomics.",
    language: "typescript",
  },
  {
    id: "rollup-app",
    label: "Rollup + multilayer app",
    hint: "A rollup + sidechain/paychain app using the RollupClient and multilayer helper from @qorechain/sdk.",
    language: "typescript",
  },
  {
    id: "foundry",
    label: "Foundry",
    hint: "A Foundry project (contract, tests, deploy script) with a helper that opens the EVM authorisation window.",
    language: "solidity",
  },
  {
    id: "hardhat",
    label: "Hardhat 3",
    hint: "A Hardhat 3 + viem project (contract, tests, Ignition deploy) with the EVM window helper.",
    language: "solidity",
  },
  {
    id: "viem-wagmi",
    label: "viem + wagmi (Vite + React)",
    hint: "A wagmi + RainbowKit dApp with the QoreX wallet and the QoreChain chain definitions.",
    language: "typescript",
  },
  {
    id: "cosmwasm",
    label: "CosmWasm (CW20)",
    hint: "A cw20-base token with an optimized build, a governance upload proposal and testnet scripts.",
    language: "rust",
  },
] as const;

/** Look up a template by id, or `undefined` if unknown. */
export function findTemplate(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Comma-separated list of valid template ids, for error messages. */
export function templateIdList(): string {
  return TEMPLATES.map((t) => t.id).join(", ");
}
