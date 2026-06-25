# connect-keplr

Connect a Keplr/Leap browser wallet and send a QOR transfer with
`@qorechain/sdk`.

This is a **browser** example — injected wallets (`window.keplr` /
`window.leap`) only exist in a browser. Bundle `index.ts` into a web app (e.g.
with Vite) and call the exported `run()` from a button handler.

```bash
# type-check as part of the workspace
pnpm --filter @qorechain/example-connect-keplr typecheck
```

Under Node it prints guidance and exits cleanly (there is no `window`).
