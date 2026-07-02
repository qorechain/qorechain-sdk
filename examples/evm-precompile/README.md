# evm-precompile

Use `@qorechain/evm` (a thin, type-safe layer over [viem](https://viem.sh)) to:

- create an EVM client (`createEvmClient`) — the numeric EVM chain id is
  auto-detected via `eth_chainId`
- call read-only precompiles: `precompiles.rlConsensusParams` (live consensus
  parameters) and `precompiles.pqcKeyStatus` (PQC key registration status)
- read an ERC-20 balance with `erc20.balanceOf`

All calls are read-only `eth_call`s.

## Prerequisites

- A reachable QoreChain EVM JSON-RPC endpoint (`QORE_EVM_RPC_URL`, default
  `http://localhost:8545`).
- The precompiles only exist on QoreChain network nodes. On a plain EVM node the
  precompile reads throw "feature not present"; the example reports that
  per-call and continues.
- Optionally set `QORE_ERC20_TOKEN` to an ERC-20 contract address to read a
  balance, and `QORE_EVM_ADDRESS` to the account to query.

## Run

```bash
pnpm install
QORE_EVM_RPC_URL=https://evm-testnet.qore.host QORE_EVM_ADDRESS=0xYourAddress pnpm start
```

Needs a live EVM endpoint to produce meaningful output.
