# evm-nft

Read ERC-721 NFT metadata over the QoreChain EVM Engine using `@qorechain/evm`.

```bash
pnpm --filter @qorechain/example-evm-nft start
```

Environment:

- `QORE_EVM_RPC_URL` — EVM JSON-RPC endpoint (default `http://localhost:8545`)
- `QORE_NFT_ADDRESS` — an ERC-721 contract address (required to read)
- `QORE_NFT_TOKEN_ID` — token id to inspect (default `1`)
- `QORE_EVM_ADDRESS` — account to read `balanceOf` for

Needs a reachable EVM JSON-RPC and a deployed ERC-721 contract.
