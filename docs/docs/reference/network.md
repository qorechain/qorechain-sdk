---
id: network
title: Network & endpoints
sidebar_position: 1
---

# Network & endpoints reference

## Mainnet

| Field | Value |
| --- | --- |
| Network preset | `mainnet` |
| Chain id | `qorechain-vladi` (live) |
| Display token | `QOR` |
| Base denomination | `uqor` |
| Base units per QOR | `10^6` |
| Account bech32 prefix | `qor` |
| Validator bech32 prefix | `qorvaloper` |

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

## Targeting mainnet

Both presets ship the same localhost defaults; select `mainnet` and override the
endpoints with your node URLs:

```ts
const main = createClient({
  network: "mainnet",       // chain id qorechain-vladi
  endpoints: {
    rest: "https://rest.mainnet.example",
    rpc: "https://rpc.mainnet.example",
    evmRpc: "https://evm.mainnet.example",
  },
});
```

## Explorer & faucet URLs (config-driven)

`NetworkConfig` has two optional fields — `explorerUrl` and `faucetUrl` — that
are **undefined by default** on both presets. No public explorer or faucet
hostname is baked into the SDK; supply them through a network override when you
have confirmed URLs:

```ts
import {
  getNetwork,
  explorerTxUrl,
  requestFaucet,
} from "@qorechain/sdk";

const network = {
  ...getNetwork("testnet"),
  explorerUrl: "https://explorer.example",
  faucetUrl: "https://faucet.example",
};

const url = explorerTxUrl(network, txHash);      // https://explorer.example/tx/<hash>
await requestFaucet(network, "qor1...");          // POSTs to the faucet URL
```

`explorerTxUrl` / `explorerAddressUrl` / `explorerBlockUrl` and `requestFaucet`
throw a clear error when the corresponding URL is not configured. (For the SVM
runtime, `@qorechain/svm` exposes `requestAirdrop` directly.)
