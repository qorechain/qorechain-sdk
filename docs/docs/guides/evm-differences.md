---
id: evm-differences
title: QoreChain EVM compared with Ethereum
sidebar_position: 3
---

# QoreChain EVM compared with Ethereum

QoreChain runs an Ethereum-compatible EVM next to its native lane. Solidity,
Foundry, Hardhat, viem, ethers and the other usual tools work, with the
differences below. Everything on this page was read from the public endpoints
on 27 October 2026; where something could not be checked it says "to be
confirmed".

## The one difference that changes your workflow

**Every EVM transaction needs a registered ML-DSA-87 key and a live EVM
authorisation window for its sender.** There are no exceptions per account. A
deploy, a transfer or a contract call from an account without them is refused.

- The key is registered once per account, on the native lane.
- The window is opened with `MsgOpenEVMWindow`, a native-lane message signed
  hybrid (secp256k1 + ML-DSA-87). The secp256k1 key alone can never open one,
  so a stolen EVM private key cannot spend on its own.
- A window bounds the number of blocks, the number of EVM transactions, and the
  total they may spend: value **plus** the maximum fee (gas limit x fee cap) of
  each transaction, in uqor, with wei rounded up.
- Opening a window advances the account's nonce (the native sequence and the
  EVM nonce are the same counter). Open first, then read the nonce, then sign.
- Simulation needs no window: `eth_call` and `eth_estimateGas` work for any
  account.
- An account that has a registered key has no classical-only path on the native
  lane either: every native transaction it signs is hybrid.

The rule is the protocol feature `evm-pqc-authorisation-window`, enabled on both
networks. Check it at
[`https://api.qore.host/qorechain/pqc/v1/protocol_features`](https://api.qore.host/qorechain/pqc/v1/protocol_features)
(testnet: `https://api-testnet.qore.host/...`). Read an account's window at
`/qorechain/pqc/v1/evm_window/{qor1 address}`.

How to do it from code: [EVM quickstarts: Before you send](evm-quickstarts.md#before-you-send).
The `foundry` and `hardhat` templates of `create-qorechain-dapp` include
`pnpm window register` and `pnpm window open`.

## Networks and identity

| | Testnet | Mainnet |
| --- | --- | --- |
| Native chain id | `qorechain-diana` | `qorechain-vladi` |
| EVM chain id (`eth_chainId`, `net_version`) | 9800 (`0x2648`) | 9801 (`0x2649`) |
| HTTP JSON-RPC | `https://evm-testnet.qore.host` | `https://evm.qore.host` |
| WebSocket | `wss://evm-ws-testnet.qore.host` | to be confirmed |
| Native REST | `https://api-testnet.qore.host` | `https://api.qore.host` |
| Average block time (last 1,000 blocks) | about 1.3 s | about 3.1 s |

- `web3_clientVersion` answers `Version dev ()...` on both networks. Do not
  rely on it to detect the node.
- **One account, two encodings.** For an eth-native account (one secp256k1 key
  for every lane) the `0x` address and the `qor1...` address are the same 20
  bytes, and both show the same balance. `toQorAddress` / `toEvmAddress` in
  `@qorechain/evm` convert between them.
- **Decimals.** QOR has 18 decimals on the EVM lane and 6 on the native lane
  (`uqor`): 1 uqor = 10^12 wei. `eth_getBalance` returns the bank balance in
  uqor x 10^12 plus any sub-uqor remainder, which the chain keeps in the
  extended denom `aqor`.

## Fees

Read live on both networks:

| Value | Answer |
| --- | --- |
| `eth_gasPrice` | 112.5 gwei (`0x1a3185c500`) |
| Base fee (`eth_feeHistory`, block headers) | 100 gwei (`0x174876e800`) |
| `eth_maxPriorityFeePerGas` | 12.5 gwei (`0x2e90edd00`) |
| Block `gasLimit` in headers | 4,294,967,295 (`0xffffffff`) |

The base fee sits at the chain's floor of 0.1 uqor per gas (100 gwei).
EIP-1559 (type 2) and legacy transactions are both accepted. Tools that set the
fee cap to about twice the base fee (Foundry does) commit up to roughly
200 gwei per gas against the window, even though they pay about 112.5 gwei.

## Forks, EIPs and transaction types

- Forks through London are active from genesis; Shanghai, Cancun and Prague are
  active; Osaka is not. No extra EIPs are enabled (`extra_eips` is empty).
- Accepted transaction types: 0 (legacy), 1 (access list), 2 (EIP-1559) and 4
  (EIP-7702).
- **EIP-4844 blob transactions (type 3) are refused.** Cancun opcodes work, but
  `blobGasUsed` and `excessBlobGas` are always 0, `eth_blobBaseFee` does not
  exist, and an `eth_call` to the point evaluation precompile (`0x0a`) returns
  an error.
- **PREVRANDAO (EIP-4399) is a constant**, `0xff...ff`, and the header
  `mixHash` reads `0x00...00`. Never use it as a source of randomness.
- **EIP-7702** (type 4) is accepted, with a QoreChain rule: each authority whose
  delegation would take effect needs a registered PQC key and a single-use
  consent recorded with `MsgAuthorizeEVMDelegation` (at most 8 authorizations
  per transaction, no duplicate authority). The sponsor's window does not count
  as the authorities' consent. `MsgClearEVMDelegation` removes a delegation from
  the native lane.

## Finality

Blocks are final when they are committed: `eth_getBlockByNumber` returns the
same block for `latest`, `safe` and `finalized` on both networks. There are no
reorgs to wait out and no uncles (`eth_getUncleCountByBlockNumber` is 0).

## Precompiles

Ethereum's standard precompiles answer as usual (for example `0x02`, SHA-256).
QoreChain adds its own at fixed addresses. Whether a stateful precompile is
active is a chain parameter: `active_static_precompiles` in
`/cosmos/evm/vm/v1/params`. Today it lists:

- testnet: `0x0A01`, `0x0A02`, `0x0C01`
- mainnet: none

| Address | Precompile | Testnet | Mainnet |
| --- | --- | --- | --- |
| `0x...0901` | Cross-VM bridge (EVM to CosmWasm) | not active | not active |
| `0x...0A01` | PQC signature verification (`pqcVerify`) | **active** | not active |
| `0x...0A02` | PQC key status (`pqcKeyStatus`) | **active** | not active |
| `0x...0B01` | AI risk score (`aiRiskScore`) | not active | not active |
| `0x...0B02` | AI anomaly check (`aiAnomalyCheck`) | not active | not active |
| `0x...0C01` | Consensus parameters (`rlConsensusParams`) | **active** | not active |
| `0x...0800` to `0x...0806` | Staking, distribution, ICS-20, vesting, bank, governance, slashing | not active | not active |
| `0x...0100` | P-256 signature verification | not active | not active |
| `0x...0400` | Bech32 address conversion | not active | not active |

The PQC precompiles `0x0A01` / `0x0A02` are active on the testnet only; there
is no date for mainnet. A call to an inactive precompile returns empty data
rather than reverting, so check the parameter (or the result length) before you
rely on one. Typed bindings: `precompiles` in `@qorechain/evm`.

## JSON-RPC

Namespaces: `eth`, `net`, `web3` and `txpool`.

Work as on Ethereum, among others: `eth_feeHistory`, `eth_createAccessList`,
`eth_getBlockReceipts`, `eth_getHeaderByNumber`, the filter methods
(`eth_newFilter`, `eth_newBlockFilter`, `eth_newPendingTransactionFilter`),
`txpool_status`, `web3_sha3`, `net_peerCount`.

Different from Ethereum:

| Method | Behaviour |
| --- | --- |
| `eth_getProof` | Works, but returns the chain's IAVL proofs, not Merkle-Patricia proofs |
| `eth_getLogs` | At most 10,000 blocks per query (`maximum [from, to] blocks distance: 10000`) |
| `eth_subscribe` | WebSocket only (over HTTP: "notifications not supported") |
| `eth_accounts`, `eth_sign`, `eth_sendTransaction` | Refused: the node holds no accounts ("account unlock with HTTP access is forbidden"). Sign locally and use `eth_sendRawTransaction` |
| `txpool_content` | Refused on the public endpoints; `txpool_status` works |

Not available (`-32601`): every `debug_*`, `personal_*`, `admin_*` and
`miner_*` method, `trace_*`, `eth_coinbase`, `eth_mining`, `eth_hashrate`,
`eth_getWork`, `eth_submitWork`, `eth_blobBaseFee`, `eth_simulateV1`,
`eth_callMany`, `eth_signTransaction`, `eth_pendingTransactions`,
`eth_config`. Tools that need transaction traces (some debuggers, some
indexers) do not work against the public endpoints.

## Tooling support

- **viem / wagmi / RainbowKit:** QoreChain is not yet in `viem/chains`. Import
  `qorechain` and `qorechainTestnet` from `@qorechain/evm` instead.
- **Contract verification:** Sourcify does not list chain ids 9800 or 9801 yet.
- **SVM:** the SVM lane is not open.

## To be confirmed

- A public WebSocket endpoint for mainnet.
- Whether the public explorer offers, or will offer, an Etherscan-compatible
  verification API.
