/**
 * ERC-721 conveniences over viem's `readContract` / `writeContract`, using a
 * bundled minimal ERC-721 ABI. Read helpers take a viem `PublicClient`; write
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
import { ERC721_ABI } from "./abi";

/** Collection metadata returned by {@link metadata}. */
export interface Erc721Metadata {
  name: string;
  symbol: string;
}

/** Read the number of tokens owned by `owner`. */
export function balanceOf(
  client: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

/** Read the owner of `tokenId`. */
export function ownerOf(
  client: PublicClient,
  token: Address,
  tokenId: bigint,
): Promise<Address> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });
}

/** Read the metadata URI for `tokenId`. */
export function tokenURI(
  client: PublicClient,
  token: Address,
  tokenId: bigint,
): Promise<string> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "tokenURI",
    args: [tokenId],
  });
}

/** Read the approved address for a single `tokenId`. */
export function getApproved(
  client: PublicClient,
  token: Address,
  tokenId: bigint,
): Promise<Address> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "getApproved",
    args: [tokenId],
  });
}

/** Read whether `operator` is approved to manage all of `owner`'s tokens. */
export function isApprovedForAll(
  client: PublicClient,
  token: Address,
  owner: Address,
  operator: Address,
): Promise<boolean> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "isApprovedForAll",
    args: [owner, operator],
  });
}

/** Read the collection name. */
export function name(client: PublicClient, token: Address): Promise<string> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "name",
  });
}

/** Read the collection symbol. */
export function symbol(client: PublicClient, token: Address): Promise<string> {
  return client.readContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "symbol",
  });
}

/** Read name/symbol in parallel. */
export async function metadata(
  client: PublicClient,
  token: Address,
): Promise<Erc721Metadata> {
  const [n, s] = await Promise.all([name(client, token), symbol(client, token)]);
  return { name: n, symbol: s };
}

/** Approve `to` to transfer `tokenId`. Returns the transaction hash. */
export function approve(
  client: WalletClient,
  token: Address,
  to: Address,
  tokenId: bigint,
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "approve",
    args: [to, tokenId],
    account: client.account as Account,
    chain: client.chain,
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
    abi: ERC721_ABI,
    functionName: "setApprovalForAll",
    args: [operator, approved],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Transfer `tokenId` from `from` to `to`. Returns the transaction hash. */
export function transferFrom(
  client: WalletClient,
  token: Address,
  from: Address,
  to: Address,
  tokenId: bigint,
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "transferFrom",
    args: [from, to, tokenId],
    account: client.account as Account,
    chain: client.chain,
  });
}

/**
 * Safe-transfer `tokenId` from `from` to `to`. Pass `data` to invoke the
 * 4-argument `safeTransferFrom(from,to,tokenId,bytes)` overload.
 */
export function safeTransferFrom(
  client: WalletClient,
  token: Address,
  from: Address,
  to: Address,
  tokenId: bigint,
  data?: Hex,
): Promise<Hash> {
  if (data !== undefined) {
    return client.writeContract({
      address: token,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [from, to, tokenId, data],
      account: client.account as Account,
      chain: client.chain,
    });
  }
  return client.writeContract({
    address: token,
    abi: ERC721_ABI,
    functionName: "safeTransferFrom",
    args: [from, to, tokenId],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Namespaced ERC-721 helpers. */
export const erc721 = {
  balanceOf,
  ownerOf,
  tokenURI,
  getApproved,
  isApprovedForAll,
  name,
  symbol,
  metadata,
  approve,
  setApprovalForAll,
  transferFrom,
  safeTransferFrom,
} as const;
