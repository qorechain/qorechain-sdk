# @qorechain/react

## 0.11.0

### Patch Changes

- b8a2791: Chain developer kit.

  `@qorechain/evm`: viem chain definitions `qorechain` (EVM chain id 9801) and
  `qorechainTestnet` (9800), plus `QORECHAIN_CHAINS` and
  `QORECHAIN_REST_ENDPOINTS`. EVM authorisation window helpers:
  `evmWindowStatus` reads an account's window over REST
  (`/qorechain/pqc/v1/evm_window/{address}`), `openEvmWindowMessage` checks the
  chain's bounds and composes the native-lane `MsgOpenEVMWindow` to sign hybrid,
  `evmWindowCost` / `weiToUqorCeil` size a window, `classifyEvmWindowRejection`
  now also reads errors nested in a `cause` chain, and `toQorAddress` /
  `toEvmAddress` convert an eth-native account between its two encodings. The
  window helpers are also published viem-free at `@qorechain/evm/window`.

  `@qorechain/sdk`: the window bounds, REST reader and refusal classifier now come
  from `@qorechain/evm/window` (same exports, same behaviour).

  `create-qorechain-dapp`: new templates `foundry`, `hardhat` (Hardhat 3),
  `viem-wagmi` (wagmi + RainbowKit + QoreX) and `cosmwasm` (CW20 on cw20-base,
  governance upload proposal). The Foundry and Hardhat templates include
  `pnpm window` to register the account's ML-DSA-87 key and open the EVM
  authorisation window before a deploy.

  Docs: EVM quickstarts for viem, ethers v6, web3.py, go-ethereum, alloy and
  web3j, and "QoreChain EVM compared with Ethereum".

  The `@qorechain/*` packages are versioned together, so they all take the minor
  bump.

- c1521a7: Docs and wording: describe post-quantum signing precisely (hybrid secp256k1 +
  ML-DSA-87 on the native lane, a bounded authorisation window on the EVM lane,
  SVM lane not open yet), drop superiority claims, and use plain hyphens in docs,
  comments and messages.

  `@qorechain/react`: new `PqcStatusBadge` component (`PqcStatusBadgeProps`,
  `PqcStatusRenderState`). `QuantumSafeBadge`, `QuantumSafeBadgeProps` and
  `QuantumSafeRenderState` stay exported as deprecated aliases of the same
  component and types. The default badge labels are now "PQC key registered" and
  "No PQC key" (override them with `safeLabel` / `unsafeLabel`). The root element
  keeps `data-quantum-safe` and also carries `data-pqc-status` with the same
  values.

- Updated dependencies [b8a2791]
- Updated dependencies [c1521a7]
  - @qorechain/sdk@0.11.0
