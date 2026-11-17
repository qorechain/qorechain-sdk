#!/usr/bin/env bash
# Run the SDK examples against one network and fail if any of them fails.
#
# Required environment:
#   QORE_RPC_URL      consensus RPC (http(s):// or ws(s)://)
#   QORE_REST_URL     REST (LCD) endpoint
#   QORE_EVM_RPC_URL  EVM JSON-RPC endpoint
#   QORE_CHAIN_ID     chain id of the network
#   QORE_MNEMONIC     a FUNDED test mnemonic (never printed)
# Optional:
#   QORE_EVM_CONTRACT an ERC-20 the account holds; when set, cross-vm-call also broadcasts
#   QORE_SVM_RPC_URL  SVM RPC for svm-transfer
#   QORE_CONTRACT     a deployed CosmWasm contract for cosmwasm-query (skipped when unset)
#   EXAMPLE_TIMEOUT   seconds per example (default 180)
#   EXAMPLES_LOG_DIR  where the per-example logs go (default: a new temp dir)
#
# Usage: QORE_RPC_URL=... QORE_REST_URL=... QORE_EVM_RPC_URL=... QORE_CHAIN_ID=... QORE_MNEMONIC=... ./examples/run-all.sh
set -uo pipefail
set +x

here="$(cd "$(dirname "$0")" && pwd)"
missing=()
for v in QORE_RPC_URL QORE_REST_URL QORE_EVM_RPC_URL QORE_CHAIN_ID QORE_MNEMONIC; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "missing environment: ${missing[*]}" >&2
  exit 2
fi
export QORE_RPC_URL QORE_REST_URL QORE_EVM_RPC_URL QORE_CHAIN_ID QORE_MNEMONIC

timeout_s="${EXAMPLE_TIMEOUT:-180}"
logs="${EXAMPLES_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/qore-examples.XXXXXX")}"
mkdir -p "$logs"

# Run a command with a time limit (portable: macOS has no `timeout` by default).
with_timeout() {
  perl -e 'my $t = shift; $SIG{ALRM} = sub { kill "TERM", -$$; exit 124 }; alarm $t; my $pid = fork;
           if ($pid == 0) { setpgrp; exec @ARGV or exit 127 } waitpid $pid, 0; exit($? >> 8)' "$timeout_s" "$@"
}

# Send to our own account, so the run never moves funds to a third party.
self_address="$(cd "$here/send-qor" && node --input-type=module -e '
  import { deriveNativeAccount } from "@qorechain/sdk";
  console.log((await deriveNativeAccount(process.env.QORE_MNEMONIC)).address);' 2>/dev/null)"
if [ -z "$self_address" ]; then
  echo "cannot derive the test account from QORE_MNEMONIC (is the workspace installed and built? pnpm install && pnpm -r build)" >&2
  exit 2
fi

https_rpc="$(printf '%s' "$QORE_RPC_URL" | sed -e 's#^wss://#https://#' -e 's#^ws://#http://#')"
cross_vm_broadcast=""
[ -n "${QORE_EVM_CONTRACT:-}" ] && cross_vm_broadcast="1"

# name | example dir | extra environment
runs=(
  "connect-and-query|connect-and-query|QORE_ADDRESS=$self_address"
  "read-tokenomics|read-tokenomics|"
  "pqc-hybrid-sign|pqc-hybrid-sign|"
  "unified-wallet|unified-wallet|"
  "send-qor|send-qor|QORE_RECIPIENT=$self_address QORE_AMOUNT=0.01"
  "cross-vm-call|cross-vm-call|QORE_BROADCAST=$cross_vm_broadcast"
  "evm-precompile|evm-precompile|"
  "ai-preflight|ai-preflight|"
  "evm-nft|evm-nft|"
  "cosmwasm-query|cosmwasm-query|"
  "svm-transfer|svm-transfer|"
  "subscribe-blocks|subscribe-blocks|"
  "subscribe-blocks (http URL)|subscribe-blocks|QORE_RPC_URL=$https_rpc"
)

failed=0
skipped=0
printf '%-30s %s\n' "example" "result"
for run in "${runs[@]}"; do
  IFS='|' read -r name dir extra <<<"$run"
  log="$logs/$(printf '%s' "$name" | tr ' ()' '___').log"
  if [ "$dir" = "cosmwasm-query" ] && [ -z "${QORE_CONTRACT:-}" ]; then
    printf '%-30s %s\n' "$name" "SKIP (set QORE_CONTRACT to a deployed contract)"
    skipped=$((skipped + 1))
    continue
  fi
  (
    cd "$here/$dir" || exit 127
    # Each extra is NAME=value; export them one by one. A bare `export` would
    # print the whole environment (the mnemonic included) into the log.
    for kv in $extra; do export "$kv"; done
    with_timeout npx tsx index.ts
  ) >"$log" 2>&1
  rc=$?
  if [ $rc -eq 0 ]; then
    printf '%-30s %s\n' "$name" "PASS"
  else
    failed=$((failed + 1))
    reason="exit $rc"
    [ $rc -eq 124 ] && reason="timed out after ${timeout_s}s"
    printf '%-30s %s (%s, log: %s)\n' "$name" "FAIL" "$reason" "$log"
  fi
done

echo
ran=$(( ${#runs[@]} - skipped ))
echo "$(( ran - failed ))/$ran passed, $skipped skipped; logs in $logs"
# Never leave the mnemonic in a log, whatever an example printed.
if grep -rqF -- "$QORE_MNEMONIC" "$logs" 2>/dev/null; then
  echo "a log contained the mnemonic; deleting the logs" >&2
  rm -rf "$logs"
  exit 3
fi
[ $failed -eq 0 ]
