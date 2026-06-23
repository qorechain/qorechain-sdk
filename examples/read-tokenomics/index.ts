/**
 * read-tokenomics — read tokenomics state via the qor_* JSON-RPC namespace.
 *
 * Shows three QorClient methods (served over the EVM JSON-RPC endpoint):
 *  - client.qor.getBurnStats()        → qor_getBurnStats
 *  - client.qor.getXqorePosition(addr) → qor_getXQOREPosition
 *  - client.qor.getInflationRate()    → qor_getInflationRate
 *
 * Needs a reachable EVM JSON-RPC (QORE_EVM_RPC_URL); the qor_* namespace is
 * served there. Reads are independent, so each is reported even if others fail.
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
  const address =
    process.env.QORE_ADDRESS ??
    "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqscl8t9";

  const client = createClient({
    network: "testnet",
    endpoints: {
      evmRpc: process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545",
    },
  });

  await tryRead("qor_getBurnStats", () => client.qor.getBurnStats());
  await tryRead("qor_getXQOREPosition", () => client.qor.getXqorePosition(address));
  await tryRead("qor_getInflationRate", () => client.qor.getInflationRate());
}

main().catch((err: unknown) => {
  console.error("\nFailed to reach the qor_* JSON-RPC endpoint.");
  console.error("Set QORE_EVM_RPC_URL to a reachable QoreChain EVM endpoint.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
