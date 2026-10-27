/**
 * instantiate.ts - create a CW20 token from a stored code id.
 *
 * On the testnet anyone may instantiate (`instantiate_default_permission` is
 * `Everybody`), as long as the code itself allows it. On mainnet the default is
 * `Nobody`.
 *
 *   QORE_CODE_ID=123 pnpm instantiate
 */
import { toUtf8 } from "@cosmjs/encoding";
import { MsgInstantiateContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import { connect, requireEnv } from "./connect.js";

async function main(): Promise<void> {
  const { tx, address } = await connect();
  const codeId = BigInt(requireEnv("QORE_CODE_ID"));

  const init = {
    name: process.env.QORE_TOKEN_NAME ?? "Example Token",
    symbol: process.env.QORE_TOKEN_SYMBOL ?? "EXT",
    decimals: 6,
    initial_balances: [{ address, amount: process.env.QORE_TOKEN_SUPPLY ?? "1000000000" }],
    mint: { minter: address },
  };

  const message = {
    typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
    value: MsgInstantiateContract.fromPartial({
      sender: address,
      admin: address,
      codeId,
      label: `${init.symbol.toLowerCase()}-${Date.now()}`,
      msg: toUtf8(JSON.stringify(init)),
      funds: [],
    }),
  };

  const res = await tx.signAndBroadcast([message], "auto");
  const contract = res.events
    ?.find((e) => e.type === "instantiate")
    ?.attributes.find((a) => a.key === "_contract_address")?.value;
  console.log(`tx:       ${res.transactionHash}`);
  console.log(`contract: ${contract ?? "(see the transaction events)"}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
