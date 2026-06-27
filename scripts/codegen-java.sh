#!/usr/bin/env bash
#
# Reproducible protobuf-java codegen for the QoreChain Java SDK.
#
# Generates standard protobuf-java message classes for:
#   - every QoreChain module proto (proto/qorechain/**), and
#   - the Cosmos dependency protos the SDK references at runtime: the bank
#     MsgSend, the tx wire types (TxBody/TxRaw/AuthInfo/SignDoc), signing enums,
#     the secp256k1/multisig pubkeys, Coin, and the option-extension files
#     (gogoproto, cosmos_proto, amino, cosmos.msg) needed for descriptor links.
#
# The well-known types (google/protobuf/**) are NOT generated — they map onto the
# classes already shipped in the `protobuf-java` runtime jar.
#
# The generated Java is COMMITTED under packages/java/src/main/codegen so consumers
# never need buf/protoc. Re-run this script (with `buf` installed) only when the
# vendored protos change.
#
# Requires: buf (>=1.47), network access to the public schema registry.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$REPO_ROOT/proto"
JAVA_SRC="$REPO_ROOT/packages/java/src/main/codegen"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

VENDOR="$WORK/vendor"
mkdir -p "$VENDOR"

echo "==> Exporting QoreChain protos + their direct deps"
buf export "$PROTO_DIR" --output "$VENDOR"

echo "==> Exporting Cosmos tx/crypto/bank protos from the schema registry"
buf export buf.build/cosmos/cosmos-sdk \
  --path cosmos/tx/v1beta1/tx.proto \
  --path cosmos/tx/signing/v1beta1/signing.proto \
  --path cosmos/crypto/secp256k1/keys.proto \
  --path cosmos/crypto/multisig/keys.proto \
  --path cosmos/crypto/multisig/v1beta1/multisig.proto \
  --path cosmos/bank/v1beta1/tx.proto \
  --path cosmos/bank/v1beta1/bank.proto \
  --path cosmos/base/query/v1beta1/pagination.proto \
  --output "$VENDOR"

echo "==> Generating protobuf-java"
GEN="$WORK/gen"
mkdir -p "$GEN"
cat > "$WORK/buf.gen.yaml" <<'EOF'
version: v2
clean: false
plugins:
  - remote: buf.build/protocolbuffers/java
    out: gen
EOF

# Build a buf module over the merged vendor tree and generate everything except
# the well-known types (which protobuf-java provides).
( cd "$VENDOR" && cat > buf.yaml <<'EOF'
version: v2
modules:
  - path: .
EOF
  buf generate --template "$WORK/buf.gen.yaml" \
    --path qorechain \
    --path cosmos/base/v1beta1/coin.proto \
    --path cosmos/msg \
    --path cosmos/tx \
    --path cosmos/crypto \
    --path cosmos/bank/v1beta1/tx.proto \
    --path cosmos/bank/v1beta1/bank.proto \
    --path cosmos/base/query/v1beta1/pagination.proto \
    --path cosmos_proto \
    --path gogoproto \
    --path amino \
    --output "$WORK"

  # google.api.{annotations,http} must be generated in a dedicated pass: when
  # bundled with the other --path roots above, buf treats them as import-only
  # transitive deps and prunes their Java output. Modules whose query.proto
  # carries (google.api.http) route annotations (e.g. bridge) reference the
  # com.google.api.AnnotationsProto extension registry, so it must exist.
  buf generate --template "$WORK/buf.gen.yaml" \
    --path google/api/annotations.proto \
    --path google/api/http.proto \
    --output "$WORK" )

echo "==> Copying generated Java into the committed source tree"
# Drop any accidental google/protobuf output (provided by protobuf-java runtime).
rm -rf "$GEN/google"
mkdir -p "$JAVA_SRC"
# Replace the generated packages wholesale; hand-written code lives in other
# packages (io.github.qorechain.*) and is untouched.
for pkg in qorechain cosmos cosmos_proto amino; do
  if [ -d "$GEN/$pkg" ]; then
    rm -rf "${JAVA_SRC:?}/$pkg"
    cp -R "$GEN/$pkg" "$JAVA_SRC/$pkg"
  fi
done

# gogoproto declares java_package = com.google.protobuf, so its extension
# registry lands at com/google/protobuf/GoGoProtos.java. Copy ONLY that single
# file — never the rest of com/google/protobuf (that is the protobuf-java
# runtime, not generated code).
if [ -f "$GEN/com/google/protobuf/GoGoProtos.java" ]; then
  mkdir -p "$JAVA_SRC/com/google/protobuf"
  cp "$GEN/com/google/protobuf/GoGoProtos.java" "$JAVA_SRC/com/google/protobuf/GoGoProtos.java"
fi

# google.api.{annotations,http} declare java_package = com.google.api, so their
# generated extension/descriptor classes land under com/google/api. They are
# referenced by modules whose query.proto carries (google.api.http) route
# annotations (e.g. the bridge Query service), and are NOT part of the
# protobuf-java runtime — so the generated sources are committed here.
if [ -d "$GEN/com/google/api" ]; then
  rm -rf "$JAVA_SRC/com/google/api"
  mkdir -p "$JAVA_SRC/com/google/api"
  cp -R "$GEN/com/google/api/." "$JAVA_SRC/com/google/api/"
fi

echo "==> Done. Generated Java committed under $JAVA_SRC"
