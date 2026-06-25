import { describe, it, expect, vi } from "vitest";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { withComputeBudget, estimatePriorityFee } from "../src/fees";

const A = new PublicKey("11111111111111111111111111111112");
const B = new PublicKey("11111111111111111111111111111113");

const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;

describe("withComputeBudget", () => {
  it("prepends setComputeUnitLimit + setComputeUnitPrice instructions before existing ones", () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: A, toPubkey: B, lamports: 1 }),
    );
    const out = withComputeBudget(tx, { units: 200_000, microLamports: 1_000 });

    expect(out).toBe(tx); // mutates + returns same tx
    expect(tx.instructions).toHaveLength(3);
    // first two are compute-budget instructions
    expect(tx.instructions[0].programId.equals(COMPUTE_BUDGET_PROGRAM_ID)).toBe(true);
    expect(tx.instructions[1].programId.equals(COMPUTE_BUDGET_PROGRAM_ID)).toBe(true);
    // the transfer remains last
    expect(tx.instructions[2].programId.equals(SystemProgram.programId)).toBe(true);
    // limit instruction is first (discriminator 0x02), price second (0x03)
    expect(tx.instructions[0].data[0]).toBe(2);
    expect(tx.instructions[1].data[0]).toBe(3);
  });

  it("adds only the limit instruction when microLamports omitted", () => {
    const tx = new Transaction();
    withComputeBudget(tx, { units: 100_000 });
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].data[0]).toBe(2);
  });

  it("adds only the price instruction when units omitted", () => {
    const tx = new Transaction();
    withComputeBudget(tx, { microLamports: 500 });
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].data[0]).toBe(3);
  });
});

describe("estimatePriorityFee", () => {
  it("returns the max recent prioritization fee", async () => {
    const conn = {
      getRecentPrioritizationFees: vi.fn(async () => [
        { slot: 1, prioritizationFee: 100 },
        { slot: 2, prioritizationFee: 250 },
        { slot: 3, prioritizationFee: 50 },
      ]),
    } as unknown as Connection;
    expect(await estimatePriorityFee(conn)).toBe(250);
  });

  it("scopes the query to provided accounts", async () => {
    const spy = vi.fn(async () => [{ slot: 1, prioritizationFee: 7 }]);
    const conn = { getRecentPrioritizationFees: spy } as unknown as Connection;
    await estimatePriorityFee(conn, [A, B]);
    expect(spy).toHaveBeenCalledWith({ lockedWritableAccounts: [A, B] });
  });

  it("returns 0 when no recent fees are reported", async () => {
    const conn = {
      getRecentPrioritizationFees: vi.fn(async () => []),
    } as unknown as Connection;
    expect(await estimatePriorityFee(conn)).toBe(0);
  });
});
