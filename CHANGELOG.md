# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.2]

### Added — required by chain v3.2.0: the EVM authorisation window

From v3.2.0 an EVM transaction is admitted only from an account that holds a
registered PQC key **and** has an open, unexhausted authorisation window, opened
by a Cosmos-lane message. The window is what keeps the classical secp256k1 key
from moving value on its own. The testnet enforces this from its v3.2.0 upgrade
(height 5,920,000); mainnet from its own. Until this release the SDK had no way
to open one, so every EVM transaction it sent was refused.

- `openEvmWindowMsg` / `closeEvmWindowMsg` compose `MsgOpenEVMWindow` /
  `MsgCloseEVMWindow`, checking the chain's bounds client-side first: `blocks`
  1…17280, `maxTxs` 1…1000, `maxValue` above 0. Every field is required — the
  chain refuses a missing one rather than defaulting it — and opening replaces
  any existing window.
- `fetchEvmWindow` reads `/qorechain/pqc/v1/evm_window/{address}`, which answers
  `found: false` instead of failing when there is none, so it is safe to poll.
  Every number is a `bigint`: the values are `cosmos.Int` and do not fit a float.
- `classifyEvmWindowRejection` / `isEvmWindowRejection` name the refusal:
  `no-window`, `exhausted`, `invalid`, or `no-pqc-key`. They read the chain's
  codespace and code (`pqc` 26/27/28) when those survive the transport, and the
  chain's message text otherwise, which is what arrives over EVM JSON-RPC. A
  missing PQC key is reported separately from a missing window because the
  remedy differs: register a key first. The chain raises both under code 26, so
  the text is matched first and the code is only a fallback.
- The message composers and the registry gained both messages, so any signing
  path already in the SDK can carry them.
- The same surface lands in all five languages (TypeScript, Python, Rust, Go and
  Java) and in `@qorechain/wallet-adapter` 0.2.2, which the wallets build on.
  Neither the Go nor the Java SDK has a high-level EVM send path, so there the
  classifier and its remedy text are the surface.
- The chain raises "no registered post-quantum key" under **code 26** on the EVM
  lane and **code 28** on the Cosmos lane, with different wording on each, so a
  client cannot tell the two states apart by code. Every binding matches the
  chain's text first and falls back to the code; both lanes' exact texts are
  pinned in tests.

**Three things worth knowing before you build a wallet flow on this:**

- **Opening a window advances the EVM nonce.** The identity is unified, so the
  account's Cosmos sequence *is* its EVM nonce. Sign the EVM transaction after
  opening, or it is refused with "nonce too low". Order: open, read the nonce,
  sign.
- **`maxValue` bounds value plus the maximum fee** (gas limit × gas fee cap),
  because the holder of the classical key sets the gas price. A 1,000 uqor
  transfer with 21,000 gas at 112.5 gwei consumes 3,363 uqor of the window.
  Wei-to-uqor rounds up.
- **`blocks` is a block count, not a duration.** The chain's constant is
  commented "about 24 hours at 5s blocks", but no QoreChain network runs at 5s:
  17,280 blocks is roughly 5 hours on the testnet and 15 on mainnet. Say "up to
  17,280 blocks", or compute from the chain's recent block time.

There is deliberately no helper that opens a window automatically before a send.
The window exists so spending is authorised deliberately; opening one on every
send turns that into a click nobody reads. Surface the refusal, then let the
user authorise.

### Changed

- The vendored protos are re-synced from chain tag `v3.2.0` (`pqc` and
  `lightnode` gained RPCs) and the generated code regenerated in all five
  languages.

### Notes on two chain changes that need no SDK code

- `MsgSubmitBatch` is now accepted only from the rollup's configured sequencer,
  falling back to the creator when none is set; anyone else is refused with
  `ErrUnauthorized`. Batches must extend the chain by index and cannot overwrite
  an existing one, and `MsgPauseRollup` / `MsgResumeRollup` / `MsgStopRollup` now
  require the creator. A caller that worked before can start failing.
- `x/ai`'s per-sender rate limit was declared but never enforced; it is enforced
  from v3.2.0. Its window is 30 **blocks** despite the field being named
  `max_tx_per_minute`. A network born on this release starts at 10, while one
  that upgraded sits at 600, so read the value from `qorechain.ai.v1.Query/Config`
  rather than assuming either.

## [0.8.1]

### Fixed — required before the mainnet upgrade

- **The sign-bytes resolver now asks for every v2 upgrade plan name.** 0.8.0 asked
  only `applied_plan/v3.1.98`. The chain recognises two names: the testnet took
  the switch under `v3.1.98` and keeps that record, while **mainnet applies
  `v3.2.0`**. So 0.8.0 is correct on the testnet today and would have answered v1
  on mainnet after its upgrade — and the chain refuses a v1 hybrid signature with
  `pqc` code 21. `"auto"` now queries `SIGN_BYTES_V2_UPGRADES` (`"v3.2.0"`, then
  `"v3.1.98"`) in order and uses v2 if any applied height is above 0, stopping at
  the first. `SIGN_BYTES_V2_UPGRADE` is now the current name, `"v3.2.0"`, and the
  new `SIGN_BYTES_V2_UPGRADES` lists both; `fetchSignBytesV2AppliedHeight` takes
  an optional plan name and `fetchSignBytesV2AppliedHeightAny` returns the first
  positive height across the list.
- **Go only (`packages/go/v0.8.1`):** `signbytes.Resolve` takes
  `(ctx, restURL, chainID, version)` — the URL first, the opposite of the other
  bindings. A swapped pair put a URL in `chainID`, which is not a legacy network,
  so the resolver answered v2 with no request and no error — the form mainnet
  refuses. A swapped pair, an empty `chainID`, and a `restURL` that is not a URL
  are now refused with `ErrUnresolvedVersion`.

## [0.8.0]

### Breaking — hybrid sign-bytes follow the network (chain v3.1.98)

- **The post-quantum half of a hybrid transaction is now signed in the form the
  target network verifies.** Chain v3.1.98 introduced a v2 sign-bytes form that
  binds a domain tag and the chain id:

      v1: BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A
      v2: "qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A

  A network verifies exactly one form at any height, with no overlap. The testnet
  (`qorechain-diana`) switched to v2 at its v3.1.98 upgrade (height 5,746,000);
  mainnet (`qorechain-vladi`) stays on v1 until its own upgrade. **Every earlier
  SDK release signs v1 and is refused on the testnet with `pqc` code 21.**
- New `signBytesVersion` option (`"auto"` | `"v1"` | `"v2"`, default `"auto"`) on
  every hybrid path in all five languages. `"auto"` asks the network
  (`GET {rest}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`: v2 when the applied
  height is above 0), caches the answer for about a minute, and never guesses: on
  `qorechain-vladi` / `qorechain-diana` it needs the REST endpoint, and it raises
  if the node cannot be asked. Chains born on v3.1.98 or later are v2 without a
  lookup.
- **Low-level builders no longer have an implicit form.** `buildHybridTx` /
  `signHybridEth` (and their Python, Go, Rust and Java counterparts) raise on
  `qorechain-vladi` / `qorechain-diana` unless given a version or, where the
  builder is asynchronous, a REST endpoint to resolve one. Pass `rest` (or an
  explicit version) when you upgrade. The built result reports the form used.
- The high-level sign-and-broadcast paths re-resolve and retry **once** when a
  broadcast is refused with `pqc` code 21, so a wallet left open across a network
  upgrade recovers on its own. Callers that broadcast separately can detect the
  refusal with `isHybridSignBytesRejection` and rebuild with a forced refresh.
- Builders for the other two payloads that gained a v2 form in the same release,
  with the same per-network rule: the PQC key-migration message
  (`"qorechain-key-migration-v2"`, replacing the ASCII
  `qorechain-key-migration:chain=…` form) and the bridge attestation
  (`"qorechain-bridge-attestation-v2"`, replacing the pipe-joined form; bridge
  validator signers only).
- All three v2 layouts are checked against known-answer vectors generated from the
  chain's own implementation, byte for byte, in every language.
- **Upgrade checklist.** `rest` is optional in the TypeScript types, so a caller that forgets it compiles cleanly and only fails at runtime on `qorechain-vladi` / `qorechain-diana`. Cover your wiring with a runtime test, not just a type check. In unit tests, pass `signBytesVersion: "v1"` or `"v2"` explicitly (or inject `fetch`): `"auto"` asks the network, so a test that omits it silently depends on a live node.

### Removed — security

- **Wallet-signature account derivation is gone.** The Phantom "P1a" helpers —
  `unifiedAccountFromPhantomSignature` (all languages) and `connectPhantomUnified`
  (TypeScript) — derived an account's **spend key** from a wallet signature over a
  fixed, public message. That is unsafe by construction: a wallet signature is a
  bearer secret, wallets return it to whatever page requests it, and the signature
  over a fixed message is reproducible — so whoever obtains it controls the
  account. No in-message binding (origin, nonce) can fix this, because the page
  supplies the bytes the wallet signs and the derivation has to stay reproducible.

  The functions now raise an error pointing at the supported design. **Use the
  authenticator lanes instead** (shipped in 0.7.0, chain v3.1.85): register the
  external key with `MsgRegisterAuthenticator` and spend via `MsgExecuteCosmos` /
  `MsgExecuteEVM`. There the external key only ever *authorises* a spend under a
  permission scope, and can be revoked — it never becomes the spend key.

  > **Do not rely on `SpendingRule` as a security control.** A per-authenticator
  > spending limit can be expressed on-chain, but it is **not currently enforced
  > on the `ExecuteCosmos` / `ExecuteEVM` lanes**. Treat a linked authenticator as
  > able to spend the account's full balance, and scope it accordingly (register
  > only the permissions it needs, and revoke it when done).

  > **If you created an account with these helpers, treat it as exposed and move
  > its funds.** Its private key is recoverable by anyone who ever obtained that
  > wallet signature. See the Authenticators guide for the supported flow.

- `unifiedAccountFromSeed` now documents that the seed must be real secret entropy
  and must never be derived from a wallet signature or any value a third party can
  request.

### Added

- **Cross-VM calls carry the callee's answer** (chain v3.1.98). `MsgCrossVMCall`
  gained `async` and `MsgCrossVMCallResponse` gained `executed`, `data` and
  `gas_used`. From v3.1.98 the call executes within the transaction and returns
  its answer; the async option queues it for later dispatch instead. The helpers
  surface the callee's return value, execution flag and gas used.
  **Requires a network on v3.1.98.** Before its upgrade a network queues every
  call, does not know the `async` field (a transaction that sets it is rejected),
  and returns none of the new response fields — mainnet is in that state until
  its v3.1.98 upgrade.
- `MsgUpdateParams` composer for the `svm` module (`/qorechain.svm.v1.MsgUpdateParams`),
  the governance message that replaces the SVM runtime parameters. Also chain
  v3.1.98; not recognised by a network before its upgrade.

### Changed

- `sourceVm` on a cross-VM call is **ignored by the chain**, which derives the
  origin lane from the execution context. The field is still accepted for wire
  compatibility and is now documented as advisory only.
- **Strict ML-DSA-87 sizes in every binding.** The bindings disagreed on what
  counts as a valid signature: a Go binding (CIRCL v1.6.1) accepted a 4628-byte
  signature — the FIPS 204 size 4627 plus one trailing byte — as VALID, while
  Rust `fips204` rejected it. A signature one binding accepts and another refuses
  is a consensus hazard and a malleability surface, so the SDKs now check the
  exact sizes themselves before calling the library underneath: signature 4627,
  public key 2592, secret key 4896. Verification returns false for a wrong-sized
  signature or public key; signing raises on a wrong-sized secret key.

## [0.7.0]

### Added

- **Authenticator lanes (chain v3.1.85)** — a linked external key (Phantom
  ed25519, or a MetaMask/secp256k1 key by its 20-byte address) can spend from the
  one canonical PQC-required account through a **relayer**, under least-privilege,
  revocable terms — without the external key ever producing an ML-DSA
  co-signature. (A spending limit can be expressed but is **not enforced** on
  these lanes — see the 0.8.0 note; do not rely on it as a security control.)
  Added across all five languages:
  - New messages + composers: `MsgExecuteEVM`, `MsgExecuteCosmos`
    (`/qorechain.abstractaccount.v1.*`), and `MsgRotatePQCKey`
    (`/qorechain.pqc.v1.*`).
  - Byte-exact sign-bytes helpers — `evmAuthSignBytes`
    (`sha256("qorechain-evm-auth-v1" ‖ …)`), `cosmosAuthSignBytes`
    (`"qorechain-cosmos-auth-v1"`), and `rotationSignBytes`
    (`qorechain-pqc-rotate-v1|…`) — the digest an authenticator signs.
  - `permissionSchema` query (the on-chain permission taxonomy) and new decoded
    error codes: abstractaccount `5` SpendingLimitExceeded, `6` SessionKeyExpired,
    `10` PermissionDenied, `11` AuthenticatorReplay; pqc `21` HybridVerifyFailed.
  - Same-algorithm PQC key rotation — `rotatePqcKeyMsgFromMnemonic` +
    `derivePqcLegacy` migrate a legacy `shake256(mnemonic)` key to the canonical
    address-bound key (dual-signed with both keys).
  - TypeScript wallet builders: `buildPhantomExecuteEvm` / `buildPhantomExecuteCosmos`
    (ed25519), `buildMetaMaskExecuteEvm` / `buildMetaMaskExecuteCosmos` (EIP-191
    `personal_sign`), and `registerEthAuthenticatorMsg`; plus an
    `authenticator-spend` example and an Authenticators docs guide.

  Note on nonces: `MsgExecuteEVM.nonce` is the account's current EVM nonce (the
  relayer is a different account, so it does not bump the account's nonce);
  `MsgExecuteCosmos.nonce` is the per-authenticator sequence.

## [0.6.1]

### Fixed

- **Hybrid-signature tx extension encoding (consensus-critical)** — the
  `/qorechain.pqc.v1.PQCHybridSignature` tx-body extension was serialized as
  Go-JSON into `Any.value`, which the chain's tx decoder rejected at CheckTx (the
  leading `0x7b` `{` was misread as protobuf field 15 `start_group`, giving a tx
  parse error). It is now protobuf-encoded via the generated `PQCHybridSignature`
  codec (`algorithm_id` = 1, `pqc_signature` = 2, `pqc_public_key` = 3; the value
  begins with `0x08`) in **all five languages**, so every hybrid (PQC + classical,
  including the eth-native lane) transaction is accepted. Fixed in TypeScript,
  Python, Go, Rust, and Java; verified live on testnet. Regression tests assert the
  extension value begins with `0x08` and never `0x7b`, and round-trips through the
  generated codec.

## [0.6.0]

### Added

- **Unified eth-native wallet** — `deriveUnifiedAccount` / `unifiedAccountFromSeed`
  (plus `addressesFrom20` / `qoreAddresses`) across all five languages: one
  `eth_secp256k1` key is one 20-byte identity rendered three ways — `qor1…`
  (bech32), `0x…` (EIP-55), and SVM base58 (the 20 bytes right-padded with 12 zero
  bytes to 32). A deposit to any of the three lands in one balance, and the key
  spends on every lane. The legacy coin-type-118 `deriveNativeAccount` remains
  supported (additive).
- **eth_secp256k1 Native-lane signing** — `signClassicalEth` / `signHybridEth`:
  the classical signature is secp256k1 over `keccak256(SignDoc)` and the signer
  public key is `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`; the hybrid path adds
  the ML-DSA-87 post-quantum signature. Account parsing accepts eth_secp256k1
  public keys. (Chain v3.1.83.)
- **Phantom P1a** — `unifiedAccountFromPhantomSignature` / `connectPhantomUnified`
  (TypeScript): derive a canonical, non-custodial unified account from a
  deterministic Phantom signature (`shake256(signature, 32)`), so a Phantom user
  gets all three QoreChain addresses and can spend on every lane.
  > **Removed in 0.8.0 — do not use.** Deriving a spend key from a wallet
  > signature is unsafe; see the 0.8.0 entry. Accounts created this way must be
  > treated as exposed.
- **New chain surface (v3.1.83)** — abstractaccount `MsgRegisterAuthenticator` /
  `MsgRevokeAuthenticator` composers; typed query clients for `amm`, `license`,
  and `abstractaccount`; and the `multilayer` `Anchor` / `Anchors` state-anchor
  queries.

### Changed

- **Documentation terminology** — the native lane (formerly described as the
  "Cosmos-SDK" lane) is now referred to as **QoreChain Native** (or "Native")
  throughout the docs, guides, and package manuals. Dependency names, on-chain
  type URLs, and the CosmWasm VM name are unchanged.

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
  Native modules (bank, staking, distribution, gov, ibc, authz, feegrant),
  generated from protobuf via a reproducible `pnpm codegen` pipeline; typed query
  clients for all query modules.
- Browser wallet integration: Keplr/Leap (`@qorechain/sdk`), MetaMask/EIP-1193 +
  EIP-6963 discovery (`@qorechain/evm`), and Phantom/Wallet-Standard
  (`@qorechain/svm`); Amino signing for standard messages.
- Transaction lifecycle: auto-gas via simulation, structured error decoding
  (Native ABCI / EVM reverts / SVM program errors), tx tracking with
  confirmation polling and retry, and block/tx search.
- Event subscriptions over websockets: new blocks and tx events (Native),
  `watchEvent`/`watchBlocks` (EVM), `onLogs`/`onAccountChange` (SVM).
- EVM ERC-721 / ERC-1155 helpers and EIP-1559 fee estimation; SVM
  compute-budget / priority-fee helpers; full CosmWasm lifecycle (`instantiate2`,
  `migrate`, `updateAdmin`, `clearAdmin`, code reads); address/hash/unit
  utilities; config-driven explorer and faucet helpers.
- Full native-chain parity across the Python, Go, and Rust SDKs: protobuf codegen
  for all custom modules, typed message composers + standard Native builders,
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
  - Read clients: Native + QoreChain `RestClient`, EVM `JsonRpcClient`, and the
    typed `qor_` namespace `QorClient`.
  - Native transactions: `TxClient` builder/broadcaster with a `bankSend`
    convenience, fee estimation (`estimateFee`), and a `directSignerFromPrivateKey`
    signer adapter.
  - `createClient` factory composing the resolved network, read clients, fee
    helper, and a lazy signing entrypoint.
  - Denomination (`toBase` / `fromBase`) and bech32/hex address utilities.
