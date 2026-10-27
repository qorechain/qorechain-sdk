# QoreChain dApp templates

Starter templates used by [`create-qorechain-dapp`](../cli). Scaffold one with:

```sh
npm create qorechain-dapp my-dapp -- --template <name>
# or
npx create-qorechain-dapp my-dapp --template <name>
```

| Template        | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `evm-solidity`  | A Solidity `Counter` contract + a viem deploy/interact script (`@qorechain/evm`).    |
| `fullstack-web` | A Vite + React + TypeScript dApp reading balances and tokenomics (`@qorechain/sdk`). |
| `rollup-app`    | A rollup + sidechain/paychain app using the `RollupClient` + multilayer helper (`@qorechain/sdk`). |
| `foundry`       | A Foundry project (contract, tests, deploy script, named RPC endpoints) + an EVM window helper. |
| `hardhat`       | A Hardhat 3 + viem project (contract, tests, Ignition deploy) + an EVM window helper. |
| `viem-wagmi`    | A Vite + React + wagmi + RainbowKit dApp with the QoreX wallet (`@qorechain/qorex-rainbowkit`). |
| `cosmwasm`      | A CW20 token on `cw20-base` (cw-plus), optimized build, governance upload proposal, testnet scripts. |

Each template is a complete, type-checking project with its own README.

On QoreChain every EVM transaction needs a registered ML-DSA-87 key and a live
EVM authorisation window; the `foundry` and `hardhat` templates include
`pnpm window` to set both up before a deploy. CosmWasm code upload is
governance-only on both networks.

`scaffold-eth-extension/` is not a `create-qorechain-dapp` template: it is a
[Scaffold-ETH 2](https://scaffoldeth.io) extension, used with
`npx create-eth@latest -e <github-org>/<repo>:<branch>`.

## Workspace membership and `@qorechain/*` dependencies

These templates are **deliberately excluded** from the pnpm workspace (the root
`pnpm-workspace.yaml` globs `packages/*`, `cli`, and `examples/*` - not
`templates/*`). That keeps the published `@qorechain/sdk` / `@qorechain/evm`
version ranges in their `package.json` files from breaking `pnpm install` at the
repo root before those packages are published to npm.

To run a template against the local workspace before publish, scaffold it with
`create-qorechain-dapp --local`, which rewrites the `@qorechain/*` deps to
`file:` links into `packages/`. Build the workspace packages first
(`pnpm -r build`).

Templates are type-checked via a dedicated step (`scripts/typecheck-templates.sh`),
not via `pnpm -r`, since they are not workspace members.
