# ai-preflight

Score a transaction with QoreChain's **on-chain AI** before you send it — a
first-in-industry capability. Uses `@qorechain/evm` (a thin, type-safe layer over
[viem](https://viem.sh)) to:

- create an EVM client (`createEvmClient`) — the numeric EVM chain id is
  auto-detected via `eth_chainId`
- run a one-call pre-flight with `simulateWithRiskScore` — gas estimate
  (`eth_estimateGas`) + risk score + anomaly check + an advisory `safe` verdict
- call the building blocks directly: `aiRiskScore` and `aiAnomalyCheck`

Everything is a read-only `eth_call` / `eth_estimateGas`, so nothing is signed or
broadcast. The `safe` flag is **advisory** (`level < 3 && !flagged` by default) —
set and enforce your own policy in production.

## Prerequisites

- A reachable QoreChain EVM JSON-RPC endpoint (`QORE_EVM_RPC_URL`, default
  `http://localhost:8545`).
- The AI precompiles only exist on QoreChain network nodes. On a plain EVM node
  the reads throw "feature not present"; the example reports that per-call and
  continues.
- Optional: `QORE_EVM_ADDRESS` (sender), `QORE_EVM_TO` (destination),
  `QORE_EVM_DATA` (calldata, defaults to a sample ERC-20 `transfer`), and
  `QORE_EVM_VALUE` (wei).

## Run

```bash
pnpm install
QORE_EVM_RPC_URL=https://evm-testnet.qore.host QORE_EVM_ADDRESS=0xYourAddress pnpm start
```

Needs a live EVM endpoint to produce meaningful output.
