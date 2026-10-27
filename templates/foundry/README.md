# QoreChain Foundry starter

A [Foundry](https://getfoundry.sh) project for the QoreChain EVM: a `Counter`
contract, its tests, a deploy script, and a small helper that opens the EVM
authorisation window your deployer needs.

| Network | EVM chain id | RPC (named in `foundry.toml`) |
| --- | --- | --- |
| Testnet (`qorechain-diana`) | 9800 | `qorechain_testnet` = `https://evm-testnet.qore.host` |
| Mainnet (`qorechain-vladi`) | 9801 | `qorechain` = `https://evm.qore.host` |

## Prerequisites

- Foundry (`forge`), installed with `foundryup`.
- Node.js 20 or later and a package manager, for the window helper.
- A funded account on the network you deploy to.

## Setup

```sh
pnpm install          # the window helper's dependencies
pnpm forge-std        # forge install foundry-rs/forge-std --no-git
cp .env.example .env  # the scaffolder already did this
```

Put the deployer's key in `.env` (`PRIVATE_KEY`). Never commit `.env`.

## Build and test

```sh
forge build
forge test
```

Tests run on Foundry's local EVM and need no network.

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

What to know about the window:

- It bounds the number of blocks, the number of EVM transactions, and the total
  they may spend: value **plus** the maximum fee (gas limit x fee cap) of each
  transaction. Foundry sets the fee cap near twice the base fee (a dry run on
  the testnet priced a deploy at 200 gwei), so `pnpm window open` sizes the
  window for transactions of up to 3,000,000 gas at 250 gwei. Set
  `QORE_WINDOW_MAX_UQOR` to choose the total yourself.
- `blocks` is a block count, not a duration.
- Opening a window is a native-lane transaction, and it **advances the
  account's nonce**. Open the window first, then deploy; Foundry reads the
  nonce when it broadcasts.
- Opening replaces any earlier window.

## Deploy

```sh
pnpm window open
forge script script/Counter.s.sol --rpc-url qorechain_testnet --broadcast
# or: pnpm deploy:testnet
```

The script reads `PRIVATE_KEY` and `COUNTER_INITIAL` from `.env`.

Fees: on both networks today `eth_gasPrice` answers 112.5 gwei (a 100 gwei
base fee plus a 12.5 gwei priority fee). Foundry's defaults pick this up.

Contract verification: Sourcify does not list chain ids 9800 and 9801 yet.

## Project layout

```
src/Counter.sol           the contract
test/Counter.t.sol        Foundry tests
script/Counter.s.sol      the deploy script
scripts/window.ts         the EVM window helper (pnpm window)
foundry.toml              compiler settings and the named RPC endpoints
```
