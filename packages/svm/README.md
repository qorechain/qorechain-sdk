# @qorechain/svm

A thin, type-safe adapter over
[`@solana/web3.js`](https://solana-labs.github.io/solana-web3.js/) for
**QoreChain's Solana-compatible JSON-RPC** (port `8899`). It does not reimplement
an SVM client — `@solana/web3.js` is a peer dependency — it adds conveniences: a
client factory targeting the SVM RPC endpoint, key helpers, typed read wrappers,
SOL transfer build/sign/send, and minimal native-program instruction builders
(Memo, SPL-Token, Associated Token Account) plus a generic program-invoke
builder.

Because the RPC is Solana-compatible, standard Solana wallets, explorers, and
tooling interoperate directly.

## Install

`@solana/web3.js` is a peer dependency, so install it alongside this package:

```bash
pnpm add @qorechain/svm @solana/web3.js
# or: npm install @qorechain/svm @solana/web3.js
```

## Quickstart

### Connect

```ts
import { createSvmClient } from "@qorechain/svm";

// Defaults to the testnet localhost endpoint (http://localhost:8899).
const client = createSvmClient({ rpcUrl: "http://localhost:8899" });
// Or pass a qorechain-sdk endpoints object: { endpoints: { svmRpc } }

// `client.connection` is the underlying @solana/web3.js Connection.
```

### Keys

`@qorechain/sdk`'s `deriveSvmAccount(mnemonic)` provides the standard 64-byte
ed25519 `secretKey`. Turn it into a `Keypair`:

```ts
import { svmKeypairFromSecretKey, svmAddress } from "@qorechain/svm";

const keypair = svmKeypairFromSecretKey(secretKey); // Uint8Array, length 64
const address = svmAddress(keypair); // base58 string
```

### Read balance

```ts
import { PublicKey } from "@solana/web3.js";

const lamports = await client.getBalance(new PublicKey(address));
const { blockhash } = await client.getLatestBlockhash();
```

### Transfer SOL

```ts
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const signature = await client.transferSol({
  from: keypair,
  to: new PublicKey(recipientAddress),
  lamports: BigInt(0.1 * LAMPORTS_PER_SOL),
});
```

Build without sending (e.g. to add more instructions, or to simulate):

```ts
const tx = client.buildTransferSol({ from: keypair, to, lamports: 1_000_000 });
const sim = await client.simulateTransaction(tx);
const sig = await client.sendTransaction(tx, [keypair]);
```

### Memo

```ts
import { createMemoInstruction } from "@qorechain/svm";
import { Transaction } from "@solana/web3.js";

const tx = new Transaction().add(createMemoInstruction("gm from qore"));
await client.sendTransaction(tx, [keypair]);
```

### Tokens

```ts
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferTokenInstruction,
} from "@qorechain/svm";

const ata = getAssociatedTokenAddress(mint, owner);
const createIx = createAssociatedTokenAccountInstruction({ payer, owner, mint });
const transferIx = createTransferTokenInstruction({
  source,
  destination,
  owner,
  amount: 100n,
});
```

### Deploying programs

Deploy BPF programs with standard Solana tooling
(`solana program deploy <program.so>`). Once deployed, build calls to your
program with `createInvokeInstruction(programId, keys, data)` and send them via
`client.sendTransaction(...)`.

## License

Apache-2.0
