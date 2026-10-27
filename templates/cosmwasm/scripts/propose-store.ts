/**
 * propose-store.ts - submit a governance proposal that uploads the contract.
 *
 * On QoreChain nobody can upload Wasm code directly: the chain's
 * `code_upload_access` is `Nobody` on both networks, so code is stored only by
 * a governance proposal carrying `MsgStoreCode` with the governance module as
 * its sender. This script builds that proposal from artifacts/cw20_token.wasm
 * and submits it with the minimum deposit. The code id exists once the
 * proposal passes; find it with `pnpm query codes`.
 *
 * Testnet only by default. On mainnet, publish your source and a reproducible
 * build first and expect a public review before any vote.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { msg } from "@qorechain/sdk";
import { MsgStoreCode } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { AccessType } from "cosmjs-types/cosmwasm/wasm/v1/types";

import { connect, restGet } from "./connect.js";

const WASM = process.env.QORE_WASM ?? "artifacts/cw20_token.wasm";

async function main(): Promise<void> {
  const { tx, address, network } = await connect();
  if (network === "mainnet" && process.env.QORE_I_KNOW_THIS_IS_MAINNET !== "yes") {
    throw new Error("Refusing to propose on mainnet. Set QORE_I_KNOW_THIS_IS_MAINNET=yes if you mean it.");
  }

  const gov = await restGet<{ account: { value?: { address?: string }; base_account?: { address: string }; address?: string } }>(
    "/cosmos/auth/v1beta1/module_accounts/gov",
  );
  const authority = gov.account.base_account?.address ?? gov.account.address ?? gov.account.value?.address;
  if (!authority) throw new Error("Could not read the governance module address");

  const params = await restGet<{ params: { min_deposit: { denom: string; amount: string }[] } }>(
    "/cosmos/gov/v1/params/deposit",
  );

  const wasm = gzipSync(readFileSync(WASM), { level: 9 });
  const store = MsgStoreCode.fromPartial({
    sender: authority,
    wasmByteCode: wasm,
    instantiatePermission: { permission: AccessType.ACCESS_TYPE_EVERYBODY, addresses: [] },
  });

  const proposal = msg.gov.submitProposal({
    messages: [{ typeUrl: "/cosmwasm.wasm.v1.MsgStoreCode", value: MsgStoreCode.encode(store).finish() }],
    initialDeposit: params.params.min_deposit,
    proposer: address,
    metadata: "",
    title: process.env.QORE_PROPOSAL_TITLE ?? "Store the cw20-token contract",
    summary:
      process.env.QORE_PROPOSAL_SUMMARY ??
      "Uploads a CW20 token contract built from cw20-base (cw-plus) with the CosmWasm optimizer.",
    expedited: false,
  });

  console.log(`proposer:  ${address}`);
  console.log(`authority: ${authority}`);
  console.log(`wasm:      ${WASM} (${wasm.length} bytes gzipped)`);
  console.log(`deposit:   ${params.params.min_deposit.map((c) => `${c.amount}${c.denom}`).join(", ")}`);
  const res = await tx.signAndBroadcast([proposal], "auto");
  console.log(`submitted: ${res.transactionHash}`);
  console.log("Follow the vote with: pnpm query proposals");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
