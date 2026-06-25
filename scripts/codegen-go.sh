#!/usr/bin/env bash
# Generate gogoproto-compatible Go message + service types from the vendored
# QoreChain protos.
#
# Uses `buf generate` with the gogo cosmos plugin (protoc-gen-gocosmos from
# github.com/cosmos/gogoproto). The emitted types implement the gogo
# proto.Message interface, so they pack into the Cosmos SDK codec Any and an
# InterfaceRegistry exactly like the chain's own message types — this is what
# lets the SDK encode a custom Msg into a tx Any and decode it back through the
# codec (see registry round-trip test).
#
# Dependency protos (coin/msg types, gogoproto, cosmos_proto, well-known types)
# are resolved from the public schema registry declared in proto/buf.yaml, so a
# maintainer running codegen needs no local dependency protos. They are NOT
# re-emitted: managed-mode `disable` keeps each dependency import pointing at the
# Go module already in go.mod, and `go_package_prefix` rewrites only the
# qorechain modules into the committed proto tree.
#
# Output (packages/go/qorechain/proto/qorechain/**) is COMMITTED: consumers
# `go get` the SDK and get the typed messages without running buf/protoc.
#
# Prereqs (maintainer only): `buf` and `protoc-gen-gocosmos` on PATH. Install the
# plugin with:
#   go install github.com/cosmos/gogoproto/protoc-gen-gocosmos@latest
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v buf >/dev/null 2>&1; then
  echo "ERROR: 'buf' not found on PATH. Install from https://buf.build." >&2
  exit 1
fi
if ! command -v protoc-gen-gocosmos >/dev/null 2>&1; then
  echo "ERROR: 'protoc-gen-gocosmos' not found on PATH." >&2
  echo "  go install github.com/cosmos/gogoproto/protoc-gen-gocosmos@latest" >&2
  exit 1
fi

PKG_ROOT="packages/go/qorechain/proto"
# buf writes the plugin output relative to proto/ under a path that mirrors the
# full go_package (github.com/qorechain/.../proto). Capture that scratch root so
# the generated .pb.go files can be copied into the package and cleaned up.
GEN_TMP="proto/packages/go/qorechain/proto/github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain"

rm -rf "proto/packages"
# Remove ONLY the generated *.pb.go files; hand-written cast/custom-type files
# (types.go) live in the same per-module dirs and must be preserved.
find "$PKG_ROOT/qorechain" -name '*.pb.go' -delete 2>/dev/null || true

# Generate only the qorechain chain modules (their dep types are imported, not
# emitted). The `sidecar` package is an off-chain gRPC service definition, not a
# tx/query module, so it is excluded from the SDK surface (mirrors codegen.sh).
( cd proto && buf generate --template buf.gen.go.yaml \
    --path qorechain \
    --exclude-path qorechain/sidecar )

# Copy the freshly generated .pb.go files into the package (preserving any
# hand-written types.go already present) and clean up the scratch tree.
mkdir -p "$PKG_ROOT/qorechain"
( cd "$GEN_TMP/.." && find qorechain -name '*.pb.go' -print0 ) | while IFS= read -r -d '' rel; do
  mkdir -p "$PKG_ROOT/$(dirname "$rel")"
  cp "$GEN_TMP/../$rel" "$PKG_ROOT/$rel"
done
rm -rf proto/packages

gofmt -w "$PKG_ROOT/qorechain"

echo "Generated Go protobuf modules into $PKG_ROOT/qorechain (hand-written types.go preserved)"
