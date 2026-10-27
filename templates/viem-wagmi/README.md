# QoreChain viem + wagmi starter

A Vite + React dApp for the QoreChain EVM built on [wagmi](https://wagmi.sh)
and [RainbowKit](https://rainbowkit.com), with the QoreX wallet
(`@qorechain/qorex-rainbowkit`) and the chain definitions from
`@qorechain/evm`.

It connects a wallet, shows the latest block, the account's QOR balance and its
EVM authorisation window, and sends a zero-value transaction to itself so you
can see how the chain answers.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type-check and build for production
```

## Networks

`src/wagmi.ts` lists both QoreChain EVM chains, testnet first:

| Chain | Id | RPC |
| --- | --- | --- |
| `qorechainTestnet` | 9800 | `https://evm-testnet.qore.host` |
| `qorechain` | 9801 | `https://evm.qore.host` |

## Wallets

- **QoreX** (`qorexWallet`): found through EIP-6963. It answers
  `eth_chainId`, `eth_accounts`, `eth_requestAccounts` and
  `wallet_switchEthereumChain` today; its EVM signing methods are not
  available yet, so use it to connect and read.
- **Injected** (`injectedWallet`): any browser wallet that exposes an EIP-1193
  provider, for signing.

Neither uses WalletConnect. To add a WalletConnect-based wallet, set
`VITE_WALLETCONNECT_PROJECT_ID` in `.env`.

## Sending: the EVM authorisation window

QoreChain admits an EVM transaction only when the sender has a registered
**ML-DSA-87** key and a live **EVM authorisation window**. Both are set up on
QoreChain's native lane with the post-quantum key, so a browser wallet's
secp256k1 key can never authorise spending on its own.

The app reads the window with `evmWindowStatus` from `@qorechain/evm`. When a
send is refused, `classifyEvmWindowRejection(error)` tells you why:

| Result | Meaning |
| --- | --- |
| `no-pqc-key` | the account has no ML-DSA-87 key registered |
| `no-window` | no window is open |
| `exhausted` | the window ran out of blocks, transactions or value |
| `invalid` | the window parameters were refused |

Open the window from a wallet or tool that holds the account's post-quantum
key (for example the `pnpm window open` helper in the `foundry` and `hardhat`
templates), then send. Opening a window advances the account's nonce.
