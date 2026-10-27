# viem chain definitions (prepared, not submitted)

Files for a pull request to [wevm/viem](https://github.com/wevm/viem) that adds
QoreChain to `viem/chains`. Until it is merged, import the same definitions from
`@qorechain/evm` (`qorechain`, `qorechainTestnet`).

## Prerequisite

viem's contributing guide requires the chain to be merged into
[ethereum-lists/chains](https://github.com/ethereum-lists/chains) first. On
27 October 2026 `https://chainid.network/chains_mini.json` did not list chain ids
9800 or 9801, so open this pull request only after the ethereum-lists entries
are merged.

## Where the files go in the viem repository

| File here | Path in viem |
| --- | --- |
| `qorechain.ts` | `src/chains/definitions/qorechain.ts` |
| `qorechainTestnet.ts` | `src/chains/definitions/qorechainTestnet.ts` |
| `changeset.md` | `.changeset/<any-name>.md` |

And two export lines in `src/chains/index.ts`, kept in alphabetical order:

```ts
export { qorechain } from './definitions/qorechain.js'
export { qorechainTestnet } from './definitions/qorechainTestnet.js'
```

There is no `multicall3` entry: the canonical Multicall3 address
(`0xca11bde05977b3631167028862be2a173976ca11`) has no code on either network
today. Add it once it is deployed and verified.

## Pull request text

Title: `feat(chains): add QoreChain and QoreChain Testnet`

> Adds QoreChain (chain id 9801) and QoreChain Testnet (chain id 9800).
>
> - `id`: 9801 / 9800, as returned by `eth_chainId` on the RPC endpoints below
> - `name`: QoreChain / QoreChain Testnet
> - `nativeCurrency`: QOR, 18 decimals on the EVM
> - `rpcUrls.default`: `https://evm.qore.host` / `https://evm-testnet.qore.host`
>   (testnet WebSocket `wss://evm-ws-testnet.qore.host`)
> - `blockExplorers.default`: `https://explore.qore.network`
> - `testnet: true` on the testnet
>
> ethereum-lists/chains: `eip155-9801.json`, `eip155-9800.json` (link the merged
> entries here).
>
> Note for users: on QoreChain an EVM transaction is accepted only from an
> account with a registered ML-DSA-87 key and an open EVM authorisation window,
> both set up on the chain's native lane. Reads and simulation work as usual.
