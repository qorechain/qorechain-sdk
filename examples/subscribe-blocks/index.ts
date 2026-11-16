/**
 * subscribe-blocks - stream new QoreChain blocks over the consensus RPC.
 *
 * Shows:
 *  - createSubscriptionClient(rpcUrl) → a websocket-backed subscription client
 *  - subscribeNewBlocks(client, handler) → an unsubscribe function
 *
 * Needs a reachable consensus RPC endpoint over a websocket: ws:// or wss://
 * (the SDK turns an http:// or https:// URL into the matching ws:// or wss:// one).
 * The example prints a few blocks, unsubscribes, disconnects and exits.
 */

import {
  createSubscriptionClient,
  subscribeNewBlocks,
} from "@qorechain/sdk";

async function main(): Promise<void> {
  // Subscriptions need a websocket; the SDK switches an http(s) URL to ws(s).
  const rpc = process.env.QORE_RPC_URL ?? "ws://localhost:26657";
  const max = Number(process.env.QORE_MAX_BLOCKS ?? "3");

  const client = await createSubscriptionClient(rpc);
  console.log(`subscribed for new blocks on ${rpc} (will stop after ${max})`);

  let seen = 0;
  await new Promise<void>((resolve) => {
    const stop = subscribeNewBlocks(
      client,
      (block) => {
        seen += 1;
        console.log(`block #${seen}:`, JSON.stringify(block).slice(0, 120));
        if (seen >= max) {
          stop();
          client.disconnect?.();
          resolve();
        }
      },
      (err) => {
        console.error("subscription error:", err);
        stop();
        client.disconnect?.();
        resolve();
      },
    );
  });
}

main().catch((err: unknown) => {
  console.error("\nFailed to subscribe to new blocks.");
  console.error("Set QORE_RPC_URL to a reachable QoreChain consensus RPC websocket (ws:// or wss://).");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
