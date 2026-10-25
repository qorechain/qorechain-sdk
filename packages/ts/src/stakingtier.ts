/**
 * Staking tiers (chain v3.2.4, `x/stakingtier`).
 *
 * A delegator locks part of an existing delegation for 3, 6 or 12 months and
 * earns a bonus on top of the staking reward (the terms and bonus rates are
 * governance parameters, read them with {@link fetchStakingTierParams}).
 * Running a light node or a validator adds to the bonus, up to a total cap.
 * Leaving a lock early burns a penalty and forfeits the bonus.
 *
 * Messages: `msg.stakingtier.lockDelegation`, `unlockEarly`, `claimBonus`.
 * Reads (REST): {@link fetchStakingTierParams}, {@link fetchStakingLocks},
 * {@link fetchStakingTierPool}.
 */

import type { FetchLike } from "./query/http";

/** The lock terms the chain accepts (`AllowedLockMonths`). */
export const STAKING_LOCK_MONTHS: readonly number[] = [3, 6, 12];

/**
 * The chain's stateless checks on `MsgLockDelegation`, run by
 * `msg.stakingtier.lockDelegation` before encoding. Throws an `Error` naming
 * the field.
 */
export function validateLockDelegation(value: {
  delegator?: string;
  validator?: string;
  amount?: string;
  months?: number;
}): void {
  if (!value.delegator) throw new Error("lockDelegation: delegator is required");
  if (!value.validator) throw new Error("lockDelegation: validator is required");
  if (typeof value.amount !== "string" || !/^\d+$/.test(value.amount) || BigInt(value.amount) <= 0n) {
    throw new Error(`lockDelegation: amount must be a positive integer in base units, got ${JSON.stringify(value.amount)}`);
  }
  if (!STAKING_LOCK_MONTHS.includes(value.months ?? -1)) {
    throw new Error(`lockDelegation: months must be one of ${STAKING_LOCK_MONTHS.join(", ")}, got ${value.months}`);
  }
}

/** Module parameters (`/qorechain/stakingtier/v1/params`). */
export interface StakingTierParams {
  /** Offered terms and their bonus, in basis points of APY. */
  lockTiers: { months: number; bonusBps: number }[];
  /** Extra bonus for a holder that runs an active light node. */
  lightNodeBonusBps: number;
  /** Extra bonus for a holder that runs a validator. */
  validatorBonusBps: number;
  /** Cap on the total yield (staking reward plus every bonus). */
  maxTotalApyBps: number;
  /** Share of the locked amount burned on an early unlock. */
  earlyUnlockPenaltyBps: number;
  /** Whether governance has the module switched on. */
  enabled: boolean;
  /** Smallest lock, in base units. */
  minLockAmount: bigint;
}

/** One lock (`/qorechain/stakingtier/v1/locks/{holder}`). */
export interface StakingLock {
  id: bigint;
  validator: string;
  lockedAmount: bigint;
  lockedShares: string;
  months: number;
  tierBonusBps: number;
  startHeight: bigint;
  /** Unix seconds. */
  startTime: bigint;
  /** Unix seconds; the lock is released at this block time. */
  endTime: bigint;
  accruedBonus: bigint;
  released: boolean;
  lightNodeBonusBps: number;
  validatorBonusBps: number;
  /** Decimal string. */
  projectedBonusBps: string;
  projectedBonusToExpiry: bigint;
}

/** A holder's locks and claimable bonus. */
export interface StakingLocks {
  locks: StakingLock[];
  claimable: bigint;
  totalClaimable: bigint;
}

/** The bonus pool (`/qorechain/stakingtier/v1/pool`). */
export interface StakingTierPool {
  balance: bigint;
  outstanding: bigint;
  surplus: bigint;
  totalMinted: bigint;
  totalPaid: bigint;
  totalForfeited: bigint;
  totalPenaltyBurned: bigint;
  lastSettleTime: bigint;
  lastSettleHeight: bigint;
  /** Decimal string. */
  lastBaseApyBps: string;
  lockCount: bigint;
}

type Raw = Record<string, unknown>;
const int = (v: unknown): bigint => (typeof v === "string" || typeof v === "number" ? BigInt(v || 0) : 0n);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function getJson(opts: { rest: string; fetch?: FetchLike }, path: string): Promise<Raw> {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `${opts.rest.replace(/\/+$/, "")}${path}`;
  const res = await f(url);
  if (!res.ok) throw new Error(`stakingtier query failed: HTTP ${res.status} from ${url}`);
  return (await res.json()) as Raw;
}

/** Read the module parameters. */
export async function fetchStakingTierParams(opts: { rest: string; fetch?: FetchLike }): Promise<StakingTierParams> {
  const b = await getJson(opts, "/qorechain/stakingtier/v1/params");
  return {
    lockTiers: (Array.isArray(b.lock_tiers) ? (b.lock_tiers as Raw[]) : []).map((t) => ({
      months: num(t.months),
      bonusBps: num(t.bonus_bps),
    })),
    lightNodeBonusBps: num(b.light_node_bonus_bps),
    validatorBonusBps: num(b.validator_bonus_bps),
    maxTotalApyBps: num(b.max_total_apy_bps),
    earlyUnlockPenaltyBps: num(b.early_unlock_penalty_bps),
    enabled: b.enabled === true,
    minLockAmount: int(b.min_lock_amount),
  };
}

/** Read a holder's locks and claimable bonus. */
export async function fetchStakingLocks(opts: {
  rest: string;
  /** The `qor1…` holder. */
  holder: string;
  fetch?: FetchLike;
}): Promise<StakingLocks> {
  const b = await getJson(opts, `/qorechain/stakingtier/v1/locks/${encodeURIComponent(opts.holder)}`);
  return {
    locks: (Array.isArray(b.locks) ? (b.locks as Raw[]) : []).map((l) => ({
      id: int(l.id),
      validator: str(l.validator),
      lockedAmount: int(l.locked_amount),
      lockedShares: str(l.locked_shares),
      months: num(l.months),
      tierBonusBps: num(l.tier_bonus_bps),
      startHeight: int(l.start_height),
      startTime: int(l.start_time),
      endTime: int(l.end_time),
      accruedBonus: int(l.accrued_bonus),
      released: l.released === true,
      lightNodeBonusBps: num(l.light_node_bonus_bps),
      validatorBonusBps: num(l.validator_bonus_bps),
      projectedBonusBps: str(l.projected_bonus_bps),
      projectedBonusToExpiry: int(l.projected_bonus_to_expiry),
    })),
    claimable: int(b.claimable),
    totalClaimable: int(b.total_claimable),
  };
}

/** Read the bonus pool. */
export async function fetchStakingTierPool(opts: { rest: string; fetch?: FetchLike }): Promise<StakingTierPool> {
  const b = await getJson(opts, "/qorechain/stakingtier/v1/pool");
  return {
    balance: int(b.balance),
    outstanding: int(b.outstanding),
    surplus: int(b.surplus),
    totalMinted: int(b.total_minted),
    totalPaid: int(b.total_paid),
    totalForfeited: int(b.total_forfeited),
    totalPenaltyBurned: int(b.total_penalty_burned),
    lastSettleTime: int(b.last_settle_time),
    lastSettleHeight: int(b.last_settle_height),
    lastBaseApyBps: str(b.last_base_apy_bps),
    lockCount: int(b.lock_count),
  };
}
