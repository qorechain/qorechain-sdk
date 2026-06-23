# cosmwasm-query

Run a read-only smart query against a deployed CosmWasm contract on QoreChain.

Shows:

- `client.cosmwasm()` → a read-only `CosmWasmClient` (connects over the RPC endpoint)
- `getContractInfo(cw, address)` → the contract's on-chain metadata
- `queryContractSmart(cw, address, queryMsg)` → a smart query

## Prerequisites

- A reachable consensus RPC (`QORE_RPC_URL`, default `http://localhost:26657`).
- **A deployed contract**: set `QORE_CONTRACT` to its `qor1...` address.
- A query message matching that contract's schema. The default is a CW20
  `{"token_info":{}}` query; override with `QORE_QUERY_MSG` (JSON).

## Run

```bash
pnpm install
QORE_RPC_URL=https://rpc.testnet.example \
  QORE_CONTRACT=qor1...contract... \
  QORE_QUERY_MSG='{"balance":{"address":"qor1..."}}' \
  pnpm start
```

Needs a live node and a deployed contract to produce output.
