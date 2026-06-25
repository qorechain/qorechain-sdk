# amm-swap

Build and broadcast an AMM `SwapExactIn` via the `@qorechain/sdk` message
composer and registry.

```bash
pnpm --filter @qorechain/example-amm-swap start
```

By default this is a **dry run** — it composes and prints the message offline.
Set `QORE_BROADCAST=1` (with a reachable node, a funded account, and a real pool)
to actually send.

Environment:

- `QORE_MNEMONIC` — funded account mnemonic (defaults to the public test one)
- `QORE_RPC_URL` / `QORE_REST_URL` — node endpoints
- `QORE_POOL_ID` — AMM pool id (default `1`)
- `QORE_DENOM_IN` / `QORE_AMOUNT_IN` — input coin (default `uqor` / `1000000`)
- `QORE_DENOM_OUT` / `QORE_MIN_OUT` — output denom + min received
- `QORE_BROADCAST=1` — actually sign and broadcast
