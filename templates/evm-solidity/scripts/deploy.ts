/**
 * deploy.ts — deploy the Counter contract to the QoreChain EVM Engine and
 * exercise it: read the initial count, increment it, and read it back.
 *
 * Uses @qorechain/evm:
 *   - createEvmClient({ endpoints })  → a viem-backed client (chain id auto-detected)
 *   - deployContract(walletClient, …) → deploy and get the tx hash
 *   - readContract / writeContract    → typed reads and writes
 *
 * Requirements (see README):
 *   - QORE_EVM_RPC_URL pointing at a reachable QoreChain EVM JSON-RPC endpoint.
 *   - QORE_EVM_PRIVATE_KEY for a funded EVM account (0x-prefixed, 32 bytes).
 */
import {
  createEvmClient,
  deployContract,
  evmAccountFromPrivateKey,
  readContract,
  writeContract,
} from "@qorechain/evm";
import type { Address, Hex } from "viem";

import { counterAbi, counterBytecode } from "../contracts/Counter.artifact.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const evmRpc = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const privateKey = requireEnv("QORE_EVM_PRIVATE_KEY") as Hex;
  const initialCount = BigInt(process.env.QORE_COUNTER_INITIAL ?? "0");

  const client = await createEvmClient({ endpoints: { evmRpc } });
  const account = evmAccountFromPrivateKey(privateKey);
  const wallet = client.getWalletClient(account);

  console.log(`network:  QoreChain EVM (chain id ${await client.getChainId()})`);
  console.log(`deployer: ${account.address}`);

  // Deploy.
  console.log(`\nDeploying Counter(initial=${initialCount})…`);
  const deployHash = await deployContract(wallet, {
    abi: counterAbi,
    bytecode: counterBytecode,
    args: [initialCount],
  });
  const receipt = await client.publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  const contract = receipt.contractAddress;
  if (!contract) {
    throw new Error("Deployment receipt did not include a contract address.");
  }
  console.log(`deployed: ${contract}`);

  // Read.
  const before = await readContract(client.publicClient, {
    address: contract as Address,
    abi: counterAbi,
    functionName: "count",
  });
  console.log(`count (before): ${before}`);

  // Write: increment. `account` and `chain` come from the wallet client; we pass
  // them explicitly so the call type-checks against viem's strict signature.
  console.log("\nCalling increment()…");
  const incHash = await writeContract(wallet, {
    address: contract as Address,
    abi: counterAbi,
    functionName: "increment",
    account: wallet.account ?? null,
    chain: wallet.chain,
  });
  await client.publicClient.waitForTransactionReceipt({ hash: incHash });

  // Read again.
  const after = await readContract(client.publicClient, {
    address: contract as Address,
    abi: counterAbi,
    functionName: "count",
  });
  console.log(`count (after):  ${after}`);
  console.log("\nDone.");
}

main().catch((err: unknown) => {
  console.error("\nDeploy failed.");
  console.error(
    "Check QORE_EVM_RPC_URL is reachable and QORE_EVM_PRIVATE_KEY funds an account.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
