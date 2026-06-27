/**
 * ai-preflight — score a transaction with QoreChain's on-chain AI before sending.
 *
 * QoreChain is the first network to expose an on-chain risk/anomaly model to any
 * dApp through plain `eth_call`s. This example:
 *  1. createEvmClient({ endpoints }) → a viem-backed client (chain id auto-detected)
 *  2. simulateWithRiskScore(publicClient, tx) → gas estimate + risk score +
 *     anomaly check + an advisory `safe` verdict, all read-only
 *  3. aiRiskScore / aiAnomalyCheck → the individual building blocks
 *
 * Everything here is a read-only `eth_call` / `eth_estimateGas`, so nothing is
 * signed or broadcast — it is a pre-flight check you run BEFORE sending. The
 * `safe` flag is advisory: set your own policy in production.
 *
 * On a node without the QoreChain AI precompiles, the precompile calls throw
 * "feature not present"; the example reports that per-call and keeps going.
 */

import {
  createEvmClient,
  simulateWithRiskScore,
  aiRiskScore,
  aiAnomalyCheck,
  RISK_LEVEL_UNSAFE_THRESHOLD,
} from "@qorechain/evm";
import type { Address, Hex } from "viem";

async function tryRead<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    const value = await fn();
    console.log(`${label}:`, value);
  } catch (err) {
    console.log(
      `${label}: unavailable (${err instanceof Error ? err.message.split("\n")[0] : err})`,
    );
  }
}

async function main(): Promise<void> {
  const evmRpc = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const from = (process.env.QORE_EVM_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as Address;
  const to = (process.env.QORE_EVM_TO ??
    "0x0000000000000000000000000000000000000002") as Address;
  // A sample ERC-20 transfer(0x..,1) calldata — replace with your real tx data.
  const data = (process.env.QORE_EVM_DATA ??
    "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000002" +
      "0000000000000000000000000000000000000000000000000000000000000001") as Hex;
  const value = BigInt(process.env.QORE_EVM_VALUE ?? "0");

  const client = await createEvmClient({ endpoints: { evmRpc } });
  console.log(`evm chain id: ${await client.getChainId()}`);
  console.log(`advisory unsafe threshold: level >= ${RISK_LEVEL_UNSAFE_THRESHOLD}\n`);

  const sampleTx = { from, to, data, value };
  console.log("sample tx:", sampleTx, "\n");

  // The one-call pre-flight: gas + risk + anomaly + verdict.
  await tryRead("simulateWithRiskScore", () =>
    simulateWithRiskScore(client.publicClient, sampleTx),
  );

  // The individual building blocks.
  await tryRead("aiRiskScore(data)", () =>
    aiRiskScore(client.publicClient, data),
  );
  await tryRead(`aiAnomalyCheck(${from}, ${value})`, () =>
    aiAnomalyCheck(client.publicClient, from, value),
  );

  console.log(
    "\nThe `safe` flag is advisory — enforce your own policy before broadcasting.",
  );
}

main().catch((err: unknown) => {
  console.error("\nFailed to reach the EVM JSON-RPC.");
  console.error("Set QORE_EVM_RPC_URL to a reachable QoreChain EVM endpoint.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
