# read-tokenomics

Read QoreChain tokenomics state through the typed `qor_*` JSON-RPC namespace
(`client.qor`), served over the EVM JSON-RPC endpoint:

- `client.qor.getBurnStats()` → `qor_getBurnStats`
- `client.qor.getXqorePosition(address)` → `qor_getXQOREPosition`
- `client.qor.getInflationRate()` → `qor_getInflationRate`

## Prerequisites

- A reachable QoreChain EVM JSON-RPC endpoint (`QORE_EVM_RPC_URL`, default
  `http://localhost:8545`) — the `qor_*` methods are served there.
- Optionally set `QORE_ADDRESS` for the xQORE position lookup.

The three reads are independent: each is reported even if the others are
unavailable on the node.

## Run

```bash
pnpm install
QORE_EVM_RPC_URL=https://evm-testnet.qore.host QORE_ADDRESS=qor1... pnpm start
```

Needs a live node to produce output.
