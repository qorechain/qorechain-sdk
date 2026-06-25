/**
 * ERC-1155 conveniences over viem's `readContract` / `writeContract`, using a
 * bundled minimal ERC-1155 ABI. Read helpers take a viem `PublicClient`; write
 * helpers take a viem `WalletClient`. Mirrors the {@link erc20} style.
 */

import type {
  Account,
  Address,
  Hash,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";
import { ERC1155_ABI } from "./abi";

/** Read the balance of token `id` held by `account`. */
export function balanceOf(
  client: PublicClient,
  token: Address,
  account: Address,
  id: bigint,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "balanceOf",
    args: [account, id],
  });
}

/** Read balances of `(accounts[i], ids[i])` pairs in a single call. */
export function balanceOfBatch(
  client: PublicClient,
  token: Address,
  accounts: readonly Address[],
  ids: readonly bigint[],
): Promise<readonly bigint[]> {
  return client.readContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "balanceOfBatch",
    args: [accounts, ids],
  });
}

/** Read the metadata URI template for token `id`. */
export function uri(
  client: PublicClient,
  token: Address,
  id: bigint,
): Promise<string> {
  return client.readContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "uri",
    args: [id],
  });
}

/** Read whether `operator` is approved to manage all of `account`'s tokens. */
export function isApprovedForAll(
  client: PublicClient,
  token: Address,
  account: Address,
  operator: Address,
): Promise<boolean> {
  return client.readContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "isApprovedForAll",
    args: [account, operator],
  });
}

/** Set or revoke `operator` as an approved manager for all caller tokens. */
export function setApprovalForAll(
  client: WalletClient,
  token: Address,
  operator: Address,
  approved: boolean,
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "setApprovalForAll",
    args: [operator, approved],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Transfer `amount` of token `id` from `from` to `to`. */
export function safeTransferFrom(
  client: WalletClient,
  token: Address,
  from: Address,
  to: Address,
  id: bigint,
  amount: bigint,
  data: Hex = "0x",
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "safeTransferFrom",
    args: [from, to, id, amount, data],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Batch-transfer `amounts[i]` of token `ids[i]` from `from` to `to`. */
export function safeBatchTransferFrom(
  client: WalletClient,
  token: Address,
  from: Address,
  to: Address,
  ids: readonly bigint[],
  amounts: readonly bigint[],
  data: Hex = "0x",
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC1155_ABI,
    functionName: "safeBatchTransferFrom",
    args: [from, to, ids, amounts, data],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Namespaced ERC-1155 helpers. */
export const erc1155 = {
  balanceOf,
  balanceOfBatch,
  uri,
  isApprovedForAll,
  setApprovalForAll,
  safeTransferFrom,
  safeBatchTransferFrom,
} as const;
