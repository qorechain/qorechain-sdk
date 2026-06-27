# rollup-lifecycle

Drive an RDK rollup with the high-level `createRollupClient` helper: create →
submit batch → read status / latest batch → execute a withdrawal with a Merkle
proof.

Shows:

1. `createRollupClient(tx, { query, qor })` → an ergonomic, strongly-typed client
2. `createRollup({...})` → declare a rollup (profile + VM + stake)
3. `submitBatch({...})` → post a settlement batch, committing a `withdrawalsRoot`
4. `getRollupStatus` (`qor_`) / `getRollup` + `getLatestBatch` (typed) → reads
5. `executeWithdrawal({...})` → prove an L2→L1 withdrawal leaf and pay out

Every message is built and logged **offline**; broadcasting and the reads need a
node.

## Prerequisites

- A reachable **consensus RPC** (`QORE_RPC_URL`, default `:26657`), **REST**
  (`QORE_REST_URL`, default `:1317`), and **EVM JSON-RPC** (`QORE_EVM_RPC_URL`,
  default `:8545`, used for the `qor_*` reads).
- To broadcast (`QORE_BROADCAST=1`): a **funded account**. The default is the
  public BIP-39 test mnemonic, which is not funded on any real network.
- The withdrawal step needs a **finalized batch** whose `withdrawalsRoot` commits
  the leaf, plus a **real Merkle proof** — the placeholder proof here will be
  rejected on a live chain (reported cleanly).

> Never commit a real mnemonic. Treat `QORE_MNEMONIC` as a secret.

## Run

```bash
pnpm install
# Dry run — just builds + logs the messages (no node needed):
pnpm start

# Broadcast + read against a live node:
QORE_RPC_URL=https://rpc.testnet.example QORE_REST_URL=https://rest.testnet.example \
  QORE_EVM_RPC_URL=https://evm.testnet.example \
  QORE_MNEMONIC="<your funded testnet mnemonic>" QORE_BROADCAST=1 pnpm start
```

The SDK is the **app-developer** interaction surface (submit + read rollup txs).
**Operating** a rollup node (sequencer, prover, data availability) is the job of
the separate Rollup Development Kit — see the
[Rollups (RDK) guide](../../docs/docs/guides/rollups.md).
