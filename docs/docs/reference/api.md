---
id: api
title: API reference
sidebar_position: 3
---

# API reference

## TypeScript (`@qorechain/sdk`)

The TypeScript packages ship full TSDoc on their public surface, and a
[TypeDoc](https://typedoc.org) configuration is wired into the core package. To
generate the HTML API reference for `@qorechain/sdk`:

```bash
# from the monorepo root
pnpm --filter @qorechain/sdk docs:api
```

This runs the `docs:api` script (`typedoc`) defined in `packages/ts`, producing
the API site under that package's `docs/` output directory. The generated output
is not committed — run the command locally or wire it into your own docs
pipeline.

The documentation site's own TypeDoc config lives at `docs/typedoc.json`; it
points at the core package's entry point so you can regenerate from the docs
project as well.

### Public surface at a glance

The deliberate, supported exports of `@qorechain/sdk`:

- **Client:** `createClient`, types `QoreChainClient`, `CreateClientOptions`,
  `ConnectTxOptions`, `ClientFees`.
- **Networks:** presets, lookup/list helpers, and config types (networks
  module).
- **Utilities:** `toBase` / `fromBase` (denom), address encoding/validation.
- **Accounts:** `generateMnemonic`, `validateMnemonic`, `deriveNativeAccount`,
  `deriveEvmAccount`, `deriveSvmAccount`; account types.
- **PQC:** `generatePqcKeypair`, `pqcSign`, `pqcVerify`, length constants,
  algorithm IDs/helpers, `PqcSigner`, `HybridSigner`,
  `buildHybridSignatureExtension`, `HYBRID_SIG_TYPE_URL`.
- **Read clients:** `RestClient`, `JsonRpcClient`, `QorClient`, HTTP helpers
  (`getJson`, `postJsonRpc`, `buildUrl`, `joinUrl`, `QoreHttpError`).
- **Cross-VM:** `getCrossVmMessage`, `getPendingCrossVmMessages`,
  `getCrossVmParams`.
- **CosmWasm:** `createCosmWasmClient`, `connectCosmWasmSigner`,
  `queryContractSmart`, `getContractInfo`, `instantiate`, `execute`,
  `uploadCode`.
- **Transactions:** `estimateFee`, `directSignerFromPrivateKey`, `TxClient`,
  `MSG_SEND_TYPE_URL`, hybrid helpers (`encodeHybridExtension`,
  `attachHybridExtension`, `buildHybridTx`, `signAndBroadcastHybrid`).

### `@qorechain/evm`

`createEvmClient`, `evmAccountFromPrivateKey`, the `erc20` helpers, contract
wrappers (`deployContract`, `readContract`, `writeContract`), the `precompiles`
bindings, `PRECOMPILE_ADDRESSES`, and the ABIs (`ERC20_ABI`, `IQORE_PQC_ABI`,
`IQORE_AI_ABI`, `IQORE_CONSENSUS_ABI`).

### `@qorechain/svm`

`createSvmClient`, `DEFAULT_SVM_RPC_URL`, `svmKeypairFromSecretKey`,
`svmAddress`, the program builders (`createMemoInstruction`,
`createTransferTokenInstruction`, `createAssociatedTokenAccountInstruction`,
`getAssociatedTokenAddress`, `createInvokeInstruction`), and the program-id
constants.

## Other languages

| Language | Generated docs | Notes |
| --- | --- | --- |
| Python | [PyPI](https://pypi.org/project/qorechain/) — docstrings on the public API | publish-pending |
| Go | [pkg.go.dev](https://pkg.go.dev/github.com/qorechain/qorechain-sdk/packages/go) (godoc) | publish-pending |
| Rust | [docs.rs](https://docs.rs/qorechain) (rustdoc) | publish-pending |

Each package mirrors the same surface (network presets, denom/address
utilities, HD derivation, PQC primitives, REST + `qor_` JSON-RPC read clients),
documented inline in the source so the language-native doc tooling renders it.
