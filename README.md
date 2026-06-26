# qorechain-sdk

Official multi-language SDK and developer kit for building decentralized applications on the QoreChain network — a quantum-safe, triple-VM Layer 1.

QoreChain is a triple-VM Layer 1 with first-class support for CosmWasm,
EVM/Solidity, and SVM smart contracts, plus IBC interoperability. SDKs are
available for **TypeScript, Python, Go, Rust, and Java** — all published at
`0.3.x`.

## Packages

| Package | Language | Install | Import |
| --- | --- | --- | --- |
| `@qorechain/sdk` | TypeScript | `npm i @qorechain/sdk` | `@qorechain/sdk` |
| `@qorechain/evm` | TS — EVM adapter (viem peer) | `npm i @qorechain/evm viem` | `@qorechain/evm` |
| `@qorechain/svm` | TS — SVM adapter | `npm i @qorechain/svm @solana/web3.js` | `@qorechain/svm` |
| `qorechain-sdk` | Python | `pip install qorechain-sdk` | `import qorsdk` |
| `qorechain-sdk` | Rust | `cargo add qorechain-sdk` | `use qorechain` |
| Go module | Go | `go get github.com/qorechain/qorechain-sdk/packages/go` | `.../packages/go` |
| `io.github.qorechain:qorechain-sdk` | Java | `implementation("io.github.qorechain:qorechain-sdk:0.3.0")` | `io.github.qorechain` |
| `create-qorechain-dapp` | CLI scaffolder | `npm create qorechain-dapp@latest` | — |

> **Import names:** the Python distribution `qorechain-sdk` imports as `qorsdk`;
> the Rust crate `qorechain-sdk` imports as `qorechain`.

Per-language guides: [TypeScript](./packages/ts/README.md) ·
[Python](./packages/py/README.md) · [Go](./packages/go/README.md) ·
[Rust](./packages/rust/README.md) · [Java](./packages/java/README.md). Full
documentation lives in [`docs/`](./docs).

## Quickstart (TypeScript)

### Connect

`createClient()` targets the public testnet by default. The default endpoints
point at localhost, so pass `endpoints` to talk to a real node.

```ts
import { createClient } from "@qorechain/sdk";

// Testnet (chain id "qorechain-diana"), default localhost endpoints.
const client = createClient();

// Point at a real node by overriding endpoints.
const remote = createClient({
  endpoints: {
    rest: "https://rest.testnet.example",   // Cosmos REST (LCD)
    rpc: "https://rpc.testnet.example",      // consensus RPC (for signing)
    evmRpc: "https://evm.testnet.example",   // EVM + qor_ JSON-RPC
  },
});

// Mainnet (chain id "qorechain-vladi") is live; select it and point at a node.
const main = createClient({
  network: "mainnet",
  endpoints: {
    rest: "https://rest.mainnet.example",
    rpc: "https://rpc.mainnet.example",
    evmRpc: "https://evm.mainnet.example",
  },
});
```

### Accounts

A single mnemonic derives native (`qor1…`), EVM (`0x…`), and SVM (base58)
accounts via independent derivation paths.

```ts
import {
  generateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "@qorechain/sdk";

const mnemonic = generateMnemonic(); // 12 words (pass 256 for 24 words)

const native = await deriveNativeAccount(mnemonic);
console.log(native.address); // "qor1..."  (Cosmos-style secp256k1)

const evm = await deriveEvmAccount(mnemonic);
console.log(evm.address); // "0x..."   (EIP-55 checksummed)

const svm = await deriveSvmAccount(mnemonic);
console.log(svm.address); // base58 ed25519 public key
```

### Read on-chain state

```ts
// Cosmos bank balances over REST.
const balances = await client.rest.getAllBalances(native.address);

// A typed qor_ JSON-RPC call.
const tokenomics = await client.qor.getTokenomicsOverview();
```

### Send a transfer

Derive a native account, adapt its private key into a signer, connect a
`TxClient`, and send tokens. Use `toBase("1.5")` to convert QOR to base `uqor`.

```ts
import {
  createClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
  toBase,
} from "@qorechain/sdk";

const client = createClient({
  endpoints: {
    rpc: "https://rpc.testnet.example",
    rest: "https://rest.testnet.example",
  },
});

const account = await deriveNativeAccount(mnemonic);

// Adapt the raw secp256k1 key into an offline signer bound to the "qor" prefix.
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");

// Connect a tx client at the consensus RPC endpoint.
const tx = await client.connectTx(signer);

// Estimate a fee, then send 1.5 QOR.
const fee = await client.fees.estimate(); // or "fast" | "normal" | "slow"
const result = await tx.bankSend(
  "qor1recipientaddress...",
  [{ denom: "uqor", amount: toBase("1.5") }],
  { fee },
);

console.log(result.transactionHash);
```

### Quantum-safe signing

QoreChain supports post-quantum cryptography via ML-DSA-87 (Dilithium-5) and a
hybrid posture that carries both a classical and a post-quantum signature. The
PQC key generation, signing, and verification are available through
`generatePqcKeypair`, `pqcSign`, `pqcVerify`, and the pluggable
`PqcSigner` / `HybridSigner`. Hybrid transactions are supported end-to-end via
`buildHybridTx` / `signAndBroadcastHybrid` (the signer's PQC key must first be
registered on-chain with `MsgRegisterPQCKey`).

```ts
import { generatePqcKeypair, pqcSign, pqcVerify } from "@qorechain/sdk";

const keypair = generatePqcKeypair();
const message = new TextEncoder().encode("hello");
const signature = pqcSign(keypair.secretKey, message);
const ok = pqcVerify(keypair.publicKey, message, signature);
```

## Other languages

The Python, Go, Rust, and Java SDKs mirror the TypeScript native-chain surface —
networks, accounts (native/EVM/SVM + PQC), typed messages for every module,
typed queries, the tx lifecycle (auto-gas, error decoding, tracking, search),
and WebSocket subscriptions.

- **Python** — `pip install qorechain-sdk`, then `import qorsdk`. See [packages/py](./packages/py/README.md).
- **Go** — `go get github.com/qorechain/qorechain-sdk/packages/go`. See [packages/go](./packages/go/README.md).
- **Rust** — `cargo add qorechain-sdk`, then `use qorechain;`. See [packages/rust](./packages/rust/README.md).
- **Java** — `io.github.qorechain:qorechain-sdk:0.3.0` (Maven Central), package `io.github.qorechain`. See [packages/java](./packages/java/README.md).

> Browser wallets and the viem / `@solana/web3.js` EVM/SVM adapters are
> TypeScript-only; in Python/Go/Rust use that ecosystem's standard libraries for
> EVM/SVM access.

## Features

The TypeScript SDK (`@qorechain/sdk` plus the `@qorechain/evm` and
`@qorechain/svm` adapters) has the full surface; Python/Go/Rust mirror the
native-chain parts. Highlights:

- **Full message coverage** — typed composers for every chain message (bank,
  staking, distribution, gov, authz, feegrant, IBC, and the QoreChain custom
  modules: AMM, bridge, RDK, multilayer, PQC, SVM, lightnode, license,
  abstract-account, cross-VM, RL consensus), resolved through a message registry.
- **Browser wallets** — Keplr/Leap (Cosmos), MetaMask/EIP-1193 (EVM), and
  Phantom/Wallet-Standard (SVM).
- **Auto-gas** — simulation-based fee estimation, plus EVM EIP-1559 helpers and
  SVM compute-budget / priority-fee helpers.
- **Subscriptions** — new-block and tx event streams (Cosmos), block/event/log
  watchers (EVM), and logs/account/slot subscriptions (SVM).
- **Error decoding** — structured, human-readable errors across all three VMs.
- **NFT helpers** — typed ERC-721 and ERC-1155 read/write wrappers.
- **CosmWasm lifecycle** — query, upload, instantiate/instantiate2, execute,
  migrate, and admin management.
- **PQC** — ML-DSA-87 (Dilithium-5) signing and hybrid-signature transactions.

See the [docs](./docs) and [examples](./examples) for runnable usage.

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live).
- Default endpoint ports (localhost): REST `1317`, gRPC `9090`, consensus RPC
  `26657`, EVM JSON-RPC `8545` / WS `8546`, SVM RPC `8899`. Override these to
  point at a real node.
- Token: `QOR` (display) / `uqor` (base), with 10^6 base units per QOR.

## License

Apache-2.0. See [LICENSE](./LICENSE).
