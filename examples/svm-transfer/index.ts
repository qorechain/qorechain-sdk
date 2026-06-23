/**
 * svm-transfer — build a SOL transfer + memo on QoreChain's SVM runtime.
 *
 * Shows:
 *  - deriveSvmAccount(mnemonic) (from @qorechain/sdk) → a 64-byte secret key
 *  - svmKeypairFromSecretKey(secretKey) (from @qorechain/svm) → a web3.js Keypair
 *  - createSvmClient({ endpoints }) → a Connection-backed client bundle
 *  - client.buildTransferSol(...) → an unsigned SOL transfer transaction
 *  - createMemoInstruction(...) → attach a memo instruction
 *
 * This builds and prints the transaction. SENDING it needs a reachable SVM
 * JSON-RPC and a funded account; use client.transferSol(...) /
 * client.sendTransaction(...) to broadcast.
 */

import { deriveSvmAccount } from "@qorechain/sdk";
import {
  createSvmClient,
  svmKeypairFromSecretKey,
  svmAddress,
  createMemoInstruction,
} from "@qorechain/svm";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const svmRpc = process.env.QORE_SVM_RPC_URL ?? "http://localhost:8899";

  // Derive an SVM (ed25519) account and reconstruct a web3.js Keypair.
  const account = await deriveSvmAccount(mnemonic);
  const keypair = svmKeypairFromSecretKey(account.secretKey);
  const from = keypair.publicKey;
  console.log(`from: ${svmAddress(keypair)}`);

  // Recipient: a second account derived at index 1 (or QORE_SVM_RECIPIENT).
  const recipient = process.env.QORE_SVM_RECIPIENT
    ? new PublicKey(process.env.QORE_SVM_RECIPIENT)
    : svmKeypairFromSecretKey((await deriveSvmAccount(mnemonic, { accountIndex: 1 })).secretKey)
        .publicKey;
  console.log(`to:   ${recipient.toBase58()}`);

  const client = createSvmClient({ endpoints: { svmRpc } });

  // Build an unsigned SOL transfer (0.01 SOL) and append a memo.
  const lamports = Math.round(0.01 * LAMPORTS_PER_SOL);
  const tx = client.buildTransferSol({ from: keypair, to: recipient, lamports });
  tx.add(createMemoInstruction("hello from @qorechain/svm", [from]));

  console.log(`lamports: ${lamports}`);
  console.log(`instructions: ${tx.instructions.length}`);
  tx.instructions.forEach((ix, i) => {
    console.log(`  [${i}] program ${ix.programId.toBase58()} (${ix.keys.length} keys, ${ix.data.length} bytes data)`);
  });

  console.log(
    "\nBuilt (unsigned, no recent blockhash). To send: set QORE_SVM_RPC_URL to a",
  );
  console.log(
    "reachable node and a funded mnemonic, then use client.sendTransaction(tx, [keypair]).",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
