---
id: architecture
title: Architecture & concepts
sidebar_position: 1
---

# Architecture & concepts

QoreChain is a single Layer 1 chain that runs three smart-contract virtual
machines side by side, with shared accounts and a shared token.

## The triple-VM model

| VM | Contracts | Client surface in the SDK |
| --- | --- | --- |
| **CosmWasm** | Rust/Wasm contracts | `client.cosmwasm()` and the `queryContractSmart` / `execute` helpers in `@qorechain/sdk` |
| **QoreChain EVM Engine** | Solidity / Vyper | `@qorechain/evm` (a viem adapter) |
| **SVM** | Solana programs | `@qorechain/svm` (a `@solana/web3.js` adapter) |

The native (Cosmos) layer handles bank transfers, staking, governance, and the
`x/crossvm` module that routes messages between runtimes.

## Read surfaces

The SDK talks to a node through several endpoints:

- **Cosmos REST (LCD)** — bank balances, account info, module queries.
- **Consensus RPC** — used for signing/broadcasting native transactions and for
  the CosmWasm read client.
- **EVM JSON-RPC** — standard `eth_*` calls plus the QoreChain `qor_*`
  namespace and the EVM precompiles.
- **SVM JSON-RPC** — Solana-compatible RPC for the SVM runtime.

The `qor_*` JSON-RPC namespace exposes QoreChain-specific reads such as
tokenomics, PQC key status, hybrid-signature mode, cross-VM messages, and
network statistics. In TypeScript these are typed methods on `client.qor`
(`QorClient`); the same surface exists in the Python, Go, and Rust SDKs.

## Tokens & denominations

- Display token: **QOR**.
- Base denomination: **uqor**, with **10^6** base units per QOR.

Always do money math in base units. The SDK provides exact conversions so you
never lose precision to floating point:

```ts
import { toBase, fromBase } from "@qorechain/sdk";

toBase("1.5");        // "1500000"  (QOR -> uqor)
fromBase("1500000");  // "1.5"      (uqor -> QOR)
```

> Note: the EVM runtime represents QOR with 18 decimals (the EVM convention),
> which is distinct from the Cosmos `uqor` base of 10^6. The `@qorechain/evm`
> client defaults to 18 decimals for display. Confirm the value for your target
> network.

## Addresses

The same key material can be expressed in three address formats:

- **native** — bech32 with the `qor` prefix (`qor1…`), validators use
  `qorvaloper`.
- **EVM** — `0x…`, EIP-55 checksummed.
- **SVM** — base58 of the ed25519 public key.

See [Accounts & PQC signing](accounts-pqc.md) for the derivation paths.

## Cross-VM

QoreChain's `x/crossvm` module lets contracts on one VM trigger actions on
another. The EVM→native path runs on-chain through the **cross-VM bridge
precompile** (`@qorechain/evm`), and the SDK provides typed REST read helpers
(`getCrossVmMessage`, `getPendingCrossVmMessages`, `getCrossVmParams`) plus
`client.qor.getCrossVMMessage(...)` to track message state. See the
[cross-VM guide](../guides/cross-vm.md).
