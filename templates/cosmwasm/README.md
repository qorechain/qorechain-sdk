# QoreChain CosmWasm starter

A CW20 token for QoreChain built on `cw20-base` from
[cw-plus](https://github.com/CosmWasm/cw-plus), used as a library, plus scripts
to build it, propose its upload, instantiate it and query it.

## What the networks allow

Read live from `/cosmwasm/wasm/v1/codes/params`:

| | Testnet (`qorechain-diana`) | Mainnet (`qorechain-vladi`) |
| --- | --- | --- |
| Upload code (`code_upload_access`) | `Nobody`: governance only | `Nobody`: governance only |
| Instantiate (`instantiate_default_permission`) | `Everybody` | `Nobody` |

So on both networks code is stored only by a **governance proposal**. On the
testnet, once a code is stored with an instantiate permission of `Everybody`,
anyone can create contracts from it. Mainnet has no stored codes today.

Use `/cosmwasm/wasm/v1/code` (singular) to list codes over REST; the plural
`/cosmwasm/wasm/v1/codes` and `/cosmwasm/wasm/v1/params` are not routes and
answer "Not Implemented".

## Prerequisites

- Rust, for `cargo test`.
- Docker, for the optimized build (it brings its own Rust toolchain).
- Node.js 20 or later, for the scripts.
- A testnet account with QOR and a registered ML-DSA-87 key. QoreChain signs
  native transactions hybrid (secp256k1 + ML-DSA-87); the scripts derive both
  keys from `QORE_MNEMONIC`.

## Test and build

```sh
cargo test               # unit test with cw-multi-test
pnpm build:wasm          # cosmwasm/optimizer -> artifacts/cw20_token.wasm
```

`Cargo.lock` pins dependency versions the optimizer's toolchain can build.

## Upload: a governance proposal

```sh
pnpm install
pnpm propose-store       # MsgSubmitProposal { MsgStoreCode } with the minimum deposit
pnpm query proposals     # follow the vote
pnpm query codes         # the code id, once the proposal passed
```

The proposal's `MsgStoreCode` is sent by the governance module, with an
instantiate permission of `Everybody`. The script refuses mainnet unless you set
`QORE_I_KNOW_THIS_IS_MAINNET=yes`. For a mainnet proposal, publish the source
and a reproducible build (the optimizer prints the checksum) so voters can
verify the binary.

## Instantiate and query (testnet)

```sh
QORE_CODE_ID=<id> pnpm instantiate
pnpm query token <contract>
pnpm query balance <contract> <qor1 address>
```

## Project layout

```
contracts/cw20-token/     the contract (cw20-base entry points)
scripts/build.sh          optimized build in Docker
scripts/propose-store.ts  governance upload proposal
scripts/instantiate.ts    instantiate a stored code
scripts/query.ts          REST queries
scripts/connect.ts        network, account and hybrid-signing client
```
