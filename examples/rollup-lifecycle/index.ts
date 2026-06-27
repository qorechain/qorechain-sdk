/**
 * rollup-lifecycle — drive an RDK rollup with the high-level `createRollupClient`
 * helper: create -> submit batch -> read status / latest batch -> execute a
 * withdrawal with a Merkle proof.
 *
 * Shows:
 *  1. createRollupClient(tx, { query, qor }) → an ergonomic rollup client
 *  2. createRollup({...}) → declare a rollup (profile + VM + stake)
 *  3. submitBatch({...}) → post a settlement batch, committing a withdrawalsRoot
 *  4. getRollupStatus / getLatestBatch / getRollup → reads (qor_ + typed)
 *  5. executeWithdrawal({...}) → prove an L2->L1 withdrawal leaf and pay out
 *
 * Messages are built offline regardless of connectivity (logged for inspection).
 * Broadcasting needs a reachable node + a FUNDED account; the reads need a node.
 */

import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createRollupClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
} from "@qorechain/sdk";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const rpcUrl = process.env.QORE_RPC_URL ?? "http://localhost:26657";
  const restUrl = process.env.QORE_REST_URL ?? "http://localhost:1317";
  const evmRpcUrl = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const rollupId = process.env.QORE_ROLLUP_ID ?? "my-app-rollup";

  const client = createClient({
    network: "testnet",
    endpoints: { rpc: rpcUrl, rest: restUrl, evmRpc: evmRpcUrl },
  });

  const prefix = client.network.bech32.account;
  const account = await deriveNativeAccount(mnemonic);
  console.log(`creator: ${account.address}`);

  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);
  const tx = await client.connectTx(signer);

  // qor_ conveniences (getRollupStatus / getDaBlobStatus / suggestRollupProfile)
  // come from the client's `qor` JSON-RPC client.
  const rollup = createRollupClient(tx, { qor: client.qor });

  // Build the messages offline so they can be inspected without a node.
  const create = rollup.createRollupMsg({
    rollupId,
    profile: "default",
    vmType: "evm",
    stakeAmount: 1_000_000,
  });
  const batch = rollup.submitBatchMsg({
    rollupId,
    batchIndex: 0,
    stateRoot: new Uint8Array(32).fill(1),
    prevStateRoot: new Uint8Array(32).fill(0),
    txCount: 128,
    dataHash: new Uint8Array(32).fill(2),
    // Commit the L2->L1 messages so executeWithdrawal proofs can be verified.
    withdrawalsRoot: new Uint8Array(32).fill(3),
  });
  const withdrawal = rollup.executeWithdrawalMsg({
    rollupId,
    batchIndex: 0,
    withdrawalIndex: 0,
    recipient: account.address,
    denom: "uqor",
    amount: 500_000,
    // Binary-Merkle sibling hashes from the leaf up to withdrawalsRoot.
    proof: [new Uint8Array(32).fill(9), new Uint8Array(32).fill(8)],
  });

  console.log("createRollup:", JSON.stringify(create, null, 2));
  console.log("submitBatch:", JSON.stringify(batch, null, 2));
  console.log("executeWithdrawal:", JSON.stringify(withdrawal, null, 2));

  if (process.env.QORE_BROADCAST !== "1") {
    console.log(
      "\nDry run — set QORE_BROADCAST=1 (with a funded account) to create, batch, and withdraw.",
    );
    tx.disconnect();
    return;
  }

  console.log("\nCreating rollup...");
  const r1 = await rollup.createRollup({
    rollupId,
    profile: "default",
    vmType: "evm",
    stakeAmount: 1_000_000,
  });
  console.log(`  ok — tx ${r1.transactionHash}`);

  console.log("Submitting batch 0...");
  const r2 = await rollup.submitBatch({
    rollupId,
    batchIndex: 0,
    stateRoot: new Uint8Array(32).fill(1),
    prevStateRoot: new Uint8Array(32).fill(0),
    txCount: 128,
    dataHash: new Uint8Array(32).fill(2),
    withdrawalsRoot: new Uint8Array(32).fill(3),
  });
  console.log(`  ok — tx ${r2.transactionHash}`);

  // Reads: qor_ status + typed latest batch.
  const status = await rollup.getRollupStatus(rollupId);
  console.log("rollup status (qor_):", JSON.stringify(status, null, 2));

  const comet = await connectComet(rpcUrl);
  const queries = connectQueryClients(comet);
  const reader = createRollupClient(tx, {
    query: queries.rdk,
    qor: client.qor,
  });

  const cfg = await reader.getRollup(rollupId);
  console.log("rollup config:", JSON.stringify(cfg, null, 2));
  const latest = await reader.getLatestBatch(rollupId);
  console.log("latest batch:", JSON.stringify(latest, null, 2));

  console.log("Executing withdrawal (needs a finalized batch + valid proof)...");
  const r3 = await reader.executeWithdrawal({
    rollupId,
    batchIndex: 0,
    withdrawalIndex: 0,
    recipient: account.address,
    denom: "uqor",
    amount: 500_000,
    proof: [new Uint8Array(32).fill(9), new Uint8Array(32).fill(8)],
  });
  console.log(`  ok — tx ${r3.transactionHash}`);

  comet.disconnect();
  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to run the rollup lifecycle.");
  console.error(
    "Needs a reachable node and (for broadcast) a FUNDED QORE_MNEMONIC. The",
  );
  console.error(
    "withdrawal also needs a finalized batch whose withdrawalsRoot commits the",
  );
  console.error("leaf, with a real Merkle proof.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
