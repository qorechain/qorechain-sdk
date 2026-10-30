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

## Presets and their endpoints

From SDK 0.12.0, `mainnet` and `testnet` point at the public QoreChain
endpoints, and `localnet` keeps the localhost ports every preset used before.
`createClient()` with no options is `testnet`.

| Endpoint | `mainnet` | `testnet` | `localnet` |
| --- | --- | --- | --- |
| Native REST (LCD) `rest` | `https://api.qore.host` | `https://api-testnet.qore.host` | `http://localhost:1317` |
| Consensus RPC `rpc` | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` | `http://localhost:26657` |
| EVM JSON-RPC `evmRpc` | `https://evm.qore.host` (EVM chain id 9801) | `https://evm-testnet.qore.host` (9800) | `http://localhost:8545` |
| EVM WebSocket `evmWs` | not set | `wss://evm-ws-testnet.qore.host` | `ws://localhost:8546` |
| gRPC `grpc` | not set | not set | `http://localhost:9090` |
| SVM JSON-RPC `svmRpc` | not set | not set | `http://localhost:8899` |
| Chain id | `qorechain-vladi` | `qorechain-diana` | `qorechain-devnet` |

The table is the SDK's own preset list (`PUBLIC_ENDPOINTS` and
`LOCALNET_ENDPOINTS` in TypeScript; the networks module in Python, Go, Rust and
Java), so it is the one place to read them from in code.

- **Not set** means the network has no public endpoint of that kind. Code that
  needs one (an EVM subscription on mainnet, a gRPC client, an SVM client)
  fails with an error that names the endpoint to pass, instead of falling back
  to localhost. SVM transactions are not open on either network, so no preset
  sets an SVM endpoint.
- The testnet endpoints carry a per-IP rate limit at the edge. Production
  traffic should run or use its own node and pass it in `endpoints`.
- `https://download.qore.host/<net>/latest.json` is a release manifest
  (version, peers, state sync), not an API endpoint.
- The consensus RPC also answers WebSocket subscriptions at
  `wss://rpc.qore.host/websocket` and `wss://rpc-testnet.qore.host/websocket`.

Override any endpoint, or use your own node, with `endpoints`; the rest keep
the preset's values:

```ts
import { createClient } from "@qorechain/sdk";

const main = createClient({ network: "mainnet" }); // public endpoints
const mine = createClient({
  network: "mainnet",
  endpoints: { rest: "https://lcd.my-node.example", rpc: "https://rpc.my-node.example" },
});
const local = createClient({ network: "localnet" }); // a node on this machine
```

The SDK exposes the presets and lookup helpers (`getNetwork`, `listNetworks`,
`NETWORKS`) so you can list and resolve networks programmatically. In
Python/Go/Rust/Java the equivalents are `create_client` / `CreateClient` /
`ClientBuilder` / `Networks` plus the `networks` module.

## Which chain release is a network on?

Nodes do not report their binary version: `application_version` in
`node_info` is empty on purpose, so a node cannot be fingerprinted by release.
Detect features instead:

- **By upgrade plan name.** `GET /cosmos/upgrade/v1beta1/applied_plan/<name>`
  answers the height at which a plan was applied (`"0"` when it was not). Ask
  for EVERY plan name that brings the feature, since networks differ:
  - mainnet has applied `v3.2.5` (height 3,906,833);
  - testnet has applied `v3.2.5` and `v3.2.6`;
  - sign-bytes v2 arrived with `v3.2.0` on mainnet and `v3.1.98` on testnet.

  The SDK does this for you: `isUpgradeApplied({ rest, upgrade: CHAIN_UPGRADE_V3_2_5 })`
  (TypeScript; `is_upgrade_applied` in Python, and the equivalents in Go, Rust
  and Java) caches the answer per endpoint.
- **By feature switch** (from v3.2.4): `fetchProtocolFeatures` lists the
  consensus rules a network enforces, by name.
- **For people, not code:** the release a network runs is the `.version` of
  `https://download.qore.host/mainnet/latest.json` or
  `https://download.qore.host/testnet/latest.json`.

## Explorer & faucet URLs (config-driven)

`NetworkConfig` has two optional fields - `explorerUrl` and `faucetUrl` - that
are **undefined by default** on every preset. No public explorer or faucet
hostname is baked into the SDK; supply them through a network override. The
public explorer lives at **https://explore.qore.network**:

```ts
import {
  getNetwork,
  explorerTxUrl,
  requestFaucet,
} from "@qorechain/sdk";

const network = {
  ...getNetwork("testnet"),
  explorerUrl: "https://explore.qore.network",
  faucetUrl: "https://faucet.example", // supply your confirmed faucet URL
};

const url = explorerTxUrl(network, txHash);      // https://explore.qore.network/tx/<hash>
await requestFaucet(network, "qor1...");          // POSTs to the faucet URL
```

`explorerTxUrl` / `explorerAddressUrl` / `explorerBlockUrl` and `requestFaucet`
throw a clear error when the corresponding URL is not configured. (For the SVM
runtime, `@qorechain/svm` exposes `requestAirdrop` directly.)
