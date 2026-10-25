import { describe, it, expect, vi } from "vitest";

import { stakingtier } from "../../src/messages/qorechain";
import { qorechainRegistry } from "../../src/messages/registry";
import { MsgLockDelegation } from "../../src/codegen/qorechain/stakingtier/v1/tx";
import { fetchStakingTierParams, fetchStakingLocks, fetchStakingTierPool, STAKING_LOCK_MONTHS } from "../../src/stakingtier";
import { fetchProtocolFeatures, isProtocolFeatureEnabled } from "../../src/pqc/protocol-features";
import { fetchAuthNonce } from "../../src/tx/authenticator";
import { fetchPqcStatus, clearPqcStatusCache } from "../../src/helpers/pqc";
import { decodeTxError } from "../../src/errors";
import { ibcTimeoutTimestamp } from "../../src/messages/cosmos";

const ADDR = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
const VAL = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk";
const json = (body: unknown, status = 200) =>
  vi.fn(async (url: string) => { void url; return { ok: status >= 200 && status < 300, status, json: async () => body }; });

describe("staking tiers (chain v3.2.4)", () => {
  it("lockDelegation encodes and round-trips through the registry", () => {
    const m = stakingtier.lockDelegation({ delegator: ADDR, validator: VAL, amount: "10000000", months: 6 });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(any.typeUrl).toBe("/qorechain.stakingtier.v1.MsgLockDelegation");
    expect(MsgLockDelegation.decode(any.value)).toMatchObject({ delegator: ADDR, validator: VAL, amount: "10000000", months: 6 });
  });

  it("lockDelegation applies the chain's checks", () => {
    const base = { delegator: ADDR, validator: VAL, amount: "10000000", months: 3 };
    expect(STAKING_LOCK_MONTHS).toEqual([3, 6, 12]);
    expect(() => stakingtier.lockDelegation({ ...base, months: 4 })).toThrow(/months must be one of 3, 6, 12/);
    expect(() => stakingtier.lockDelegation({ ...base, amount: "0" })).toThrow(/positive integer/);
    expect(() => stakingtier.lockDelegation({ ...base, amount: "1.5" })).toThrow(/positive integer/);
    expect(() => stakingtier.lockDelegation({ ...base, validator: "" })).toThrow(/validator/);
  });

  it("unlockEarly and claimBonus are registered", () => {
    const reg = qorechainRegistry();
    expect(reg.encodeAsAny(stakingtier.unlockEarly({ delegator: ADDR, lockId: 7n })).typeUrl).toBe("/qorechain.stakingtier.v1.MsgUnlockEarly");
    expect(reg.encodeAsAny(stakingtier.claimBonus({ holder: ADDR })).typeUrl).toBe("/qorechain.stakingtier.v1.MsgClaimBonus");
  });

  it("reads params, locks and pool (the mainnet shapes)", async () => {
    const params = await fetchStakingTierParams({
      rest: "https://lcd",
      fetch: json({ lock_tiers: [{ months: 3, bonus_bps: 150 }, { months: 12, bonus_bps: 500 }], light_node_bonus_bps: 200, validator_bonus_bps: 300, max_total_apy_bps: 2500, early_unlock_penalty_bps: 500, enabled: true, min_lock_amount: "10000000" }),
    });
    expect(params.lockTiers).toEqual([{ months: 3, bonusBps: 150 }, { months: 12, bonusBps: 500 }]);
    expect(params.minLockAmount).toBe(10_000_000n);
    expect(params.enabled).toBe(true);
    const f = json({ locks: [{ id: "1", validator: VAL, locked_amount: "20000000", months: 6, end_time: "1800000000", accrued_bonus: "5", released: false }], claimable: "5", total_claimable: "5" });
    const locks = await fetchStakingLocks({ rest: "https://lcd/", holder: ADDR, fetch: f });
    expect(f.mock.calls[0][0]).toBe(`https://lcd/qorechain/stakingtier/v1/locks/${ADDR}`);
    expect(locks.locks[0]).toMatchObject({ id: 1n, lockedAmount: 20_000_000n, months: 6, endTime: 1_800_000_000n, released: false });
    expect(locks.claimable).toBe(5n);
    const pool = await fetchStakingTierPool({ rest: "https://lcd", fetch: json({ balance: "0", lock_count: "3", last_base_apy_bps: "4510.47" }) });
    expect(pool.lockCount).toBe(3n);
    expect(pool.lastBaseApyBps).toBe("4510.47");
  });

  it("decodes the module's errors", () => {
    expect(decodeTxError({ code: 5, codespace: "stakingtier" }).kind).toBe("stakingtier_invalid_term");
    expect(decodeTxError({ code: 13, codespace: "stakingtier" }).kind).toBe("stakingtier_stake_locked");
  });
});

describe("chain v3.2.4 reads", () => {
  it("protocol features", async () => {
    const f = json({ features: [{ name: "pqc-sign-bytes-v2", enabled: true, known: true, staged: false }, { name: "x", enabled: false, known: true, staged: true }], height: "3758400" });
    const r = await fetchProtocolFeatures({ rest: "https://lcd", fetch: f });
    expect(r.height).toBe(3_758_400n);
    expect(r.features[1]).toEqual({ name: "x", enabled: false, known: true, staged: true });
    expect(await isProtocolFeatureEnabled({ rest: "https://lcd", name: "pqc-sign-bytes-v2", fetch: f })).toBe(true);
    expect(await isProtocolFeatureEnabled({ rest: "https://lcd", name: "x", fetch: f })).toBe(false);
    expect(await isProtocolFeatureEnabled({ rest: "https://lcd", name: "absent", fetch: f })).toBe(false);
  });

  it("auth nonce: bytes or hex key, the key's own counter", async () => {
    const f = json({ nonce: "7", linked: true });
    const r = await fetchAuthNonce({ rest: "https://lcd", address: ADDR, pubkey: new Uint8Array([0xab, 0x01]), fetch: f });
    expect(r).toEqual({ nonce: 7n, linked: true });
    expect(f.mock.calls[0][0]).toBe(`https://lcd/qorechain/abstractaccount/v1/auth_nonce/${ADDR}/ab01`);
    await fetchAuthNonce({ rest: "https://lcd", address: ADDR, pubkey: "0xAB01", fetch: f });
    expect(f.mock.calls[1][0]).toMatch(/\/AB01$/);
    await expect(fetchAuthNonce({ rest: "https://lcd", address: ADDR, pubkey: "zz", fetch: f })).rejects.toThrow(/hex/);
  });

  it("PQC status carries possession_proven", async () => {
    clearPqcStatusCache();
    const s = await fetchPqcStatus({ rest: "https://lcd", address: ADDR, fetch: json({ found: true, account: { public_key: "AQID", possession_proven: true } }) });
    expect(s.possessionProven).toBe(true);
  });

  it("ibcTimeoutTimestamp is an absolute Unix time in nanoseconds", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    expect(ibcTimeoutTimestamp(600, now)).toBe(BigInt(now.getTime() + 600_000) * 1_000_000n);
    expect(() => ibcTimeoutTimestamp(0)).toThrow(/positive/);
  });
});
