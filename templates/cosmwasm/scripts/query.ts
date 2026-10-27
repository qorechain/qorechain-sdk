/**
 * query.ts - read-only queries over the network's REST API.
 *
 *   pnpm query params                      upload and instantiate permissions
 *   pnpm query codes                       the most recent stored codes
 *   pnpm query proposals                   open governance proposals
 *   pnpm query token <contract>            CW20 token_info
 *   pnpm query balance <contract> <addr>   CW20 balance
 */
import { restGet } from "./connect.js";

const smart = (contract: string, query: unknown) =>
  restGet<{ data: unknown }>(
    `/cosmwasm/wasm/v1/contract/${contract}/smart/${Buffer.from(JSON.stringify(query)).toString("base64")}`,
  ).then((r) => r.data);

async function main(): Promise<void> {
  const [cmd = "params", a, b] = process.argv.slice(2);
  let out: unknown;
  switch (cmd) {
    case "params":
      out = await restGet("/cosmwasm/wasm/v1/codes/params");
      break;
    case "codes":
      out = await restGet("/cosmwasm/wasm/v1/code?pagination.limit=5&pagination.reverse=true");
      break;
    case "proposals":
      out = await restGet("/cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD");
      break;
    case "token":
      if (!a) throw new Error("usage: pnpm query token <contract>");
      out = await smart(a, { token_info: {} });
      break;
    case "balance":
      if (!a || !b) throw new Error("usage: pnpm query balance <contract> <address>");
      out = await smart(a, { balance: { address: b } });
      break;
    default:
      throw new Error(`Unknown query "${cmd}"`);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
