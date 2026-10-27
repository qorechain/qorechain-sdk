# QoreChain Hardhat starter

A [Hardhat 3](https://hardhat.org) project for the QoreChain EVM, using the
viem toolbox: a `Counter` contract, tests on Hardhat's simulated network, an
Ignition deploy module, and a small helper that opens the EVM authorisation
window your deployer needs.

| Network | EVM chain id | Hardhat network | RPC |
| --- | --- | --- | --- |
| Testnet (`qorechain-diana`) | 9800 | `qorechainTestnet` | `https://evm-testnet.qore.host` |
| Mainnet (`qorechain-vladi`) | 9801 | `qorechain` | `https://evm.qore.host` |

## Prerequisites

- Node.js 22 or later (Hardhat 3 requires it).
- A funded account on the network you deploy to.

## Setup

```sh
pnpm install
cp .env.example .env   # the scaffolder already did this
```

Put the deployer's key in `.env` (`PRIVATE_KEY`), or store it encrypted with
`npx hardhat keystore set PRIVATE_KEY`. Never commit `.env`.

## Build and test

```sh
pnpm build    # hardhat build
pnpm test     # hardhat test, on the simulated network
```

## Before you deploy: open an EVM window

QoreChain admits an EVM transaction only when the sender has:

1. a registered **ML-DSA-87** key, and
2. a live **EVM authorisation window**.

Both are set up on QoreChain's native lane with messages signed with the
post-quantum key, so the secp256k1 key in `PRIVATE_KEY` can never authorise
spending on its own. A deploy from an account without them is refused, so do
this first:

```sh
pnpm window status     # account, PQC key, window
pnpm window register   # once per account: registers its ML-DSA-87 key
pnpm window open       # opens a window: 600 blocks, 5 transactions
```

The helper derives the account from `PRIVATE_KEY` (or from `QORE_MNEMONIC`
when set) and derives its ML-DSA-87 key from the same secret, so keep using the
same one. If the account already has a key registered by another wallet, open
the window from that wallet instead.

- The window bounds blocks, EVM transactions, and the total they may spend:
  value **plus** the maximum fee (gas limit x fee cap) of each transaction.
  `pnpm window open` sizes it for transactions of up to 3,000,000 gas at a
  250 gwei fee cap; set `QORE_WINDOW_MAX_UQOR` to choose the total yourself.
- `blocks` is a block count, not a duration.
- Opening a window **advances the account's nonce**. Open it first, then
  deploy.
- Opening replaces any earlier window.

## Deploy

```sh
pnpm window open
pnpm deploy:testnet
# = hardhat ignition deploy ignition/modules/Counter.ts --network qorechainTestnet
```

Pass `--parameters` to Ignition to change the initial count.

Contract verification: Sourcify does not list chain ids 9800 and 9801 yet.

## Project layout

```
contracts/Counter.sol          the contract
test/Counter.ts                tests (node:test + viem)
ignition/modules/Counter.ts    the deploy module
scripts/window.ts              the EVM window helper (pnpm window)
hardhat.config.ts              compiler settings and the QoreChain networks
```
