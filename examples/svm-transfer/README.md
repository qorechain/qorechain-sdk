# svm-transfer

Build a SOL transfer with a memo instruction on QoreChain's Solana-compatible
(SVM) runtime, using `@qorechain/svm` (a thin layer over `@solana/web3.js`).

Shows:

- `deriveSvmAccount(mnemonic)` (from `@qorechain/sdk`) → a 64-byte secret key
- `svmKeypairFromSecretKey(secretKey)` (from `@qorechain/svm`) → a web3.js `Keypair`
- `createSvmClient({ endpoints })` and `client.buildTransferSol(...)`
- `createMemoInstruction(...)` appended to the transfer

The example **builds and prints** the transaction (unsigned, no recent
blockhash) — this part runs without a node.

## Prerequisites (to actually send)

- A reachable SVM JSON-RPC (`QORE_SVM_RPC_URL`, default `http://localhost:8899`).
- A funded account. Replace the default public test `QORE_MNEMONIC` with a
  funded one. To broadcast, call `client.sendTransaction(tx, [keypair])` (or
  `client.transferSol(...)`), which signs, sends, and confirms.

## Run

```bash
pnpm install
pnpm start
```

Prints the assembled instructions. Sending requires a live node and a funded
account (see above).
