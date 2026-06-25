# subscribe-blocks

Subscribe to new QoreChain blocks over the consensus RPC websocket using
`@qorechain/sdk`.

```bash
pnpm --filter @qorechain/example-subscribe-blocks start
```

Environment:

- `QORE_RPC_URL` — consensus RPC endpoint (default `http://localhost:26657`)
- `QORE_MAX_BLOCKS` — stop after this many blocks (default `3`)

Needs a reachable consensus RPC endpoint.
