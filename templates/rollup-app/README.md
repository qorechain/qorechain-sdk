# QoreChain rollup + multilayer starter

A minimal QoreChain app that drives a **rollup** and the **multilayer**
(sidechain / paychain) module with the high-level helpers from
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk):

- `createRollupClient(tx, { query, qor })` — create rollups, submit batches, run
  the challenge game, manage lifecycle, execute withdrawals, and read state.
- `createMultilayerClient(tx, { query })` — register sidechains/paychains, anchor
  state roots, route transactions, and read layers + routing stats.

By default `pnpm start` runs a **dry run**: it builds and logs the messages
without touching a node. Set `QORE_BROADCAST=1` (with a funded account) to
broadcast and read.

## Prerequisites

- **Node.js >= 20**.
- A reachable **consensus RPC** (`QORE_RPC_URL`, default `http://localhost:26657`),
  **REST** (`QORE_REST_URL`, default `:1317`), and **EVM JSON-RPC**
  (`QORE_EVM_RPC_URL`, default `:8545`, for the `qor_*` reads). Point them at
  testnet (`qorechain-diana`) or mainnet (`qorechain-vladi`).
- To broadcast: a **funded account** mnemonic (`QORE_MNEMONIC`). The default is
  the public BIP-39 test mnemonic, which is **not funded** on any real network.

> Never commit a real mnemonic. Treat `QORE_MNEMONIC` as a secret.

## Setup

```sh
# install dependencies (use the package manager you scaffolded with)
pnpm install

# dry run — build + log the messages, no node needed
pnpm start

# broadcast + read against a live node
QORE_RPC_URL=https://rpc-testnet.qore.host \
  QORE_MNEMONIC="<your funded testnet mnemonic>" QORE_BROADCAST=1 pnpm start
```

## Where to go next

- **App developers** interact with rollups through this SDK (submit + read txs).
- **Operating** a rollup node (sequencer, prover, data availability) is the job
  of the separate Rollup Development Kit. Build your app here; run the rollup
  there.

See the SDK docs for the
[Rollups (RDK)](https://github.com/qorechain/qorechain-sdk/blob/main/docs/docs/guides/rollups.md)
and
[Sidechains & Paychains](https://github.com/qorechain/qorechain-sdk/blob/main/docs/docs/guides/multilayer.md)
guides.
