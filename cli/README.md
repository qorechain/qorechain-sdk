# create-qorechain-dapp

Scaffold a new QoreChain dApp from an official starter template.

```sh
# interactive
npm create qorechain-dapp my-dapp
# or
npx create-qorechain-dapp my-dapp

# non-interactive (CI)
npx create-qorechain-dapp my-dapp --template evm-solidity --yes --no-install
```

## Templates

| Template        | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `evm-solidity`  | A Solidity `Counter` contract + a viem deploy/interact script (`@qorechain/evm`).    |
| `fullstack-web` | A Vite + React + TypeScript dApp reading balances and tokenomics (`@qorechain/sdk`). |

## Options

| Flag                       | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `-t, --template <name>`    | Template to use (`evm-solidity` \| `fullstack-web`).                        |
| `--network <name>`         | Network preset (`testnet` \| `mainnet`).                                    |
| `--package-manager <pm>`   | `pnpm` \| `npm` \| `yarn`.                                                  |
| `-y, --yes`                | Skip prompts and use defaults.                                              |
| `--no-install`             | Do not install dependencies after scaffolding.                             |
| `--local`                  | Rewrite `@qorechain/*` deps to local `file:` links into the SDK monorepo.  |
| `-h, --help`               | Show help.                                                                  |
| `-v, --version`            | Print the version.                                                          |

## Local development against the workspace

`@qorechain/*` packages are published to npm; once published a plain
`npm install` works. Before then, use `--local` to point the scaffolded project
at the monorepo packages (build them first with `pnpm -r build`):

```sh
npx create-qorechain-dapp my-dapp --template fullstack-web --local
```

## How templates are bundled

The templates live at the monorepo root in `templates/`. On `build` they are
copied into `cli/templates/` so the published npm package is self-contained; the
`scaffold()` function resolves them from either location.
