/**
 * ERC-20 conveniences over viem's `readContract` / `writeContract`, using a
 * bundled minimal ERC-20 ABI. Read helpers take a viem `PublicClient`; write
 * helpers take a viem `WalletClient`.
 */

import type {
  Account,
  Address,
  Hash,
  PublicClient,
  WalletClient,
} from "viem";
import { ERC20_ABI } from "./abi";

/** Token metadata returned by {@link metadata}. */
export interface Erc20Metadata {
  name: string;
  symbol: string;
  decimals: number;
}

/** Read the token balance of `account`. */
export function balanceOf(
  client: PublicClient,
  token: Address,
  account: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

/** Read the remaining allowance `spender` may draw from `owner`. */
export function allowance(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
}

/** Read name/symbol/decimals in parallel. */
export async function metadata(
  client: PublicClient,
  token: Address,
): Promise<Erc20Metadata> {
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "name" }),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { name, symbol, decimals };
}

/** Transfer `amount` tokens to `to`. Returns the transaction hash. */
export function transfer(
  client: WalletClient,
  token: Address,
  to: Address,
  amount: bigint,
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, amount],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Approve `spender` to draw up to `amount`. Returns the transaction hash. */
export function approve(
  client: WalletClient,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<Hash> {
  return client.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    account: client.account as Account,
    chain: client.chain,
  });
}

/** Namespaced ERC-20 helpers. */
export const erc20 = {
  balanceOf,
  allowance,
  metadata,
  transfer,
  approve,
} as const;
