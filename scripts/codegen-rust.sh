#!/usr/bin/env bash
# Generate prost message types from the vendored QoreChain protos for the Rust
# SDK.
#
# Uses `buf generate` with protoc-gen-prost. The emitted message types implement
# prost::Message, so they pack into a cosmrs::Any { type_url, value } with
# value = msg.encode_to_vec() exactly like the chain's own types — this is what
# lets a custom Msg ride in a tx Any and decode back (composer round-trip test).
#
# Dependency protos (the SDK coin type, gogoproto, cosmos_proto, well-known
# types) are resolved from the public schema registry (proto/buf.yaml deps), so a
# maintainer running codegen needs no local dependency protos. They are NOT
# re-emitted: prost `extern_path` remaps the Cosmos coin import to the type
# already re-exported by the `cosmrs` crate, and gogoproto / cosmos_proto carry
# only field options (no referenced message types).
#
# Query services are exposed by the SDK over the JSON-RPC `abci_query` transport
# (src/query/typed.rs) using the prost request/response types generated here, so
# the crate keeps a lean reqwest-only dependency surface (no tonic).
#
# Output (packages/rust/src/proto/*.rs) is COMMITTED — one flat file per package
# (qorechain.<module>.v1.rs) plus a generated mod.rs — so consumers `cargo add
# qorechain` and get the typed messages without running buf/protoc.
#
# Prereqs (maintainer only): `buf`, plus the prost plugin on PATH:
#   cargo install protoc-gen-prost
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v buf >/dev/null 2>&1; then
  echo "ERROR: 'buf' not found on PATH. Install from https://buf.build." >&2
  exit 1
fi
if ! command -v protoc-gen-prost >/dev/null 2>&1; then
  echo "ERROR: 'protoc-gen-prost' not found on PATH." >&2
  echo "  cargo install protoc-gen-prost" >&2
  exit 1
fi

OUT_ROOT="packages/rust/src/proto"
GEN_TMP="proto/gen"

rm -rf "$GEN_TMP" "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

# Generate only the qorechain chain modules (their dep types are imported, not
# emitted). The `sidecar` package is an off-chain gRPC service definition, not a
# tx/query module, so it is excluded from the SDK surface (mirrors codegen.sh).
( cd proto && buf generate --template buf.gen.rust.yaml \
    --path qorechain \
    --exclude-path qorechain/sidecar )

# protoc-gen-prost writes one flat file per proto package, named
# `qorechain.<module>.v1.rs`, under the proto-mirroring tree at the plugin `out:`
# root (proto/gen/qorechain/<module>/v1/). Flatten them into the committed proto
# dir and generate the mod.rs that re-exports each package as a nested module
# path (qorechain::amm::v1, …).
mods=""
while IFS= read -r f; do
  base="$(basename "$f")"
  # protoc-gen-prost derives Eq + Hash on every message, but messages that embed
  # the extern Cosmos `Coin` (which derives neither) won't compile with those
  # bounds. Strip `Eq` and `Hash` from the generated derive lines so every
  # message derives only the portable set (Clone, PartialEq, prost::Message).
  sed -E 's/, Eq//g; s/, Hash//g' "$f" > "$OUT_ROOT/$base"
  mods="$mods$base
"
done < <(find "$GEN_TMP" -name 'qorechain.*.rs' | sort)
rm -rf "$GEN_TMP"

if [ -z "$mods" ]; then
  echo "ERROR: no generated files found under $GEN_TMP" >&2
  exit 1
fi

# Emit mod.rs: a hand-free wiring of the flat package files into the
# qorechain::<module>::v1 module tree via prost-style include nesting.
MOD="$OUT_ROOT/mod.rs"
{
  echo "//! Generated prost types for the QoreChain custom modules."
  echo "//!"
  echo "//! Produced by \`scripts/codegen-rust.sh\` (buf + protoc-gen-prost) from"
  echo "//! \`proto/qorechain/**\`. Each module's messages implement \`prost::Message\`"
  echo "//! and pack into a \`cosmrs::Any\` via \`encode_to_vec()\`. Do not edit by hand."
  echo "#![allow(missing_docs, clippy::all)]"
  echo "/// Generated QoreChain protobuf modules."
  echo "pub mod qorechain {"
  # Collect distinct module names (the segment between qorechain. and .v1).
  modules=""
  while IFS= read -r base; do
    [ -z "$base" ] && continue
    module="${base#qorechain.}"
    module="${module%.v1.rs}"
    modules="$modules$module
"
  done <<EOF
$mods
EOF
  for module in $(printf '%s' "$modules" | sort -u); do
    echo "    /// \`qorechain.$module.v1\` generated types."
    echo "    pub mod $module {"
    echo "        /// \`qorechain.$module.v1\` generated types."
    echo "        pub mod v1 {"
    echo "            include!(\"qorechain.$module.v1.rs\");"
    echo "        }"
    echo "    }"
  done
  echo "}"
} > "$MOD"

echo "Generated Rust prost modules into $OUT_ROOT:"
ls -1 "$OUT_ROOT"
