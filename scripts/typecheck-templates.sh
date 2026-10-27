#!/usr/bin/env bash
# Type-check the starter templates in `templates/`.
#
# Templates are intentionally NOT pnpm workspace members (so their published
# `@qorechain/*` version ranges don't break root `pnpm install`). To type-check
# them we link the local workspace packages in via `file:` deps using the CLI's
# `--local` rewrite, install with a throwaway store, and run `tsc --noEmit`.
#
# This keeps `pnpm -r build/test/install` green while still giving real type
# coverage for the templates in CI.
#
# `--local` only rewrites the template's direct `@qorechain/*` deps. The local
# packages themselves can depend on each other via `workspace:` ranges (e.g.
# `@qorechain/sdk` -> `@qorechain/evm`), which pnpm cannot resolve outside the
# workspace. We add `pnpm.overrides` pointing every local package at its
# monorepo dir so those transitive deps resolve to the same local builds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Build the workspace packages the templates depend on (idempotent).
echo "==> Building workspace packages (sdk, evm)"
pnpm --filter @qorechain/sdk --filter @qorechain/evm build

# Build the CLI so we can scaffold with --local.
echo "==> Building CLI"
pnpm --filter create-qorechain-dapp build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for tmpl in evm-solidity fullstack-web rollup-app foundry hardhat viem-wagmi cosmwasm; do
  echo "==> Type-checking template: $tmpl"
  out="$TMP/$tmpl"
  node cli/dist/index.js "$out" --template "$tmpl" --yes --local --no-install
  node -e '
    const fs = require("fs");
    const [pkgPath, root] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.pnpm = { ...pkg.pnpm, overrides: {
      "@qorechain/sdk": `file:${root}/packages/ts`,
      "@qorechain/evm": `file:${root}/packages/evm`,
      "@qorechain/svm": `file:${root}/packages/svm`,
    } };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  ' "$out/package.json" "$ROOT"
  if ! ( cd "$out" && pnpm install --ignore-workspace --no-frozen-lockfile >"$TMP/$tmpl-install.log" 2>&1 ); then
    echo "pnpm install failed for template $tmpl:" >&2
    cat "$TMP/$tmpl-install.log" >&2
    exit 1
  fi
  ( cd "$out" && pnpm typecheck )
done

echo "ALL TEMPLATE TYPECHECKS PASSED"
