---
id: network
title: Network & endpoints
sidebar_position: 1
---

# Network & endpoints reference

## Testnet

| Field | Value |
| --- | --- |
| Network preset | `testnet` |
| Chain id | `qorechain-diana` (live) |
| Display token | `QOR` |
| Base denomination | `uqor` |
| Base units per QOR | `10^6` |
| Account bech32 prefix | `qor` |
| Validator bech32 prefix | `qorvaloper` |

## Default ports

`createClient()` uses these localhost ports by default. Override `endpoints` to
point at a real node.

| Endpoint | Port | Purpose |
| --- | --- | --- |
| Cosmos REST (LCD) | `1317` | bank balances, account info, module queries |
| gRPC | `9090` | gRPC queries |
| Consensus RPC | `26657` | signing/broadcasting native txs, CosmWasm reads |
| EVM JSON-RPC | `8545` | `eth_*`, `qor_*`, precompiles |
| EVM JSON-RPC (WS) | `8546` | EVM WebSocket subscriptions |
| SVM JSON-RPC | `8899` | Solana-compatible RPC |

Example with explicit endpoints:

```ts
import { createClient } from "@qorechain/sdk";

const client = createClient({
  endpoints: {
    rest: "https://rest.testnet.example",   // REST (LCD)
    rpc: "https://rpc.testnet.example",      // consensus RPC
    evmRpc: "https://evm.testnet.example",   // EVM + qor_ JSON-RPC
    evmWs: "wss://evm.testnet.example",      // EVM WebSocket
  },
});
```

The SDK exposes network presets and lookup helpers (exported from the networks
module) so you can list and resolve networks programmatically. In Python/Go/Rust
the equivalents are `create_client` / `CreateClient` / `ClientBuilder` plus the
`networks` module.

## Mainnet

Mainnet is **not yet live**. When it launches you will target it with a custom
chain id and endpoints:

```ts
const main = createClient({
  network: "mainnet",
  chainId: "...",          // assigned at launch
  endpoints: { /* ... */ }, // required — no built-in mainnet endpoints yet
});
```
