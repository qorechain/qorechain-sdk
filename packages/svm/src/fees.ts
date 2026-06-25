/**
 * Compute-budget and priority-fee conveniences over `@solana/web3.js`.
 *
 * {@link withComputeBudget} prepends `ComputeBudgetProgram` instructions to a
 * legacy `Transaction` so it requests a compute-unit limit and pays a per-CU
 * priority price; {@link estimatePriorityFee} reads recent prioritization fees
 * from the RPC to suggest a `microLamports` price.
 */

import {
  ComputeBudgetProgram,
  type Connection,
  type PublicKey,
  type Transaction,
} from "@solana/web3.js";

/** Compute-budget options for {@link withComputeBudget}. */
export interface ComputeBudgetOptions {
  /** Compute-unit limit to request (`setComputeUnitLimit`). */
  units?: number;
  /** Per-compute-unit price in micro-lamports (`setComputeUnitPrice`). */
  microLamports?: number | bigint;
}

/**
 * Prepend `ComputeBudgetProgram` instructions to `tx` (mutating it in place and
 * returning it). A unit-limit instruction is added when `units` is given, and a
 * unit-price instruction when `microLamports` is given; both are inserted at the
 * front of the instruction list, as required by the runtime.
 *
 * @returns The same `tx`, for chaining.
 */
export function withComputeBudget(
  tx: Transaction,
  options: ComputeBudgetOptions,
): Transaction {
  const { units, microLamports } = options;
  const prepend = [];
  if (microLamports !== undefined) {
    prepend.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    );
  }
  if (units !== undefined) {
    prepend.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units }));
  }
  tx.instructions.unshift(...prepend);
  return tx;
}

/**
 * Estimate a priority fee (`microLamports` per CU) from the RPC's
 * `getRecentPrioritizationFees`. Returns the maximum recently observed fee,
 * which is a conservative choice for landing a transaction quickly. Returns `0`
 * when the RPC reports no recent fees.
 *
 * @param connection - SVM RPC connection.
 * @param accounts   - Optional accounts the tx will lock, scoping the query.
 */
export async function estimatePriorityFee(
  connection: Connection,
  accounts: readonly PublicKey[] = [],
): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees(
    accounts.length > 0 ? { lockedWritableAccounts: [...accounts] } : undefined,
  );
  if (!fees || fees.length === 0) return 0;
  return fees.reduce((max, f) => Math.max(max, f.prioritizationFee), 0);
}

/** Namespaced compute-budget / fee helpers. */
export const fees = {
  withComputeBudget,
  estimatePriorityFee,
} as const;
