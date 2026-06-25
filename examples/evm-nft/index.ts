/**
 * evm-nft — read ERC-721 NFT metadata over the QoreChain EVM Engine.
 *
 * Shows:
 *  - createEvmClient({ endpoints }) → a viem-backed client bundle
 *  - erc721.metadata(publicClient, nft) → { name, symbol }
 *  - erc721.ownerOf / tokenURI / balanceOf
 *
 * All reads are read-only `eth_call`s and need a reachable EVM JSON-RPC plus a
 * deployed ERC-721 contract. Set QORE_NFT_ADDRESS to a token; otherwise the
 * example explains what to configure and exits cleanly.
 */

import { createEvmClient, erc721 } from "@qorechain/evm";
import type { Address } from "viem";

async function tryRead<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    console.log(`${label}:`, await fn());
  } catch (err) {
    console.log(
      `${label}: unavailable (${err instanceof Error ? err.message.split("\n")[0] : err})`,
    );
  }
}

async function main(): Promise<void> {
  const evmRpc = process.env.QORE_EVM_RPC_URL ?? "http://localhost:8545";
  const nft = process.env.QORE_NFT_ADDRESS as Address | undefined;
  const tokenId = BigInt(process.env.QORE_NFT_TOKEN_ID ?? "1");
  const account = (process.env.QORE_EVM_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as Address;

  const client = await createEvmClient({ endpoints: { evmRpc } });
  console.log(`evm chain id: ${await client.getChainId()}`);

  if (!nft) {
    console.log("erc721: skipped (set QORE_NFT_ADDRESS to an ERC-721 contract)");
    return;
  }

  await tryRead("metadata", () => erc721.metadata(client.publicClient, nft));
  await tryRead(`ownerOf(${tokenId})`, () => erc721.ownerOf(client.publicClient, nft, tokenId));
  await tryRead(`tokenURI(${tokenId})`, () => erc721.tokenURI(client.publicClient, nft, tokenId));
  await tryRead(`balanceOf(${account})`, () => erc721.balanceOf(client.publicClient, nft, account));
}

main().catch((err: unknown) => {
  console.error("\nFailed to reach the EVM JSON-RPC.");
  console.error("Set QORE_EVM_RPC_URL to a reachable QoreChain EVM endpoint.");
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
