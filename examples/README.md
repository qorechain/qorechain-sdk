# qorechain-sdk examples

Runnable TypeScript examples for the QoreChain SDK. Each folder is a
self-contained pnpm workspace package depending on the `@qorechain/*` packages
via `workspace:*`, with its own `README.md`, `.env.example`, and a single
`index.ts`.

| Example | Shows | Needs a live node? |
|---|---|---|
| [`connect-and-query`](./connect-and-query) | `createClient`, read a native balance, read tokenomics overview | Yes |
| [`send-qor`](./send-qor) | derive a native account, sign, broadcast a QOR transfer | Yes (+ funded account) |
| [`pqc-hybrid-sign`](./pqc-hybrid-sign) | ML-DSA-87 sign/verify + build a hybrid tx | **No — runs offline** |
| [`evm-precompile`](./evm-precompile) | EVM precompiles + ERC-20 `balanceOf` | Yes |
| [`svm-transfer`](./svm-transfer) | build a SOL transfer + memo instruction | No to build; yes to send |
| [`cosmwasm-query`](./cosmwasm-query) | smart-query a CosmWasm contract | Yes (+ deployed contract) |
| [`read-tokenomics`](./read-tokenomics) | `qor_getBurnStats` / `qor_getXQOREPosition` / `qor_getInflationRate` | Yes |
| [`connect-keplr`](./connect-keplr) | connect a Keplr/Leap browser wallet → send | Browser (web app) |
| [`amm-swap`](./amm-swap) | compose + broadcast an AMM `SwapExactIn` | No to compose; yes to send |
| [`register-sidechain`](./register-sidechain) | `createMultilayerClient`: register a sidechain + paychain, anchor state, route a tx, read layers | No to compose; yes to send/read |
| [`rollup-lifecycle`](./rollup-lifecycle) | `createRollupClient`: create rollup, submit batch, read status/latest batch, execute a withdrawal | No to compose; yes to send/read |
| [`subscribe-blocks`](./subscribe-blocks) | stream new blocks over the consensus RPC | Yes |
| [`evm-nft`](./evm-nft) | read ERC-721 NFT metadata | Yes (+ deployed NFT) |

## Running an example

From the repo root, install once, then run any example:

```bash
pnpm install
pnpm --filter @qorechain/example-pqc-hybrid-sign start
```

Or from inside an example folder:

```bash
cd examples/pqc-hybrid-sign
pnpm start        # runs index.ts via tsx
pnpm typecheck    # tsc --noEmit
```

Each example reads endpoints/mnemonics from environment variables with sane
localhost defaults — copy that folder's `.env.example` and adjust. Network
examples fail gracefully with a hint if no node is reachable.

> Use only test mnemonics / generated keys. Never commit real secrets.
