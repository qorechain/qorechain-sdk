# react-dapp

A minimal React dApp built on [`@qorechain/react`](../../packages/react),
showing the full flow:

- `QoreChainProvider` holding the read client + connection state
- `<ConnectButton/>` for multi-wallet connect (Keplr / Leap / MetaMask)
- `useBalance()` with auto-refresh
- `<PqcStatusBadge/>` indicating whether the account has a registered
  post-quantum (ML-DSA-87) key

## Run

```bash
pnpm install
pnpm --filter @qorechain/example-react-dapp dev
```

Edit the `endpoints` in `src/App.tsx` to point at your node, then connect a
wallet. Type-check it with:

```bash
pnpm --filter @qorechain/example-react-dapp typecheck
```
