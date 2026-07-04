import { describe, it, expect } from "vitest";
import {
  deriveUnifiedAccount,
  unifiedAccountFromSeed,
  addressesFrom20,
  qoreAddresses,
} from "../../src/accounts/unified";
import { isValidBech32 } from "../../src/utils/address";

/**
 * Well-known PUBLIC test mnemonic (the canonical Hardhat/Anvil dev mnemonic).
 * NEVER use a real/funded mnemonic in tests.
 */
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

/** Known-answer expectations for index 0 (asserted byte-for-byte). */
const KAT0 = {
  cosmos: "qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z",
  evm: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  svm: "HQ1S8pxTw4YN41GPdWYPQVfweQveXAUtfFnZNmvPfrYf",
  addr20: "f39fd6e51aad88f6f4ce6ab8827279cfffb92266",
};

/** KAT for the seed = 32×0x01 case. */
const KAT_SEED = {
  cosmos: "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj",
  evm: "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1",
  svm: "2n2Cnc7fib6rm4Azo1mbvMuHB3iCb1J254kEQDcrHyPu",
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("deriveUnifiedAccount", () => {
  it("matches the index-0 known-answer addresses exactly", async () => {
    const a = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    expect(a.cosmos).toBe(KAT0.cosmos);
    expect(a.evm).toBe(KAT0.evm);
    expect(a.svm).toBe(KAT0.svm);
    expect(toHex(a.addressBytes)).toBe(KAT0.addr20);
  });

  it("derives the deterministic ML-DSA-87 keypair (2592/4896) with a fixed prefix", async () => {
    const a = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    expect(a.pqc.publicKey.length).toBe(2592);
    expect(a.pqc.secretKey.length).toBe(4896);
    // Cross-language PQC determinism: the first 8 bytes are a known answer
    // (locked against the reference wallet-adapter).
    expect(toHex(a.pqc.publicKey.slice(0, 8))).toBe("4a685622f2a99d54");
    // deterministic: re-derivation yields the same PQC public key
    const b = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    expect(toHex(b.pqc.publicKey)).toBe(toHex(a.pqc.publicKey));
  });

  it("returns 0x-prefixed private (32B) and compressed public (33B) keys", async () => {
    const a = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    expect(a.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.publicKey).toMatch(/^0x[0-9a-f]{66}$/);
    expect(a.mnemonic).toBe(TEST_MNEMONIC);
  });

  it("varies by index", async () => {
    const a0 = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    const a1 = await deriveUnifiedAccount(TEST_MNEMONIC, 1);
    expect(a1.cosmos).not.toBe(a0.cosmos);
    expect(isValidBech32(a1.cosmos, "qor")).toBe(true);
  });

  it("rejects an invalid mnemonic and a bad index", async () => {
    await expect(deriveUnifiedAccount("not a mnemonic", 0)).rejects.toThrow(
      /invalid mnemonic/,
    );
    await expect(deriveUnifiedAccount(TEST_MNEMONIC, -1)).rejects.toThrow();
  });
});

describe("unifiedAccountFromSeed", () => {
  it("matches the 0x01×32 known-answer addresses exactly", () => {
    const s = unifiedAccountFromSeed(new Uint8Array(32).fill(1));
    expect(s.cosmos).toBe(KAT_SEED.cosmos);
    expect(s.evm).toBe(KAT_SEED.evm);
    expect(s.svm).toBe(KAT_SEED.svm);
    expect(s.mnemonic).toBeUndefined();
    expect(s.pqc.publicKey.length).toBe(2592);
    // Seed-path PQC determinism (uses the "seed:" prefix in the PQC seed context).
    expect(toHex(s.pqc.publicKey.slice(0, 8))).toBe("2d7f888fecbe5b24");
  });

  it("rejects a non-32-byte seed", () => {
    expect(() => unifiedAccountFromSeed(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("addressesFrom20 / qoreAddresses", () => {
  it("renders all three encodings from 20 bytes", async () => {
    const a = await deriveUnifiedAccount(TEST_MNEMONIC, 0);
    const enc = addressesFrom20(a.addressBytes);
    expect(enc.cosmos).toBe(KAT0.cosmos);
    expect(enc.evm).toBe(KAT0.evm);
    expect(enc.svm).toBe(KAT0.svm);
  });

  it("rejects a non-20-byte address", () => {
    expect(() => addressesFrom20(new Uint8Array(19))).toThrow(/20 bytes/);
  });

  it("round-trips via any single encoding", () => {
    const fromEvm = qoreAddresses({ evm: KAT0.evm });
    expect(fromEvm.cosmos).toBe(KAT0.cosmos);
    expect(fromEvm.svm).toBe(KAT0.svm);

    const fromCosmos = qoreAddresses({ cosmos: KAT0.cosmos });
    expect(fromCosmos.evm).toBe(KAT0.evm);

    const fromHex = qoreAddresses({ hex: KAT0.addr20 });
    expect(fromHex.cosmos).toBe(KAT0.cosmos);
    expect(fromHex.evm).toBe(KAT0.evm);
  });

  it("throws when no input is given", () => {
    expect(() => qoreAddresses({})).toThrow(/one of/);
  });
});
