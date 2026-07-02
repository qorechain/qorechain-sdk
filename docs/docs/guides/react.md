---
id: react
title: React kit
sidebar_position: 13
---

# React kit (`@qorechain/react`)

`@qorechain/react` is the official React layer over `@qorechain/sdk`: one
provider, a handful of hooks, and two drop-in components — including a one-line
**Quantum-safe** badge. It makes building a quantum-safe dApp the default path.

```bash
npm i @qorechain/react @qorechain/sdk react react-dom
```

`react` (>=18) is a peer dependency; `@qorechain/sdk` is a direct dependency.

## Provider

Wrap your app once in `QoreChainProvider`. It holds a single `createClient()`
instance plus the live wallet connection state that every hook reads from.

```tsx
import { QoreChainProvider } from "@qorechain/react";

function Root() {
  return (
    <QoreChainProvider
      config={{
        network: "testnet",
        endpoints: {
          rpc: "https://rpc-testnet.qore.host",
          rest: "https://api-testnet.qore.host",
          evmRpc: "https://evm-testnet.qore.host",
        },
      }}
    >
      <App />
    </QoreChainProvider>
  );
}
```

To switch networks at runtime, remount the provider with a different React `key`.
For tests, pass a pre-built (or mocked) `client` prop instead of `config`.

## Hooks

| Hook | Returns |
| --- | --- |
| `useQoreClient()` | The composed `QoreChainClient` for ad-hoc reads. |
| `useAccount()` | `{ addresses, address, isConnected, status, wallet }` — native / EVM / SVM addresses. |
| `useBalance(address?, options?)` | `{ data, isLoading, error, refetch }`; auto-refresh via `refreshInterval`. |
| `useConnect()` / `useWallet()` | `{ connect, disconnect, status, isConnecting, error }`. |
| `useTx()` | `{ send, sendTokens, status, data, error, isPending, reset }`. |
| `usePqcStatus(address?, options?)` | `{ data, isRegistered, isLoading, error, refetch }`. |

### Connecting wallets

`useConnect` wraps the **existing** SDK adapters:

```ts
const { connect } = useConnect();
await connect({ kind: "keplr" }); // or "leap" | "evm" | "svm"
```

- **keplr / leap** — Cosmos wallets via `getCosmosWallet`. Suggests and enables
  the chain, returns a CosmJS signer that is wired into a `TxClient`, so `useTx`
  can sign immediately. Sets `addresses.native`.
- **evm** — any injected EIP-1193 provider (`window.ethereum`, e.g. MetaMask) via
  `eth_requestAccounts`. Sets `addresses.evm`.
- **svm** — any injected Wallet-Standard provider (`window.solana`, e.g. Phantom)
  via `connect()`. Sets `addresses.svm`.

The EVM and SVM paths use the injected provider's standard request API directly,
so neither viem nor a Solana SDK is pulled in. Pass `provider` in the connect
options to inject a wallet for tests. Pair with `@qorechain/evm` /
`@qorechain/svm` for full per-VM tooling.

### Sending transactions

```tsx
import { msg } from "@qorechain/sdk";
import { useTx } from "@qorechain/react";

function Send() {
  const { sendTokens, isPending } = useTx();
  return (
    <button
      disabled={isPending}
      onClick={() =>
        sendTokens("qor1recipient…", [{ denom: "uqor", amount: "1000000" }])
      }
    >
      Send 1 QOR
    </button>
  );
}
```

`send([{ typeUrl, value }], opts)` takes raw messages from the `msg.*` composers
for anything beyond a bank transfer.

## Components

### `<ConnectButton/>`

A minimal, headless-ish connect / disconnect control. Pass `wallets` to offer a
picker, `className` / `style` to theme it, or a `children` render-prop for full
control:

```tsx
<ConnectButton wallets={["keplr", "leap", "evm"]} />
```

### `<QuantumSafeBadge/>`

Shows a **Quantum-safe** indicator when the address has a registered post-quantum
key (via `usePqcStatus`), otherwise a muted "Not quantum-safe" state. Defaults to
the connected account.

```tsx
<QuantumSafeBadge />
<QuantumSafeBadge address="qor1…" hideWhenUnsafe />
```

## Putting it together

```tsx
import {
  ConnectButton,
  QuantumSafeBadge,
  useAccount,
  useBalance,
} from "@qorechain/react";

function Dashboard() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance(undefined, { refreshInterval: 10_000 });
  return (
    <>
      <ConnectButton wallets={["keplr", "leap", "evm"]} />
      {isConnected && (
        <p>
          {balance?.amount ?? "…"} {balance?.denom} <QuantumSafeBadge />
        </p>
      )}
    </>
  );
}
```

See the runnable [`react-dapp` example](https://github.com/qorechain/qorechain-sdk/tree/main/examples/react-dapp)
and the [quantum-safe guide](./quantum-safe.md) for the underlying SDK calls.
