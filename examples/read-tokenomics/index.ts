/**
 * read-tokenomics - read QoreChain tokenomics state over the REST (LCD) API.
 *
 * Shows client.rest reads, each served by the chain module that owns the data:
 *  - client.rest.getBurnStats()                     → /qorechain/burn/v1/stats
 *  - client.rest.get("/qorechain/inflation/v1/epoch_info") → current inflation epoch and rate
 *  - client.rest.get("/qorechain/inflation/v1/params")     → the inflation schedule
 *  - client.rest.get("/cosmos/bank/v1beta1/supply/by_denom", { denom: "uqor" }) → total supply
 *
 * Needs a reachable REST endpoint (QORE_REST_URL). Reads are independent, so each
 * is reported even if others fail.
 */

import { createClient } from "@qorechain/sdk";

async function tryRead(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const value = await fn();
    console.log(`${label}:`);
    console.log(JSON.stringify(value, null, 2));
  } catch (err) {
    console.log(`${label}: unavailable (${err instanceof Error ? err.message.split("\n")[0] : err})`);
  }
}

async function main(): Promise<void> {
  const client = createClient({
    network: "testnet",
    endpoints: {
      rest: process.env.QORE_REST_URL ?? "http://localhost:1317",
    },
  });

  await tryRead("burn stats", () => client.rest.getBurnStats());
  await tryRead("inflation epoch", () => client.rest.get("/qorechain/inflation/v1/epoch_info"));
  await tryRead("inflation schedule", () => client.rest.get("/qorechain/inflation/v1/params"));
  await tryRead("total supply", () =>
    client.rest.get("/cosmos/bank/v1beta1/supply/by_denom", { denom: client.network.coin.base }),
  );
}

main().catch((err: unknown) => {
  console.error("\nFailed to reach the REST endpoint.");
  console.error("Set QORE_REST_URL to a reachable QoreChain REST (LCD) endpoint.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
