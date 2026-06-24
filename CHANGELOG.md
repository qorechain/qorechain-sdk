# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Mainnet is now live (chain id `qorechain-vladi`). The `mainnet` preset is fully
  populated across all four SDKs with the same localhost endpoint defaults as
  testnet; `getNetwork("mainnet")` and the client factories now return a usable
  config instead of raising the former mainnet-unavailable error.

### Added

- Initial public repository scaffolding for the QoreChain SDK monorepo.
- `@qorechain/sdk` TypeScript core:
  - Network presets (`NETWORKS`, `getNetwork`, `listNetworks`): live testnet
    (`qorechain-diana`) and live mainnet (`qorechain-vladi`), both with localhost
    defaults.
  - Account derivation from a single mnemonic — native (`qor1…` secp256k1), EVM
    (`0x…` EIP-55), and SVM (base58 ed25519) — plus `generateMnemonic` /
    `validateMnemonic`.
  - Post-quantum cryptography: ML-DSA-87 (Dilithium-5) key generation, signing,
    and verification, with a pluggable `PqcSigner` / `HybridSigner` and a
    hybrid-signature extension builder.
  - Read clients: Cosmos + QoreChain `RestClient`, EVM `JsonRpcClient`, and the
    typed `qor_` namespace `QorClient`.
  - Native transactions: `TxClient` builder/broadcaster with a `bankSend`
    convenience, fee estimation (`estimateFee`), and a `directSignerFromPrivateKey`
    signer adapter.
  - `createClient` factory composing the resolved network, read clients, fee
    helper, and a lazy signing entrypoint.
  - Denomination (`toBase` / `fromBase`) and bech32/hex address utilities.
