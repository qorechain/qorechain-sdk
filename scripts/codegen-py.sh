#!/usr/bin/env bash
# Generate Python protobuf message classes from the vendored QoreChain protos.
#
# Uses `buf generate` with the public-registry `protocolbuffers/python` and
# `protocolbuffers/pyi` plugins (pinned to the v29 line so the emitted gencode
# targets the protobuf 5.29.x runtime the SDK depends on). Dependency protos
# (coin/msg types, gogoproto, cosmos-proto, well-known types) are resolved from
# the public schema registry declared in proto/buf.yaml, so they do NOT need to
# be vendored locally.
#
# The Cosmos / cosmos_proto / gogoproto dependency descriptors are NOT re-emitted
# as a second copy. Instead, this script rewrites the generated cross-package
# imports to point at the equivalents bundled with `cosmpy` (cosmpy.protos.*),
# so the generated modules register into cosmpy's single descriptor pool — that
# is what lets them pack/unpack cleanly through cosmpy's `Any`. Well-known-type
# imports (google.protobuf.*) are left untouched.
#
# Output (packages/py/src/qorechain/proto/qorechain/**) is COMMITTED: users
# `pip install qorechain-sdk` and get the typed messages without running protoc/buf.
#
# Prereqs (maintainer only): `buf` on PATH and a Python 3 interpreter.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v buf >/dev/null 2>&1; then
  echo "ERROR: 'buf' not found on PATH. Install from https://buf.build." >&2
  exit 1
fi

PKG_ROOT="packages/py/src/qorechain/proto"
GEN_TMP="proto/packages/py/src/qorechain/proto"

rm -rf "$PKG_ROOT" "proto/packages"

# Generate only the qorechain chain modules (their dep types are imported, not
# emitted). The `sidecar` package is an off-chain gRPC service definition, not a
# tx/query module, so it is excluded from the SDK surface (mirrors codegen.sh).
( cd proto && buf generate --template buf.gen.py.yaml \
    --path qorechain \
    --exclude-path qorechain/sidecar )

# Relocate buf's output (it is written relative to proto/) into the package and
# clean up the scratch tree buf created.
mkdir -p "$(dirname "$PKG_ROOT")"
mv "$GEN_TMP" "$PKG_ROOT"
rm -rf proto/packages

# Rewrite dependency imports to cosmpy's bundled protos so they share one
# descriptor pool. These are the ONLY non-google cross-package deps the
# qorechain modules reference.
python3 - "$PKG_ROOT" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])

# Map "<dep package> import" -> "cosmpy.protos.<dep package> import".
DEP_PREFIXES = (
    "cosmos.base.v1beta1",
    "cosmos.msg.v1",
    "cosmos_proto",
    "gogoproto",
)

patterns = [
    (re.compile(rf"^from {re.escape(p)} import ", re.MULTILINE), f"from cosmpy.protos.{p} import ")
    for p in DEP_PREFIXES
]

for path in root.rglob("*_pb2.py"):
    text = path.read_text()
    for pat, repl in patterns:
        text = pat.sub(repl, text)
    path.write_text(text)

# Make every directory in the generated tree an importable package.
for directory in [root, *(d for d in root.rglob("*") if d.is_dir())]:
    init = directory / "__init__.py"
    if not init.exists():
        init.write_text('"""Generated QoreChain protobuf modules."""\n')
PY

echo "Generated Python protobuf modules into $PKG_ROOT"
