#!/usr/bin/env bash
# Build reproducible, size-optimised contract binaries into ./artifacts with
# the CosmWasm optimizer (Docker). The chain checks uploaded code, and the
# optimizer's pinned toolchain produces Wasm it accepts.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="cosmwasm/optimizer:0.16.1"
if [ "$(uname -m)" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then
  # Native image for Apple silicon and other arm64 hosts. Build on x86_64 for
  # the canonical, reproducible checksum.
  IMAGE="cosmwasm/optimizer-arm64:0.16.1"
fi

docker run --rm \
  -v "$PWD":/code \
  --mount type=volume,source="qorechain_cw_target",target=/target \
  --mount type=volume,source="qorechain_cw_registry",target=/usr/local/cargo/registry \
  "$IMAGE"

ls -l artifacts
