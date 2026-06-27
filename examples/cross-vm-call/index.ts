/**
 * cross-vm-call — invoke contracts across EVM, SVM, and CosmWasm from ONE native
 * account via the high-level `createCrossVMClient` helper.
 *
 * QoreChain runs three VMs side by side and lets a single signature drive calls
 * across all of them. This example shows:
 *  1. createCrossVMClient(tx, { query }) → an ergonomic cross-VM client
 *  2. buildCall({ ... }) → build a single MsgCrossVMCall offline (per-VM payload)
 *  3. call({ evm: { abi, functionName, args } }) → call an EVM contract from a
 *     native account (payload ABI-encoded with viem)
 *  4. callAtomic([...]) → pack multiple calls into ONE tx body so they execute
 *     atomically under one signature (the triple-VM headline)
 *
 * Messages are built offline regardless of connectivity (logged for inspection).
 * Actually broadcasting needs a reachable node and a FUNDED account; otherwise it
 * fails cleanly at broadcast.
 */

import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createCrossVMClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
} from "@qorechain/sdk";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

// A minimal ERC-20 ABI for the EVM call payload.
const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const rpcUrl = process.env.QORE_RPC_URL ?? "http://localhost:26657";
  const restUrl = process.env.QORE_REST_URL ?? "http://localhost:1317";
  const evmContract = process.env.QORE_EVM_CONTRACT ?? "0xToken000000000000000000000000000000beef";
  const svmProgram = process.env.QORE_SVM_PROGRAM ?? "Prog11111111111111111111111111111111111111";
  const recipient = process.env.QORE_EVM_RECIPIENT ?? "0x1111111111111111111111111111111111111111";

  const client = createClient({
    network: "testnet",
    endpoints: { rpc: rpcUrl, rest: restUrl },
  });

  const prefix = client.network.bech32.account;
  const account = await deriveNativeAccount(mnemonic);
  console.log(`sender: ${account.address}`);

  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);
  const tx = await client.connectTx(signer);

  // The helper signs as `tx.senderAddress`; sourceVm defaults to "evm".
  const xvm = createCrossVMClient(tx);

  // Build offline so it can be inspected without a node (raw + cosmwasm shapes).
  const rawBuild = xvm.buildCall({
    sourceVm: "cosmwasm",
    targetVm: "svm",
    targetContract: svmProgram,
    svm: { data: new Uint8Array([1, 2, 3, 4]) },
  });
  console.log("buildCall (svm, raw):", JSON.stringify(rawBuild, (_k, v) =>
    v instanceof Uint8Array ? `0x${Buffer.from(v).toString("hex")}` : v, 2));

  if (process.env.QORE_BROADCAST !== "1") {
    console.log(
      "\nDry run — set QORE_BROADCAST=1 (with a funded account) to call across VMs.",
    );
    tx.disconnect();
    return;
  }

  // Single EVM call from a native account — payload ABI-encoded via viem.
  console.log("\nCalling an EVM contract from a native account...");
  const single = await xvm.call({
    sourceVm: "cosmwasm",
    targetVm: "evm",
    targetContract: evmContract,
    evm: { abi: ERC20_ABI, functionName: "transfer", args: [recipient, 1n] },
  });
  console.log(`  ok — tx ${single.result.transactionHash}, message ${single.messageId}`);

  // Atomic batch hitting two VMs in ONE tx body / one signature.
  console.log("Submitting an atomic batch across EVM + SVM...");
  const atomic = await xvm.callAtomic([
    {
      targetVm: "evm",
      targetContract: evmContract,
      evm: { abi: ERC20_ABI, functionName: "transfer", args: [recipient, 2n] },
    },
    {
      targetVm: "svm",
      targetContract: svmProgram,
      svm: { data: new Uint8Array([9, 9, 9]) },
    },
  ]);
  console.log(
    `  ok — tx ${atomic.result.transactionHash}, messages ${atomic.messageIds.join(", ")}`,
  );

  // Read a message back via the typed query client.
  const comet = await connectComet(rpcUrl);
  const queries = connectQueryClients(comet);
  const reader = createCrossVMClient(tx, { query: queries.crossvm });
  if (single.messageId) {
    const msg = await reader.getMessage(single.messageId);
    console.log("getMessage:", JSON.stringify(msg, null, 2));
  }

  comet.disconnect();
  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to run the cross-VM example.");
  console.error(
    "Needs a reachable node and (for broadcast) a FUNDED QORE_MNEMONIC.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
