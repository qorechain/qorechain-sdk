# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

### Added

- Full transaction-message coverage (TypeScript): `qorechainRegistry` plus typed
  message composers for every custom module (amm, bridge, rdk, multilayer, pqc,
  svm, lightnode, license, abstractaccount, crossvm, rlconsensus) and standard
  Cosmos modules (bank, staking, distribution, gov, ibc, authz, feegrant),
  generated from protobuf via a reproducible `pnpm codegen` pipeline; typed query
  clients for all query modules.
- Browser wallet integration: Keplr/Leap (`@qorechain/sdk`), MetaMask/EIP-1193 +
  EIP-6963 discovery (`@qorechain/evm`), and Phantom/Wallet-Standard
  (`@qorechain/svm`); Amino signing for standard messages.
- Transaction lifecycle: auto-gas via simulation, structured error decoding
  (Cosmos ABCI / EVM reverts / SVM program errors), tx tracking with
  confirmation polling and retry, and block/tx search.
- Event subscriptions over websockets: new blocks and tx events (Cosmos),
  `watchEvent`/`watchBlocks` (EVM), `onLogs`/`onAccountChange` (SVM).
- EVM ERC-721 / ERC-1155 helpers and EIP-1559 fee estimation; SVM
  compute-budget / priority-fee helpers; full CosmWasm lifecycle (`instantiate2`,
  `migrate`, `updateAdmin`, `clearAdmin`, code reads); address/hash/unit
  utilities; config-driven explorer and faucet helpers.
- Full native-chain parity across the Python, Go, and Rust SDKs: protobuf codegen
  for all custom modules, typed message composers + standard Cosmos builders,
  typed query clients, generic message broadcast + hybrid PQC transactions,
  auto-gas, error decoding, tx tracking, block/tx search, utilities, and
  websocket subscriptions — matching the TypeScript native-chain surface.

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
