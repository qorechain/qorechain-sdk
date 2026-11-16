# read-tokenomics

Read QoreChain tokenomics state over the REST (LCD) API with `client.rest`:

- `client.rest.getBurnStats()` → `/qorechain/burn/v1/stats` (total burned, by source)
- `client.rest.get("/qorechain/inflation/v1/epoch_info")` → the current inflation
  epoch, rate and emission totals
- `client.rest.get("/qorechain/inflation/v1/params")` → the inflation schedule
- `client.rest.get("/cosmos/bank/v1beta1/supply/by_denom", { denom: "uqor" })` →
  total supply

## Prerequisites

- A reachable QoreChain REST endpoint (`QORE_REST_URL`, default
  `http://localhost:1317`).

The reads are independent: each is reported even if the others are
unavailable on the node.

## Run

```bash
pnpm install
QORE_REST_URL=https://api-testnet.qore.host pnpm start
```

Needs a live node to produce output.
