# QoreChain extension for Scaffold-ETH 2 (prepared, not submitted)

A [Scaffold-ETH 2](https://scaffoldeth.io) extension, in the layout `create-eth`
expects for third-party extensions. It adds QoreChain to a new Scaffold-ETH 2
app:

- `scaffold.config.ts`: QoreChain Testnet (9800) and QoreChain (9801) as target
  networks, with the chain definitions from `@qorechain/evm`.
- Hardhat: `qorechainTestnet` and `qorechain` networks using the deployer key.
- Foundry: `qorechainTestnet` and `qorechain` RPC endpoints.
- A `/qorechain` page (and a header link) that shows the connected account's
  EVM authorisation window.

The extension needs `@qorechain/evm` 0.11.0 or later (the release that adds the
chain definitions and `evmWindowStatus`).

## Use it

Scaffold-ETH 2 installs an extension from a GitHub repository whose root holds
the `extension/` directory. Publish this directory as its own repository (or
branch), then:

```bash
npx create-eth@latest -e <github-org>/<repo>:<branch>
```

## Deploying to QoreChain

Every EVM transaction on QoreChain, a deploy included, needs a registered
ML-DSA-87 key and a live EVM authorisation window for the deployer. Both are set
up on QoreChain's native lane with the post-quantum key; the deployer's
secp256k1 key alone cannot do it. Before `yarn deploy --network qorechainTestnet`:

1. Register the deployer's ML-DSA-87 key (once per account).
2. Open a window, then deploy. Opening it advances the account's nonce.

The `foundry` and `hardhat` templates of `create-qorechain-dapp` include a
`pnpm window` helper for both steps, and the QoreChain SDK documents the
messages: <https://github.com/qorechain/qorechain-sdk>.

Contract verification: Sourcify does not list chain ids 9800 and 9801 yet.

## Layout

```
extension/
  packages/
    nextjs/
      package.json                     adds @qorechain/evm
      scaffold.config.ts.args.mjs      target networks
      components/Header.tsx.args.mjs   header link
      app/qorechain/page.tsx           EVM window page
    hardhat/hardhat.config.ts.args.mjs QoreChain networks
    foundry/foundry.toml.args.mjs      QoreChain RPC endpoints
```

## Catalog pull request text

Third-party extensions are listed in
[scaffold-eth/create-eth-extensions](https://github.com/scaffold-eth/create-eth-extensions)
and the Scaffold-ETH docs. Proposed entry:

> **QoreChain**: `npx create-eth@latest -e <github-org>/<repo>:<branch>`
>
> Adds QoreChain (chain id 9801) and QoreChain Testnet (9800) to Scaffold-ETH 2:
> target networks, Hardhat networks, Foundry RPC endpoints, and a page that
> shows the account's EVM authorisation window. On QoreChain every EVM
> transaction needs a registered ML-DSA-87 key and an open authorisation window,
> set up on the chain's native lane; the extension's README explains the steps.
> Works with both Hardhat and Foundry.
