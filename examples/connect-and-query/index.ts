/**
 * connect-and-query — create a client and read public chain state.
 *
 * Shows:
 *  - createClient() with endpoint overrides from the environment
 *  - reading a native balance via client.rest.getAllBalances(addr)
 *  - reading client.qor.getTokenomicsOverview()
 *
 * Both reads need a reachable node. With no env vars set, the client targets the
 * localhost defaults (REST :1317, EVM JSON-RPC :8545). If the node is
 * unreachable the example prints a clear hint and exits non-zero.
 */

import { createClient } from "@qorechain/sdk";

// A well-known testnet address to query. Override with QORE_ADDRESS.
const DEFAULT_ADDRESS = "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqscl8t9";

async function main(): Promise<void> {
  const address = process.env.QORE_ADDRESS ?? DEFAULT_ADDRESS;

  // Endpoint overrides default to the testnet localhost ports when unset.
  const client = createClient({
    network: "testnet",
    endpoints: {
      rest: process.env.QORE_REST_URL ?? "http://localhost:1317",
      evmRpc: process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545",
    },
  });

  console.log(`network:  ${client.network.name} (${client.network.chainId})`);
  console.log(`address:  ${address}`);

  const balances = await client.rest.getAllBalances(address);
  if (balances.balances.length === 0) {
    console.log("balances: (none)");
  } else {
    for (const coin of balances.balances) {
      console.log(`balance:  ${coin.amount} ${coin.denom}`);
    }
  }

  const overview = await client.qor.getTokenomicsOverview();
  console.log("tokenomics overview:");
  console.log(JSON.stringify(overview, null, 2));
}

main().catch((err: unknown) => {
  console.error("\nFailed to query the node.");
  console.error(
    "Ensure a QoreChain node is reachable and QORE_REST_URL / QORE_EVM_RPC_URL point at it.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
