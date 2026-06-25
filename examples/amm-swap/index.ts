/**
 * amm-swap — build and broadcast an AMM SwapExactIn via the message composer.
 *
 * Shows:
 *  - msg.amm.swapExactIn({...}) → a typed `{ typeUrl, value }` EncodeObject
 *  - client.connectTx(signer) → a TxClient (registry includes all QoreChain msgs)
 *  - tx.signAndBroadcast([message], "auto") → simulate gas + sign + broadcast
 *
 * The message is built and logged offline regardless of connectivity. Actually
 * broadcasting needs a reachable node and a FUNDED account that holds `tokenIn`,
 * plus a real pool id — otherwise it fails at broadcast (reported cleanly).
 */

import {
  createClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
  amm, // the AMM composer group; equivalently `msg.amm` from the `msg` aggregate
} from "@qorechain/sdk";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const poolId = process.env.QORE_POOL_ID ?? "1";
  const denomIn = process.env.QORE_DENOM_IN ?? "uqor";
  const denomOut = process.env.QORE_DENOM_OUT ?? "uusdc";
  const amountIn = process.env.QORE_AMOUNT_IN ?? "1000000";
  const minOut = process.env.QORE_MIN_OUT ?? "1";

  const client = createClient({
    network: "testnet",
    endpoints: {
      rpc: process.env.QORE_RPC_URL ?? "http://localhost:26657",
      rest: process.env.QORE_REST_URL ?? "http://localhost:1317",
    },
  });

  const prefix = client.network.bech32.account;
  const account = await deriveNativeAccount(mnemonic);
  console.log(`sender: ${account.address}`);

  // Build the swap message from the composer — no network needed for this.
  const swap = amm.swapExactIn({
    sender: account.address,
    poolId,
    tokenIn: { denom: denomIn, amount: amountIn },
    denomOut,
    minOut,
  });
  console.log("message:", JSON.stringify(swap, null, 2));

  if (process.env.QORE_BROADCAST !== "1") {
    console.log("\nDry run — set QORE_BROADCAST=1 (with a funded account + real pool) to send.");
    return;
  }

  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);
  const tx = await client.connectTx(signer);
  const result = await tx.signAndBroadcast([swap], "auto");
  console.log(`broadcast ok — tx hash ${result.transactionHash} at height ${result.height ?? "?"}`);
  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to broadcast the AMM swap.");
  console.error("Needs a reachable node, a FUNDED QORE_MNEMONIC, and a real QORE_POOL_ID.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
