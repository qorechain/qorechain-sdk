# qorechain-sdk

Official multi-language SDK and developer kit for building decentralized applications on the QoreChain network — a quantum-safe, triple-VM Layer 1.

## Packages

| Package | Language | Status |
| --- | --- | --- |
| `@qorechain/sdk` | TypeScript | Available |
| `qorechain` (Python) | Python | Coming soon |
| `qorechain-go` | Go | Coming soon |
| `qorechain` (Rust) | Rust | Coming soon |
| `@qorechain/evm` | EVM / Solidity adapter | Coming soon |
| `@qorechain/svm` | SVM adapter | Coming soon |
| `create-qorechain-dapp` | Project scaffolding CLI | Coming soon |

The TypeScript SDK (`@qorechain/sdk`) is the first available package; the other
language packages are in progress. QoreChain is a triple-VM Layer 1 with
first-class support for CosmWasm, EVM/Solidity, and SVM smart contracts, plus
IBC interoperability.

## Quickstart (TypeScript)

### Install

```sh
npm install @qorechain/sdk
```

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
PQC key generation, signing, and verification primitives are available today
through `generatePqcKeypair`, `pqcSign`, `pqcVerify`, and the pluggable
`PqcSigner` / `HybridSigner`. Hybrid transaction submission is being finalized
for the live network.

```ts
import { generatePqcKeypair, pqcSign, pqcVerify } from "@qorechain/sdk";

const keypair = generatePqcKeypair();
const message = new TextEncoder().encode("hello");
const signature = pqcSign(keypair.secretKey, message);
const ok = pqcVerify(keypair.publicKey, message, signature);
```

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live).
- Default endpoint ports (localhost): REST `1317`, gRPC `9090`, consensus RPC
  `26657`, EVM JSON-RPC `8545` / WS `8546`, SVM RPC `8899`. Override these to
  point at a real node.
- Token: `QOR` (display) / `uqor` (base), with 10^6 base units per QOR.

## License

Apache-2.0. See [LICENSE](./LICENSE).
