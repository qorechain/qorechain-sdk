#!/usr/bin/env bash
# check-proto-sync.sh — MAINTAINER-LOCAL proto drift check (NOT public CI).
#
# Diffs the vendored protos under `proto/qorechain/**` against the chain core
# protos on the maintainer's machine and reports drift: files that exist in one
# tree but not the other, content differences, and per-file `rpc` count
# mismatches (a quick signal that a service gained/lost methods).
#
# Why this is not wired into GitHub Actions: the chain core path is a PRIVATE,
# machine-local checkout. Public CI has no access to it, so this stays a local
# pre-release step. Run it before cutting a release to confirm the vendored
# protos still match the chain.
#
# Usage:
#   scripts/check-proto-sync.sh                 # uses the default core path
#   CORE_PROTO=/path/to/core/proto/qorechain scripts/check-proto-sync.sh
#
# Exit codes: 0 = in sync, 1 = drift found, 2 = core protos not found locally.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK_PROTO="proto/qorechain"
CORE_PROTO="${CORE_PROTO:-/Users/liviu/Development/Qore/testnet/qorechain-core/proto/qorechain}"

if [[ ! -d "$CORE_PROTO" ]]; then
  echo "core protos not found at: $CORE_PROTO" >&2
  echo "set CORE_PROTO=/path/to/qorechain-core/proto/qorechain and re-run." >&2
  exit 2
fi

drift=0

# Compare only the modules the SDK actually vendors (the core has more modules,
# and some — like the off-chain sidecar — are intentionally SDK-local).
while IFS= read -r sdk_file; do
  rel="${sdk_file#"$SDK_PROTO"/}"
  core_file="$CORE_PROTO/$rel"

  if [[ ! -f "$core_file" ]]; then
    echo "DRIFT: vendored proto has no core counterpart: $rel"
    drift=1
    continue
  fi

  if ! diff -q "$sdk_file" "$core_file" >/dev/null 2>&1; then
    echo "DRIFT: content differs from core: $rel"
    drift=1
  fi

  # Quick structural signal: number of rpc declarations per file.
  sdk_rpcs=$(grep -cE '^[[:space:]]*rpc ' "$sdk_file" || true)
  core_rpcs=$(grep -cE '^[[:space:]]*rpc ' "$core_file" || true)
  if [[ "$sdk_rpcs" != "$core_rpcs" ]]; then
    echo "DRIFT: rpc count differs ($rel): vendored=$sdk_rpcs core=$core_rpcs"
    drift=1
  fi
done < <(find "$SDK_PROTO" -name '*.proto' | sort)

# Flag core files that exist for a vendored module but are missing locally — a
# new tx.proto/query.proto added upstream that has not been re-synced yet.
for module_dir in "$SDK_PROTO"/*/; do
  module="$(basename "$module_dir")"
  core_module="$CORE_PROTO/$module"
  [[ -d "$core_module" ]] || continue
  while IFS= read -r core_file; do
    rel="${core_file#"$CORE_PROTO"/}"
    if [[ ! -f "$SDK_PROTO/$rel" ]]; then
      echo "DRIFT: core has a proto the SDK has not vendored: $rel"
      drift=1
    fi
  done < <(find "$core_module" -name '*.proto' | sort)
done

if [[ "$drift" -eq 0 ]]; then
  echo "proto sync OK — vendored protos match core for all vendored modules."
  exit 0
fi

echo ""
echo "Proto drift detected. Re-sync the vendored protos from the chain core and"
echo "regenerate codegen (scripts/codegen.sh) before releasing."
exit 1
