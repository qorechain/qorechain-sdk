---
"@qorechain/evm": minor
"@qorechain/sdk": patch
"@qorechain/svm": patch
"@qorechain/react": patch
"create-qorechain-dapp": minor
---

Chain developer kit.

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
