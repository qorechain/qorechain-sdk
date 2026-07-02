---
id: faq
title: FAQ & troubleshooting
sidebar_position: 9
---

# FAQ & troubleshooting

## Is mainnet live?

Yes. Mainnet is **live** (chain id `qorechain-vladi`). The testnet preset
(`qorechain-diana`) also remains available. Both presets ship localhost endpoint
defaults; select the network with `createClient({ network: "mainnet" })` and
override `endpoints` with your node URLs. See
[Network & endpoints](reference/network.md).

## Why do my calls hit localhost?

`createClient()` defaults to **localhost** endpoints. To talk to a real node,
pass an `endpoints` object:

```ts
const client = createClient({
  endpoints: {
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host",
  },
});
```

The signing path (`connectTx`) needs the consensus **`rpc`** endpoint; CosmWasm
reads also use it. REST reads use `rest`; EVM and `qor_` calls use `evmRpc`.

## "Cannot find module 'viem'" / "'@solana/web3.js'"

These are **peer dependencies** of `@qorechain/evm` and `@qorechain/svm`
respectively. Install them in your project:

```bash
npm i @qorechain/evm viem
npm i @qorechain/svm @solana/web3.js
```

## A precompile call throws "feature not present"

The EVM precompiles exist only on nodes running the QoreChain EVM Engine. On a
plain EVM node those calls fail. If you target heterogeneous nodes, wrap each
precompile call and handle the error per-call.

## My amounts are off by a factor of a million

QOR has **10^6** base `uqor` units. Use `toBase` / `fromBase` and do all math in
base units:

```ts
toBase("1.5");       // "1500000"
fromBase("1500000"); // "1.5"
```

Note the EVM runtime represents QOR with **18** decimals (EVM convention), which
is distinct from the Cosmos `uqor` base of 10^6.

## A package isn't on npm / PyPI / crates.io yet

The TypeScript core (`@qorechain/sdk`) is published. The EVM/SVM adapters and the
Python, Go, and Rust packages are **publish-pending**. Until they publish, build
them from the [monorepo](https://github.com/qorechain/qorechain-sdk), and use the
CLI's `--local` flag to point a scaffolded project at the workspace packages.

## My mnemonic is rejected

The SDK validates both the BIP-39 wordlist **and** the checksum before deriving
any key, so a typo'd phrase raises instead of silently producing the wrong
account. Re-check the words; use `validateMnemonic` to test a phrase.

## Hybrid (PQC) transactions

Local ML-DSA-87 sign/verify and the hybrid tx-building helpers are available
today. Before a hybrid tx PQC-verifies on-chain, the signer's PQC public key
must be registered (`MsgRegisterPQCKeyV2`), or you must set
`includePqcPublicKey: true` to embed it for auto-registration. Full hybrid
submission is being finalized for the live network. See
[Accounts & PQC signing](concepts/accounts-pqc.md).
