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

for tmpl in evm-solidity fullstack-web; do
  echo "==> Type-checking template: $tmpl"
  out="$TMP/$tmpl"
  node cli/dist/index.js "$out" --template "$tmpl" --yes --local --no-install
  ( cd "$out" && pnpm install --ignore-workspace --no-frozen-lockfile >/dev/null 2>&1 && pnpm typecheck )
done

echo "ALL TEMPLATE TYPECHECKS PASSED"
