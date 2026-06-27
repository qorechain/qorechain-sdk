/**
 * register-sidechain — drive the multilayer (sidechain / paychain) lifecycle via
 * the high-level `createMultilayerClient` helper.
 *
 * Shows the full register -> anchor -> route -> read flow:
 *  1. createMultilayerClient(tx, { query }) → an ergonomic multilayer client
 *  2. registerSidechain({...}) + registerPaychain({...}) → declare two layers
 *  3. anchorState({...}) → commit a sidechain state root to the main chain
 *  4. routeTransaction({...}) → let the router pick the best layer for a payload
 *  5. getLayer / listLayers / routingStats → typed reads
 *
 * The messages are built offline regardless of connectivity (logged for
 * inspection). Actually broadcasting needs a reachable node and a FUNDED account;
 * otherwise it fails cleanly at broadcast. The typed reads need a reachable
 * consensus RPC.
 */

import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createMultilayerClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
} from "@qorechain/sdk";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const rpcUrl = process.env.QORE_RPC_URL ?? "http://localhost:26657";
  const restUrl = process.env.QORE_REST_URL ?? "http://localhost:1317";
  const sidechainId = process.env.QORE_SIDECHAIN_ID ?? "game-sidechain";
  const paychainId = process.env.QORE_PAYCHAIN_ID ?? "payments-paychain";

  const client = createClient({
    network: "testnet",
    endpoints: { rpc: rpcUrl, rest: restUrl },
  });

  const prefix = client.network.bech32.account;
  const account = await deriveNativeAccount(mnemonic);
  console.log(`creator: ${account.address}`);

  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);
  const tx = await client.connectTx(signer);

  // The helper signs as `tx.senderAddress`; no need to repeat the address.
  const multi = createMultilayerClient(tx);

  // Build the messages offline so they can be inspected without a node.
  const registerSidechain = multi.registerSidechainMsg({
    layerId: sidechainId,
    description: "High-throughput game state sidechain",
    targetBlockTimeMs: 500,
    maxTransactionsPerBlock: 10_000,
    minValidators: 3,
    settlementIntervalBlocks: 100,
    supportedVmTypes: ["evm", "wasm"],
    supportedDomains: ["gaming"],
  });
  const registerPaychain = multi.registerPaychainMsg({
    layerId: paychainId,
    description: "Low-fee payments paychain",
    maxTransactionsPerBlock: 50_000,
    settlementIntervalBlocks: 50,
    baseFeeMultiplier: "0.5",
  });
  const anchor = multi.anchorStateMsg({
    layerId: sidechainId,
    layerHeight: 100,
    stateRoot: new Uint8Array(32).fill(7),
    transactionCount: 4_321,
  });
  const route = multi.routeTransactionMsg({
    transactionPayload: new TextEncoder().encode("hello-from-app"),
    preferredLayer: sidechainId,
    maxLatencyMs: 1_000,
    maxFee: "1000",
  });

  console.log("registerSidechain:", JSON.stringify(registerSidechain, null, 2));
  console.log("registerPaychain:", JSON.stringify(registerPaychain, null, 2));
  console.log("anchorState:", JSON.stringify(anchor, null, 2));
  console.log("routeTransaction:", JSON.stringify(route, null, 2));

  if (process.env.QORE_BROADCAST !== "1") {
    console.log(
      "\nDry run — set QORE_BROADCAST=1 (with a funded account) to register, anchor, and route.",
    );
    tx.disconnect();
    return;
  }

  console.log("\nRegistering sidechain...");
  const r1 = await multi.registerSidechain({
    layerId: sidechainId,
    description: "High-throughput game state sidechain",
    targetBlockTimeMs: 500,
    maxTransactionsPerBlock: 10_000,
    minValidators: 3,
    settlementIntervalBlocks: 100,
    supportedVmTypes: ["evm", "wasm"],
    supportedDomains: ["gaming"],
  });
  console.log(`  ok — tx ${r1.transactionHash}`);

  console.log("Registering paychain...");
  const r2 = await multi.registerPaychain({
    layerId: paychainId,
    description: "Low-fee payments paychain",
    maxTransactionsPerBlock: 50_000,
    settlementIntervalBlocks: 50,
    baseFeeMultiplier: "0.5",
  });
  console.log(`  ok — tx ${r2.transactionHash}`);

  console.log("Anchoring sidechain state root...");
  const r3 = await multi.anchorState({
    layerId: sidechainId,
    layerHeight: 100,
    stateRoot: new Uint8Array(32).fill(7),
    transactionCount: 4_321,
  });
  console.log(`  ok — tx ${r3.transactionHash}`);

  console.log("Routing a transaction...");
  const r4 = await multi.routeTransaction({
    transactionPayload: new TextEncoder().encode("hello-from-app"),
    preferredLayer: sidechainId,
    maxLatencyMs: 1_000,
    maxFee: "1000",
  });
  console.log(`  ok — tx ${r4.transactionHash}`);

  // Typed reads over the consensus RPC's ABCI query path.
  const comet = await connectComet(rpcUrl);
  const queries = connectQueryClients(comet);
  const reader = createMultilayerClient(tx, { query: queries.multilayer });

  const layer = await reader.getLayer(sidechainId);
  console.log("layer:", JSON.stringify(layer, null, 2));
  const layers = await reader.listLayers();
  console.log(`layers: ${layers.layers.length} registered`);
  const stats = await reader.routingStats();
  console.log("routingStats:", JSON.stringify(stats, null, 2));

  comet.disconnect();
  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to run the multilayer lifecycle.");
  console.error(
    "Needs a reachable node and (for broadcast) a FUNDED QORE_MNEMONIC.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
