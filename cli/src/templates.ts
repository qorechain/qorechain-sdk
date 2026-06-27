/**
 * Template registry.
 *
 * Each entry describes a starter template that lives in the monorepo's
 * `templates/<dir>` directory (copied into this package at build time). The
 * registry is structured so more languages/templates can be added later without
 * touching the scaffolding logic.
 */

/** A language a template targets. Only TypeScript ships today. */
export type TemplateLanguage = "typescript";

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
] as const;

/** Look up a template by id, or `undefined` if unknown. */
export function findTemplate(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Comma-separated list of valid template ids, for error messages. */
export function templateIdList(): string {
  return TEMPLATES.map((t) => t.id).join(", ");
}
