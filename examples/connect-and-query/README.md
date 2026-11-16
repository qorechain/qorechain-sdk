# connect-and-query

Create a `@qorechain/sdk` client and read public chain state:

- a native bank balance via `client.rest.getAllBalances(address)`
- burn statistics via `client.rest.getBurnStats()` and the total supply via
  `client.rest.get("/cosmos/bank/v1beta1/supply/by_denom", { denom: "uqor" })`

## Prerequisites

- A reachable QoreChain node. Set `QORE_REST_URL` (Native REST/LCD). With no
  env vars set, the example targets the testnet localhost default (`:1317`).
- Optionally set `QORE_ADDRESS` to the bech32 (`qor1...`) account you want to read.

Copy `.env.example` to `.env` and edit, or export the variables in your shell.

## Run

```bash
pnpm install
QORE_REST_URL=https://api-testnet.qore.host QORE_ADDRESS=qor1... pnpm start
```

This example needs a live node to produce output; if none is reachable it prints
a hint and exits non-zero.
