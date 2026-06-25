# @qorechain/sdk

Official TypeScript SDK for building decentralized applications on the QoreChain
network — a quantum-safe, triple-VM Layer 1 with native, EVM, and SVM accounts.

## Features

- **Full message coverage** — typed composers for every chain message (bank,
  staking, distribution, gov, authz, feegrant, IBC, and the QoreChain custom
  modules), resolved through a message registry.
- **Browser wallets** — Keplr/Leap (Cosmos); MetaMask/EIP-1193 and
  Phantom/Wallet-Standard via the `@qorechain/evm` and `@qorechain/svm` adapters.
- **Auto-gas** — simulation-based fee estimation, with EVM EIP-1559 and SVM
  compute-budget helpers in the adapters.
- **Subscriptions** — new-block and tx event streams over the consensus RPC.
- **Error decoding** — structured, human-readable transaction errors.
- **NFT helpers** — ERC-721 / ERC-1155 wrappers in `@qorechain/evm`.
- **CosmWasm lifecycle** — query, upload, instantiate/instantiate2, execute,
  migrate, and admin management.
- **PQC** — ML-DSA-87 (Dilithium-5) signing and hybrid-signature transactions.

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

Mainnet (chain id `qorechain-vladi`) is live; target it with
`createClient({ network: "mainnet", endpoints })`, overriding the localhost
defaults with your node URLs.

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

### CosmWasm contracts

Interact with CosmWasm contracts via thin wrappers over
`@cosmjs/cosmwasm-stargate`. `client.cosmwasm()` opens a read-only client at the
`rpc` endpoint; for writes, connect a `SigningCosmWasmClient` with an offline
signer.

```ts
import {
  connectCosmWasmSigner,
  queryContractSmart,
  getContractInfo,
  instantiate,
  execute,
} from "@qorechain/sdk";

// Reads
const cw = await client.cosmwasm();
const info = await getContractInfo(cw, "qor1contract...");
const state = await queryContractSmart(cw, "qor1contract...", { get_count: {} });

// Writes
const signing = await connectCosmWasmSigner("https://rpc.testnet.example", signer);
const inst = await instantiate(signing, sender, codeId, { count: 0 }, "my-contract", {
  fee: "auto",
});
await execute(signing, sender, inst.contractAddress, { increment: {} }, "auto");
```

### Cross-VM messages

QoreChain routes calls across its native, EVM, and CosmWasm execution
environments. The EVM→native direction (e.g. an EVM contract triggering a native
AMM swap) is performed on-chain through the cross-VM bridge precompile exposed in
the `@qorechain/evm` package. From this SDK you can read message state:

```ts
const pending = await client.crossvm.pending();
const message = await client.crossvm.message("42");
const params = await client.crossvm.params();

// Or track a message by id over the EVM JSON-RPC namespace:
const status = await client.qor.getCrossVmMessage("42");
```

## Network reference

- Mainnet chain id: `qorechain-vladi` (live).
- Testnet chain id: `qorechain-diana` (live).
- Token: `QOR` / `uqor` (10^6 base units per QOR).
- Default endpoints point at localhost — override them to reach a real node.

## License

Apache-2.0
