# @qorechain/sdk

Official TypeScript SDK for building decentralized applications on the QoreChain
network — a quantum-safe, triple-VM Layer 1 with native, EVM, and SVM accounts.

## Install

```sh
npm install @qorechain/sdk
```

## Quickstart

### Connect

`createClient()` targets the public testnet (chain id `qorechain-diana`) by
default. The defaults point at localhost, so pass `endpoints` to talk to a real
node.

```ts
import { createClient } from "@qorechain/sdk";

const client = createClient(); // testnet, localhost defaults

const remote = createClient({
  endpoints: {
    rest: "https://rest.testnet.example", // Cosmos REST (LCD)
    rpc: "https://rpc.testnet.example",    // consensus RPC (for signing)
    evmRpc: "https://evm.testnet.example", // EVM + qor_ JSON-RPC
  },
});
```

Mainnet is not yet live; target it with `createClient({ network: "mainnet",
chainId, endpoints })` once it launches.

### Accounts

One mnemonic derives native (`qor1…`), EVM (`0x…`), and SVM (base58) accounts.

```ts
import {
  generateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "@qorechain/sdk";

const mnemonic = generateMnemonic();
const native = await deriveNativeAccount(mnemonic); // native.address → "qor1..."
const evm = await deriveEvmAccount(mnemonic);        // evm.address → "0x..."
const svm = await deriveSvmAccount(mnemonic);        // svm.address → base58
```

### Read on-chain state

```ts
const balances = await client.rest.getAllBalances(native.address);
const tokenomics = await client.qor.getTokenomicsOverview();
```

### Send a transfer

```ts
import { directSignerFromPrivateKey, toBase } from "@qorechain/sdk";

const account = await deriveNativeAccount(mnemonic);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
const tx = await client.connectTx(signer);

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
hybrid posture. The key/sign/verify primitives are available today through
`generatePqcKeypair`, `pqcSign`, `pqcVerify`, and the pluggable `PqcSigner` /
`HybridSigner`. Hybrid transaction submission is being finalized for the live
network.

```ts
import { generatePqcKeypair, pqcSign, pqcVerify } from "@qorechain/sdk";

const keypair = generatePqcKeypair();
const message = new TextEncoder().encode("hello");
const signature = pqcSign(keypair.secretKey, message);
const ok = pqcVerify(keypair.publicKey, message, signature);
```

## Network reference

- Testnet chain id: `qorechain-diana` (live).
- Token: `QOR` / `uqor` (10^6 base units per QOR).
- Default endpoints point at localhost — override them to reach a real node.

## License

Apache-2.0
