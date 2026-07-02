# connect-and-query

Create a `@qorechain/sdk` client and read public chain state:

- a native bank balance via `client.rest.getAllBalances(address)`
- the aggregate tokenomics snapshot via `client.qor.getTokenomicsOverview()`

## Prerequisites

- A reachable QoreChain node. Set `QORE_REST_URL` (Cosmos REST/LCD) and
  `QORE_EVM_RPC_URL` (EVM JSON-RPC, which serves the `qor_*` namespace). With no
  env vars set, the example targets the testnet localhost defaults
  (`:1317` and `:8545`).
- Optionally set `QORE_ADDRESS` to the bech32 (`qor1...`) account you want to read.

Copy `.env.example` to `.env` and edit, or export the variables in your shell.

## Run

```bash
pnpm install
QORE_REST_URL=https://api-testnet.qore.host QORE_EVM_RPC_URL=https://evm-testnet.qore.host \
  QORE_ADDRESS=qor1... pnpm start
```

This example needs a live node to produce output; if none is reachable it prints
a hint and exits non-zero.
