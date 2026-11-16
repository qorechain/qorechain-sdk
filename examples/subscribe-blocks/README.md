# subscribe-blocks

Subscribe to new QoreChain blocks over the consensus RPC websocket using
`@qorechain/sdk`.

```bash
pnpm --filter @qorechain/example-subscribe-blocks start
```

Environment:

- `QORE_RPC_URL` - consensus RPC websocket endpoint (default `ws://localhost:26657`;
  on testnet `wss://rpc-testnet.qore.host`). An `http://` or `https://` URL is
  switched to `ws://` or `wss://`.
- `QORE_MAX_BLOCKS` - stop after this many blocks (default `3`)

Needs a reachable consensus RPC endpoint.
