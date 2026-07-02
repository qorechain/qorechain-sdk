# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.2 — 2026-07-02

### Fixed
- `@qorechain/sdk` no longer crashes on bare import: `@qorechain/evm` (statically
  re-exported for the AI pre-flight helpers) moved from optional peer to a regular
  dependency — it imports cleanly without viem. `viem` stays an optional peer.

## [0.5.1]

### Fixed

- **Deterministic ML-DSA-87 signing (consensus-critical)** — the chain's PQC
  verifier accepts ONLY deterministic (FIPS-204 §3.4, `rnd` = 32 zero bytes)
  ML-DSA-87 signatures; hedged/randomized signing is rejected with codespace
  `pqc`. All language bindings now sign deterministically by default
  (TypeScript via `@qorechain/pqc`; Python via `dilithium-py`
  `deterministic=True`; Rust via `fips204` `try_sign_with_seed`; Java via
  BouncyCastle's deterministic path; Go already used circl's deterministic
  mode), with explicit hedged opt-ins for off-chain use, and regression tests
  pinned to the shared `qorechain-pqc` deterministic signature vectors.
- **PQC key registration** — the quantum-safe DX helpers now broadcast
  `/qorechain.pqc.v1.MsgRegisterPQCKeyV2` (explicit `algorithm_id`; the chain's
  classical-exempt bootstrap path) instead of the legacy `MsgRegisterPQCKey`,
  with `key_type` defaulting to `"hybrid"` in every language.

### Changed

- **Fee-floor defaults** — default/fallback gas prices raised from `0.025uqor`
  to `0.15uqor` per unit of gas, above the genesis min-gas-price (BaseFee) of
  `0.1uqor`/gas enforced on both networks. User-supplied gas prices are
  untouched.
- **Docs & examples** — READMEs, guides, and example configs now show the live
  public endpoints (`rpc`/`api`/`evm`/`svm.qore.host`,
  `*-testnet.qore.host`, `wss://rpc.qore.host/websocket`) and the public
  explorer at `explore.qore.network`.

## [0.5.0]

### Added

- **AI pre-flight risk scoring** — `simulateWithRiskScore`, `aiRiskScore`, and
  `aiAnomalyCheck` call the on-chain AI EVM precompiles (`aiRiskScore(bytes)` at
  `0x…0B01`, `aiAnomalyCheck(address,uint256)` at `0x…0B02`) via `eth_call` to
  return gas plus a risk score/level and an anomaly score/flag, with an advisory
  `safe` verdict. Available across TypeScript, Python, Go, Rust, and Java.
- **Unified cross-VM calls + atomic triple-VM transactions** — a high-level
  cross-VM client (`call` / `buildCall` / `callAtomic` / `getMessage`) over
  `MsgCrossVMCall`, targeting any VM (`evm` | `cosmwasm` | `svm`) from one account
  and one signature; `callAtomic` packs multiple cross-VM calls into a single
  transaction. TypeScript encodes payloads per VM (EVM ABI, CosmWasm JSON, raw);
  the other languages accept raw payloads and CosmWasm JSON.
- **Quantum-safe DX** — `isPqcRegistered` / `getPqcStatus` /
  `ensurePqcRegistered` (idempotent, via `qor_getPQCKeyStatus` +
  `MsgRegisterPQCKey`) and `migrateToHybrid` (+ `MsgMigratePQCKey`), across all
  five languages.
- **`@qorechain/react`** (new package) — `QoreChainProvider`, hooks
  (`useQoreClient`, `useAccount`, `useBalance`, `useConnect`/`useWallet`,
  `useTx`, `usePqcStatus`), and `ConnectButton` / `QuantumSafeBadge` components.
- Docs guides for AI pre-flight, cross-VM, quantum-safe, and React; runnable
  `ai-preflight`, `cross-vm-call`, and `react-dapp` examples.

## [0.4.0]

### Added

- Rollup withdrawals — `MsgExecuteWithdrawal` (the L2→L1 rollup exit path) is now
  exposed across all five SDKs, with the rollup batch `withdrawals_root` field.
- Typed query clients for the `multilayer`, `rdk`, and `bridge` modules.
- Bridge admin messages — `MsgUpdateEthLightClient`, `MsgUpdateChainConfig`,
  `MsgSetVerifierBootstrap`.
- High-level sidechain/paychain (`multilayer`) and rollup (`rdk`) helpers, with
  `register-sidechain` and `rollup-lifecycle` examples, a `rollup-app` CLI
  template, and docs guides for multilayer and rollups.

### Fixed

- Re-synced the vendored protobuf definitions for the `rdk`, `multilayer`, and
  `bridge` modules with the chain (the rollup withdrawal message and the module
  query services were previously missing from codegen).

## [0.3.0]

### Changed

- Unified release version aligned across all SDKs and the npm distribution.
- Internal maintainer tooling removed from the public repository.

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
