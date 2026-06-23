# QoreChain SDK documentation site

The documentation site for `qorechain-sdk`, built with
[Docusaurus](https://docusaurus.io).

This is a **standalone** project — it is intentionally *not* part of the
monorepo's pnpm workspace. It has its own `package.json` and its own install, so
it never affects `pnpm install` / `pnpm -r build` / `pnpm -r test` at the repo
root.

## Develop

```sh
cd docs
npm install
npm start        # dev server at http://localhost:3000
```

## Build

```sh
cd docs
npm install
npm run build    # production build into docs/build (gitignored)
npm run serve    # preview the production build
```

## API reference (TypeDoc)

The TypeScript SDK ships TSDoc and a TypeDoc config:

```sh
# from the monorepo root
pnpm --filter @qorechain/sdk docs:api
```

`docs/typedoc.json` points at the core package's entry point so you can also
generate from this project. Generated API output is not committed.
