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

Each template is a complete, type-checking project with its own README.

## Workspace membership and `@qorechain/*` dependencies

These templates are **deliberately excluded** from the pnpm workspace (the root
`pnpm-workspace.yaml` globs `packages/*`, `cli`, and `examples/*` — not
`templates/*`). That keeps the published `@qorechain/sdk` / `@qorechain/evm`
version ranges in their `package.json` files from breaking `pnpm install` at the
repo root before those packages are published to npm.

To run a template against the local workspace before publish, scaffold it with
`create-qorechain-dapp --local`, which rewrites the `@qorechain/*` deps to
`file:` links into `packages/`. Build the workspace packages first
(`pnpm -r build`).

Templates are type-checked via a dedicated step (`scripts/typecheck-templates.sh`),
not via `pnpm -r`, since they are not workspace members.
