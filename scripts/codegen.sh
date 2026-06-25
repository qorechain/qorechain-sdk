#!/usr/bin/env bash
# Generate TypeScript message + service types from the vendored QoreChain protos.
#
# Uses `buf generate` with `ts-proto`. Dependency protos (the SDK's coin/msg
# types, gogoproto, cosmos-proto, well-known types) are resolved from the public
# schema registry declared in proto/buf.yaml, so they do NOT need to be vendored.
#
# Output (packages/ts/src/codegen/qorechain/**) is COMMITTED: consumers install
# `@qorechain/sdk` and get the typed messages without running protoc/buf.
#
# Prereqs (maintainer only): `buf` on PATH and `ts-proto` installed in the ts
# package (a devDependency — `pnpm install` provides it).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v buf >/dev/null 2>&1; then
  echo "ERROR: 'buf' not found on PATH. Install from https://buf.build." >&2
  exit 1
fi

OUT="packages/ts/src/codegen/qorechain"
rm -rf "$OUT"

# Generate only the qorechain chain modules (their dep types are imported, not
# emitted). The `sidecar` package is an off-chain gRPC service definition, not a
# tx/query module, so it is excluded from the SDK surface.
buf generate proto --template proto/buf.gen.yaml \
  --path proto/qorechain \
  --exclude-path proto/qorechain/sidecar

echo "Generated TypeScript into packages/ts/src/codegen/qorechain"
