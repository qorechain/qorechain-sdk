# QoreChain EVM + Solidity starter

A minimal QoreChain EVM dApp: a Solidity `Counter` contract plus a
[viem](https://viem.sh)-based script that deploys it and exercises it (read →
increment → read) using [`@qorechain/evm`](https://github.com/qorechain/qorechain-sdk).

## Prerequisites

- **Node.js >= 20**.
- A reachable **QoreChain EVM JSON-RPC** endpoint (`QORE_EVM_RPC_URL`). With no
  value set it defaults to `http://localhost:8545`. **Note:** mainnet is not yet
  live; use a testnet endpoint or a local node.
- A **funded EVM account** private key (`QORE_EVM_PRIVATE_KEY`, `0x`-prefixed,
  32 bytes). It needs enough QOR to cover gas for the deploy + one write.

## Setup

```sh
# install dependencies (use the package manager you scaffolded with)
pnpm install

# configure your endpoint + key
cp .env.example .env   # the scaffolder already does this for you
$EDITOR .env
```

Environment variables (see `.env.example`):

| Variable               | Purpose                                         | Default                 |
| ---------------------- | ----------------------------------------------- | ----------------------- |
| `QORE_EVM_RPC_URL`     | EVM JSON-RPC endpoint                           | `http://localhost:8545` |
| `QORE_EVM_PRIVATE_KEY` | Funded EVM account private key (`0x…`)          | _(required)_            |
| `QORE_COUNTER_INITIAL` | Initial counter value passed to the constructor | `0`                     |

## Run

```sh
pnpm deploy
```

This deploys `Counter`, prints the deployed address, reads `count()`, calls
`increment()`, and reads `count()` again.

## Project layout

```
contracts/
  Counter.sol            # the Solidity source
  Counter.artifact.ts    # compiled ABI + creation bytecode (committed)
scripts/
  deploy.ts              # viem deploy + interact script using @qorechain/evm
```

## Compiling the contract

To keep the toolchain light, this template ships a **pre-compiled artifact**
(`contracts/Counter.artifact.ts`) so `pnpm deploy` works without a Solidity
build pipeline. If you edit `Counter.sol`, regenerate the artifact with `solc`:

```sh
# produces out/Counter_sol_Counter.abi and out/Counter_sol_Counter.bin
npx solc@0.8.24 --optimize --abi --bin -o out contracts/Counter.sol
```

Then copy the `.abi` JSON into `counterAbi` and the `.bin` hex (prefixed with
`0x`) into `counterBytecode` in `contracts/Counter.artifact.ts`. (You can also
wire in a fuller toolchain such as Foundry or Hardhat if you prefer.)

## Using `@qorechain/evm` before it is published

`@qorechain/evm` is published to npm — once published, `pnpm install` just
works. Until then, scaffold with the CLI's `--local` flag to rewrite the
dependency to a `file:` link into the SDK monorepo, then build the workspace
packages first:

```sh
# at the qorechain-sdk monorepo root
pnpm -r build
# then scaffold with --local
npx create-qorechain-dapp my-dapp --template evm-solidity --local
```
