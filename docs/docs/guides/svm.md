---
id: svm
title: SVM guide
sidebar_position: 2
---

# SVM guide

`@qorechain/svm` is a thin, type-safe adapter over
[`@solana/web3.js`](https://solana.com/docs/clients/javascript) for QoreChain's
Solana-compatible JSON-RPC. `@solana/web3.js` is a peer dependency. The package
adds a client factory targeting the SVM RPC endpoint, key helpers, typed read
wrappers, SOL transfer build/sign/send, and minimal native-program instruction
builders.

```bash
npm i @qorechain/svm @solana/web3.js
```

## Create a client

```ts
import { createSvmClient } from "@qorechain/svm";

const client = createSvmClient({
  endpoints: { svmRpc: "https://svm-testnet.qore.host" },
});
```

You can also pass `rpcUrl`, an existing `connection`, or rely on
`DEFAULT_SVM_RPC_URL` (localhost `8899`).

## Keys

Reconstruct a `@solana/web3.js` `Keypair` from a derived SVM secret key, or
print an address:

```ts
import { deriveSvmAccount } from "@qorechain/sdk";
import { svmKeypairFromSecretKey, svmAddress } from "@qorechain/svm";

const account = await deriveSvmAccount(mnemonic);
const keypair = svmKeypairFromSecretKey(account.secretKey);
console.log(svmAddress(keypair)); // base58
```

## Transfer SOL

Build an unsigned transfer, then send it (sending needs a reachable node and a
funded account):

```ts
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const lamports = Math.round(0.01 * LAMPORTS_PER_SOL);

// Build only (no broadcast):
const tx = client.buildTransferSol({ from: keypair, to: recipient, lamports });

// Or build + sign + send + confirm in one call:
// const sig = await client.transferSol({ from: keypair, to: recipient, lamports });

// Send an arbitrary transaction:
// const sig = await client.sendTransaction(tx, [keypair]);

// Simulate without submitting:
// const sim = await client.simulateTransaction(tx);
```

## Programs

Builders for the common native programs plus a generic invoke builder:

```ts
import {
  createMemoInstruction,
  createTransferTokenInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createInvokeInstruction,
  PROGRAM_IDS,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
} from "@qorechain/svm";

// Attach a memo to a transaction.
tx.add(createMemoInstruction("hello from @qorechain/svm", [keypair.publicKey]));

// SPL-Token transfer, ATA creation, and a generic program invoke are also
// available via the builders above.
```

See the `svm-transfer` example in the repository for a runnable version.
