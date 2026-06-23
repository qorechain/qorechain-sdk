/**
 * cosmwasm-query — run a smart query against a deployed CosmWasm contract.
 *
 * Shows:
 *  - client.cosmwasm() → a read-only CosmWasmClient (connects over the RPC endpoint)
 *  - getContractInfo(client, address) → the contract's on-chain metadata
 *  - queryContractSmart(client, address, queryMsg) → a smart query
 *
 * Needs a reachable consensus RPC (QORE_RPC_URL) AND a deployed contract address
 * (QORE_CONTRACT). The query message defaults to a CW20 `{ "token_info": {} }`;
 * override it with QORE_QUERY_MSG (JSON) to match your contract's schema.
 */

import {
  createClient,
  queryContractSmart,
  getContractInfo,
} from "@qorechain/sdk";

async function main(): Promise<void> {
  const contract = process.env.QORE_CONTRACT;
  if (!contract) {
    console.error("Set QORE_CONTRACT to a deployed CosmWasm contract address (qor1...).");
    process.exitCode = 1;
    return;
  }

  const queryMsg: Record<string, unknown> = process.env.QORE_QUERY_MSG
    ? JSON.parse(process.env.QORE_QUERY_MSG)
    : { token_info: {} };

  const client = createClient({
    network: "testnet",
    endpoints: { rpc: process.env.QORE_RPC_URL ?? "http://localhost:26657" },
  });

  // Open the read-only CosmWasm client (memoized on the client).
  const cw = await client.cosmwasm();

  const info = await getContractInfo(cw, contract);
  console.log("contract info:");
  console.log(JSON.stringify(info, null, 2));

  const result = await queryContractSmart(cw, contract, queryMsg);
  console.log(`smart query ${JSON.stringify(queryMsg)} →`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error("\nFailed to query the contract.");
  console.error(
    "Needs a reachable QORE_RPC_URL and a valid QORE_CONTRACT whose schema matches QORE_QUERY_MSG.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
