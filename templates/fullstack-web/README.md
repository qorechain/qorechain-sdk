# QoreChain full-stack web starter

A minimal [Vite](https://vitejs.dev) + React + TypeScript dApp that uses
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) to:

- connect to QoreChain testnet (`createClient`),
- read a native balance for an address you enter, and
- read the tokenomics overview (`qor_getTokenomicsOverview`).

## Prerequisites

- **Node.js >= 20**.
- A reachable QoreChain **REST** endpoint (`VITE_QORE_REST_URL`) for balances and
  an **EVM JSON-RPC** endpoint (`VITE_QORE_EVM_RPC_URL`) for the `qor_*`
  namespace. Both default to localhost. **Note:** mainnet is not yet live; use a
  testnet endpoint or a local node.

## Setup & run

```sh
pnpm install
cp .env.example .env   # the scaffolder already does this for you
pnpm dev               # http://localhost:5173
```

Configure endpoints in `.env` (only `VITE_`-prefixed vars are exposed to the
browser):

| Variable               | Purpose                | Default                 |
| ---------------------- | ---------------------- | ----------------------- |
| `VITE_QORE_REST_URL`     | Cosmos REST (balances) | `http://localhost:1317` |
| `VITE_QORE_EVM_RPC_URL`  | EVM JSON-RPC (`qor_*`) | `http://localhost:8545` |

## Build / type-check

```sh
pnpm typecheck   # tsc --noEmit
pnpm build       # type-check + vite build
```

## Using `@qorechain/sdk` before it is published

`@qorechain/sdk` is published to npm — once published, `pnpm install` just
works. Until then, scaffold with the CLI's `--local` flag to rewrite the
dependency to a `file:` link into the SDK monorepo, after building the workspace
packages:

```sh
# at the qorechain-sdk monorepo root
pnpm -r build
# then scaffold with --local
npx create-qorechain-dapp my-dapp --template fullstack-web --local
```
