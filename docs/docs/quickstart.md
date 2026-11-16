---
id: quickstart
title: Quickstart
sidebar_position: 3
---

# Quickstart

From zero to a sent transaction. This page uses the TypeScript SDK
(`@qorechain/sdk`); short connect-and-read snippets for Python, Go, and Rust
follow at the end.

## 1. Connect

`createClient()` resolves a network and composes the read clients, a fee helper,
and a lazy signing entrypoint. It targets the public testnet
(`qorechain-diana`) by default, on its public endpoints (from SDK 0.12.0).

```ts
import { createClient } from "@qorechain/sdk";

// Testnet (chain id "qorechain-diana"), public endpoints.
const client = createClient();

// Mainnet (chain id "qorechain-vladi"), public endpoints.
const main = createClient({ network: "mainnet" });

// Your own node: override any endpoint; the rest keep the preset's values.
const mine = createClient({
  network: "mainnet",
  endpoints: { rest: "https://lcd.my-node.example", rpc: "https://rpc.my-node.example" },
});

// A node on this machine (localhost ports).
const local = createClient({ network: "localnet" });
```

The public testnet endpoints are rate limited per IP; production traffic should
use its own node. The presets, and the endpoints they leave unset (gRPC, SVM,
and the EVM WebSocket on mainnet), are listed in
[Network & endpoints](reference/network.md).

## 2. Derive an account

A single mnemonic derives native (`qor1…`), EVM (`0x…`), and SVM (base58)
accounts via independent derivation paths.

```ts
import {
  generateMnemonic,
  deriveNativeAccount,
} from "@qorechain/sdk";

const mnemonic = generateMnemonic(); // 12 words (pass 256 for 24 words)

const native = await deriveNativeAccount(mnemonic);
console.log(native.address); // "qor1..."  (Native secp256k1)
```

See [Accounts & PQC signing](concepts/accounts-pqc.md) for EVM/SVM derivation
and the full derivation table.

## 3. Read a balance

```ts
// Native bank balances over REST.
const balances = await client.rest.getAllBalances(native.address);

// Chain module state over REST, e.g. burn statistics.
const burn = await client.rest.getBurnStats();
```

## 4. Send a QOR transfer

Derive a native account and its ML-DSA-87 key, register that key once, connect
a `TxClient` that signs hybrid (secp256k1 + ML-DSA-87), and send tokens.
QoreChain refuses a classical-only signature from an account with a registered
PQC key, and an account without one can only send the registration. Use
`toBase("1.5")` to convert QOR to base `uqor`.

```ts
import {
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  ensurePqcRegistered,
  toBase,
} from "@qorechain/sdk";

const client = createClient({
  endpoints: {
    rpc: "https://rpc-testnet.qore.host",
    rest: "https://api-testnet.qore.host",
  },
});

const account = await deriveNativeAccount(mnemonic);
const pqcKeypair = derivePqcCanonical(account.address, mnemonic);

// Adapt the raw secp256k1 key into an offline signer bound to the "qor" prefix.
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");

// Register the PQC key once (the one message accepted with a classical
// signature); nothing is sent when this key is already registered.
const classical = await client.connectTx(signer);
await ensurePqcRegistered(classical, { pqcKeypair, rest: "https://api-testnet.qore.host" });
classical.disconnect();

// Connect a tx client that signs every transaction hybrid.
const tx = await client.connectTx(signer, { pqcKeypair });

// Send 1.5 QOR. The default fee "auto" simulates the hybrid transaction.
const result = await tx.bankSend("qor1recipientaddress...", [
  { denom: "uqor", amount: toBase("1.5") },
]);

console.log(result.transactionHash);
```

`toBase("1.5")` returns `"1500000"` (QOR has 10^6 base `uqor` units).

## Other languages: connect & read

These mirror the same network presets and read surface.

### Python

```python
from qorsdk import create_client

client = create_client()  # testnet preset (public endpoints)
print(client.network.chain_id)  # "qorechain-diana"

balances = client.rest.get_all_balances("qor1...")
burn = client.rest.get_burn_stats()
client.close()
```

### Go

```go
import "github.com/qorechain/qorechain-sdk/packages/go/qorechain/client"

c, err := client.CreateClient(client.Options{}) // defaults to "testnet"
if err != nil {
    panic(err)
}
fmt.Println(c.Network.ChainID) // qorechain-diana

balances, err := c.REST.GetAllBalances("qor1...")
burn, err := c.REST.GetBurnStats()
```

### Rust

```rust
use qorechain::ClientBuilder;

#[tokio::main]
async fn main() -> qorechain::Result<()> {
    let client = ClientBuilder::new().build()?; // defaults to "testnet"
    let balances = client.rest.get_all_balances("qor1...").await?;
    let burn = client.rest.get_burn_stats().await?;
    let _ = (balances, burn);
    Ok(())
}
```

## Next

- [Guides](guides/evm.md) - work with each VM (EVM, SVM, CosmWasm, cross-VM).
- [Accounts & PQC signing](concepts/accounts-pqc.md) - HD derivation and
  post-quantum signing.
- [Network & endpoints reference](reference/network.md).
