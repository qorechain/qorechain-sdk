/**
 * evm-precompile — call QoreChain EVM precompiles and read an ERC-20 balance.
 *
 * Shows:
 *  - createEvmClient({ endpoints }) → a viem-backed client bundle (chain id is
 *    auto-detected via eth_chainId)
 *  - precompiles.rlConsensusParams(publicClient) → live consensus parameters
 *  - precompiles.pqcKeyStatus(publicClient, account) → PQC key registration
 *  - erc20.balanceOf(publicClient, token, account) → an ERC-20 balance
 *
 * All reads are read-only `eth_call`s and need a reachable EVM JSON-RPC. On a
 * node without the QoreChain precompiles, the precompile calls throw "feature
 * not present" — the example reports that per-call and keeps going.
 */

import {
  createEvmClient,
  precompiles,
  erc20,
} from "@qorechain/evm";
import type { Address } from "viem";

async function tryRead<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    const value = await fn();
    console.log(`${label}:`, value);
  } catch (err) {
    console.log(`${label}: unavailable (${err instanceof Error ? err.message.split("\n")[0] : err})`);
  }
}

async function main(): Promise<void> {
  const evmRpc = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const account = (process.env.QORE_EVM_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as Address;

  const client = await createEvmClient({ endpoints: { evmRpc } });
  console.log(`evm chain id: ${await client.getChainId()}`);

  // Read-only precompile calls.
  await tryRead("rlConsensusParams", () =>
    precompiles.rlConsensusParams(client.publicClient),
  );
  await tryRead("pqcKeyStatus", () =>
    precompiles.pqcKeyStatus(client.publicClient, account),
  );

  // ERC-20 balanceOf for a token, if one is configured.
  const token = process.env.QORE_ERC20_TOKEN as Address | undefined;
  if (token) {
    await tryRead(`erc20 balanceOf(${account})`, () =>
      erc20.balanceOf(client.publicClient, token, account),
    );
  } else {
    console.log("erc20 balanceOf: skipped (set QORE_ERC20_TOKEN to a token address)");
  }
}

main().catch((err: unknown) => {
  console.error("\nFailed to reach the EVM JSON-RPC.");
  console.error("Set QORE_EVM_RPC_URL to a reachable QoreChain EVM endpoint.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
