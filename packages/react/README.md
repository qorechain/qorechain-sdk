# @qorechain/react

Official **React hooks and components** for building
[QoreChain](https://github.com/qorechain/qorechain-sdk) dApps. It wraps
[`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk/tree/main/packages/ts) in an idiomatic React surface: one provider, a handful
of hooks, and two drop-in components - including a one-line badge that shows
whether an account has a registered PQC (ML-DSA-87) key.

```bash
npm i @qorechain/react @qorechain/sdk react react-dom
```

`react` (>=18) is a peer dependency; `@qorechain/sdk` is a direct dependency.

## Quick start

Wrap your app in `QoreChainProvider` once, then use the hooks anywhere below it:

```tsx
import {
  QoreChainProvider,
  ConnectButton,
  PqcStatusBadge,
  useAccount,
  useBalance,
} from "@qorechain/react";

function Wallet() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance(undefined, { refreshInterval: 10_000 });
  return (
    <div>
      <ConnectButton wallets={["keplr", "leap", "evm"]} />
      {isConnected && (
        <p>
          {balance?.amount ?? "…"} {balance?.denom} <PqcStatusBadge />
        </p>
      )}
    </div>
  );
}

export default function App() {
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
      <Wallet />
    </QoreChainProvider>
  );
}
```

## Provider

### `<QoreChainProvider config={...}>`

Holds a single `createClient()` instance and the live connection state. Place it
near the root of your app.

| Prop | Type | Description |
| --- | --- | --- |
| `config.network` | `"testnet" \| "mainnet"` | Network preset. Default `"testnet"`. |
| `config.endpoints` | `Partial<NetworkEndpoints>` | Endpoint overrides (`rpc`, `rest`, `evmRpc`, …). |
| `config.chainId` | `string` | Chain-id override. |
| `config.http` | `HttpOptions` | Shared transport options (timeout, headers, …). |
| `client` | `QoreChainClient` | Inject a pre-built (or mocked) client instead of building from `config`. |

To switch networks at runtime, remount the provider with a different React `key`.

## Hooks

### `useQoreClient()`

Returns the composed `QoreChainClient` for ad-hoc reads (`client.rest`,
`client.qor`, `client.fees`, …) not covered by a dedicated hook.

### `useAccount()`

Returns `{ addresses, address, isConnected, status, wallet }`. `addresses`
carries the connected `native` (bech32), `evm` (`0x…`), and/or `svm` (base58)
addresses; `address` is the primary one (native preferred).

### `useBalance(address?, options?)`

Reads a bank balance. Defaults to the connected native address and the network's
base denom (`uqor`). Returns `{ data, isLoading, error, refetch }`.

| Option | Type | Description |
| --- | --- | --- |
| `denom` | `string` | Denom to read. Default: network base denom. |
| `refreshInterval` | `number` | Poll interval in ms. `0` (default) disables polling. |
| `enabled` | `boolean` | Skip fetching when `false`. |

### `useConnect()` / `useWallet()`

Multi-wallet connect, wrapping the **existing** SDK adapters. Returns
`{ connect, disconnect, status, isConnecting, error }`.

```ts
const { connect } = useConnect();
await connect({ kind: "keplr" }); // or "leap" | "evm" | "svm"
```

| Wallet kind | Adapter | Result |
| --- | --- | --- |
| `keplr` / `leap` | `getCosmosWallet` (Native) - suggests + enables the chain, returns a CosmJS signer wired into a `TxClient` | `addresses.native`, signing enabled |
| `evm` | injected EIP-1193 provider (`window.ethereum`, e.g. MetaMask) via `eth_requestAccounts` | `addresses.evm` |
| `svm` | injected Wallet-Standard provider (`window.solana`, e.g. Phantom) via `connect()` | `addresses.svm` |

The EVM and SVM paths talk to the injected provider's standard request API
directly, so neither viem nor a Solana SDK is pulled in. Pass `provider` in
`ConnectOptions` to inject a wallet for tests or custom embedding. For full
EVM/SVM tooling pair this with `@qorechain/evm` / `@qorechain/svm`.

### `useTx()`

Sign + broadcast with the connected Native signer. Returns
`{ send, sendTokens, status, data, error, isPending, reset }`.

```ts
import { msg } from "@qorechain/sdk";
const { send, sendTokens } = useTx();

await sendTokens("qor1recipient…", [{ denom: "uqor", amount: "1000000" }]);
await send([msg.bank.send({ /* … */ })], { memo: "gm" });
```

### `usePqcStatus(address?, options?)`

Reads whether an address has a registered post-quantum (ML-DSA-87) key, via the SDK's `getPqcStatus` (`qor_getPQCKeyStatus`).
Returns `{ data, isRegistered, isLoading, error, refetch }`.

## Components

### `<ConnectButton wallets={[...]} />`

A minimal, headless-ish connect / disconnect control.

- One `wallets` entry → connects directly; several → renders a button per wallet.
- Once connected, shows the truncated address and a **Disconnect** action.
- Pass `className` / `style` to theme it, or a `children` render-prop for full
  control: `({ isConnected, isConnecting, address, connect, disconnect, error }) => ReactNode`.

### `<PqcStatusBadge address?/>`

Shows a **PQC key registered** indicator when the address has a registered
ML-DSA-87 key (via `usePqcStatus`), otherwise a muted "No PQC key" state. The
root element carries `data-pqc-status` (and, for existing stylesheets,
`data-quantum-safe`) set to `"loading"`, `"false"` or `"true"`.

`QuantumSafeBadge` (with `QuantumSafeBadgeProps` / `QuantumSafeRenderState`) is
the earlier name of this component and stays exported as a deprecated alias.

| Prop | Type | Description |
| --- | --- | --- |
| `address` | `string` | Address to check. Default: connected account. |
| `hideWhenUnsafe` | `boolean` | Render nothing when the address has no registered PQC key. |
| `safeLabel` / `unsafeLabel` | `string` | Override the labels. |
| `className` / `style` | - | Theming. |
| `children` | render-prop | `({ isRegistered, isLoading, error }) => ReactNode`. |

## Post-quantum hybrid signing

`@qorechain/react` shows an account's PQC key status in the UI, and the core SDK
registers an ML-DSA-87 key and switches the account to hybrid signing in one
call (`ensurePqcRegistered` / `migrateToHybrid`). On the native lane the chain
requires the hybrid secp256k1 + ML-DSA-87 signature by default; the EVM lane
uses a bounded authorisation window opened from the native lane; the SVM lane is
not open yet. See the
[post-quantum hybrid signing guide](https://docs.qorechain.io/sdk/guides/quantum-safe).

## License

Apache-2.0
