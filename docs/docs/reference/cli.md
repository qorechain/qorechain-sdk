---
id: cli
title: CLI — create-qorechain-dapp
sidebar_position: 2
---

# CLI: `create-qorechain-dapp`

Scaffold a new QoreChain dApp from an official starter template.

```bash
# interactive
npm create qorechain-dapp my-dapp
# or
npx create-qorechain-dapp my-dapp

# non-interactive (CI)
npx create-qorechain-dapp my-dapp --template evm-solidity --yes --no-install
```

> Publish-pending. Until published, run it from the monorepo
> (`cli/`) or with `--local` against a built workspace.

## Templates

| Template | Description |
| --- | --- |
| `evm-solidity` | A Solidity `Counter` contract + a viem deploy/interact script (`@qorechain/evm`). |
| `fullstack-web` | A Vite + React + TypeScript dApp reading balances and tokenomics (`@qorechain/sdk`). |

## Options

| Flag | Description |
| --- | --- |
| `-t, --template <name>` | Template to use (`evm-solidity` \| `fullstack-web`). |
| `--network <name>` | Network preset (`testnet`). mainnet is not yet live. |
| `--package-manager <pm>` | `pnpm` \| `npm` \| `yarn`. |
| `-y, --yes` | Skip prompts and use defaults. |
| `--no-install` | Do not install dependencies after scaffolding. |
| `--local` | Rewrite `@qorechain/*` deps to local `file:` links into the SDK monorepo. |
| `-h, --help` | Show help. |
| `-v, --version` | Print the version. |

## Local development against the workspace

`@qorechain/*` packages are published to npm; once published a plain
`npm install` works. Before then, use `--local` to point the scaffolded project
at the monorepo packages (build them first with `pnpm -r build`):

```bash
npx create-qorechain-dapp my-dapp --template fullstack-web --local
```
