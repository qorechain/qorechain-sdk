/**
 * Fee estimation conveniences over viem.
 *
 * {@link estimateEip1559Fees} wraps viem's `estimateFeesPerGas` to return the
 * EIP-1559 `maxFeePerGas` / `maxPriorityFeePerGas` pair; {@link gasPrice} is a
 * legacy helper returning a single gas price. Both take a viem `PublicClient`.
 */

import type { PublicClient } from "viem";

/** EIP-1559 fee suggestion. */
export interface Eip1559Fees {
  /** Maximum total fee per gas (base + priority). */
  maxFeePerGas: bigint;
  /** Maximum priority (miner tip) fee per gas. */
  maxPriorityFeePerGas: bigint;
}

/**
 * Suggest EIP-1559 fees from the network, via viem's `estimateFeesPerGas`.
 *
 * @returns `{ maxFeePerGas, maxPriorityFeePerGas }`.
 */
export async function estimateEip1559Fees(
  client: PublicClient,
): Promise<Eip1559Fees> {
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await client.estimateFeesPerGas();
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Legacy (pre-EIP-1559) gas price via viem's `getGasPrice`. */
export function gasPrice(client: PublicClient): Promise<bigint> {
  return client.getGasPrice();
}

/** Namespaced fee helpers. */
export const fees = {
  estimateEip1559Fees,
  gasPrice,
} as const;
