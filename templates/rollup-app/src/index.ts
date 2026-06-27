/**
 * A minimal QoreChain rollup + multilayer app.
 *
 * It wires up the high-level helpers from `@qorechain/sdk`:
 *   - createRollupClient(tx, { query, qor })  → create rollups, submit batches,
 *     run the challenge game, manage lifecycle, execute withdrawals, read state.
 *   - createMultilayerClient(tx, { query })   → register sidechains/paychains,
 *     anchor state roots, route transactions, read layers + routing stats.
 *
 * By default it runs a DRY RUN: it builds and logs the messages without touching
 * a node. Set QORE_BROADCAST=1 (with a funded account) to actually broadcast and
 * read. See the README for the env vars.
 */
import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createMultilayerClient,
  createRollupClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
} from "@qorechain/sdk";

// The public BIP-39 test mnemonic — NOT funded on any real network. Replace it
// (via QORE_MNEMONIC) with your own funded testnet mnemonic to broadcast.
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const rpcUrl = process.env.QORE_RPC_URL ?? "http://localhost:26657";
  const restUrl = process.env.QORE_REST_URL ?? "http://localhost:1317";
  const evmRpcUrl = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const rollupId = process.env.QORE_ROLLUP_ID ?? "my-app-rollup";
  const sidechainId = process.env.QORE_SIDECHAIN_ID ?? "my-app-sidechain";
  const broadcast = process.env.QORE_BROADCAST === "1";

  const client = createClient({
    network: "testnet",
    endpoints: { rpc: rpcUrl, rest: restUrl, evmRpc: evmRpcUrl },
  });

  const prefix = client.network.bech32.account;
  const account = await deriveNativeAccount(mnemonic);
  console.log(`account: ${account.address}`);

  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);
  const tx = await client.connectTx(signer);

  const rollup = createRollupClient(tx, { qor: client.qor });
  const multilayer = createMultilayerClient(tx);

  // --- Build the messages offline (no node needed) --------------------------
  const createRollupMsg = rollup.createRollupMsg({
    rollupId,
    profile: "default",
    vmType: "evm",
    stakeAmount: 1_000_000,
  });
  const submitBatchMsg = rollup.submitBatchMsg({
    rollupId,
    batchIndex: 0,
    stateRoot: new Uint8Array(32).fill(1),
    txCount: 10,
    withdrawalsRoot: new Uint8Array(32).fill(3),
  });
  const registerSidechainMsg = multilayer.registerSidechainMsg({
    layerId: sidechainId,
    description: "App sidechain",
    minValidators: 3,
    supportedVmTypes: ["evm"],
  });

  console.log("createRollup:", JSON.stringify(createRollupMsg, null, 2));
  console.log("submitBatch:", JSON.stringify(submitBatchMsg, null, 2));
  console.log(
    "registerSidechain:",
    JSON.stringify(registerSidechainMsg, null, 2),
  );

  if (!broadcast) {
    console.log(
      "\nDry run — set QORE_BROADCAST=1 (with a funded account) to broadcast and read.",
    );
    tx.disconnect();
    return;
  }

  // --- Broadcast ------------------------------------------------------------
  console.log("\nCreating rollup...");
  const created = await rollup.createRollup({
    rollupId,
    profile: "default",
    vmType: "evm",
    stakeAmount: 1_000_000,
  });
  console.log(`  ok — tx ${created.transactionHash}`);

  console.log("Submitting batch 0...");
  const batched = await rollup.submitBatch({
    rollupId,
    batchIndex: 0,
    stateRoot: new Uint8Array(32).fill(1),
    txCount: 10,
    withdrawalsRoot: new Uint8Array(32).fill(3),
  });
  console.log(`  ok — tx ${batched.transactionHash}`);

  // --- Read -----------------------------------------------------------------
  const status = await rollup.getRollupStatus(rollupId);
  console.log("rollup status (qor_):", JSON.stringify(status, null, 2));

  const comet = await connectComet(rpcUrl);
  const queries = connectQueryClients(comet);
  const reader = createRollupClient(tx, { query: queries.rdk, qor: client.qor });

  const latest = await reader.getLatestBatch(rollupId);
  console.log("latest batch:", JSON.stringify(latest, null, 2));

  comet.disconnect();
  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to run the rollup app.");
  console.error(
    "Needs a reachable node and (for broadcast) a FUNDED QORE_MNEMONIC.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
