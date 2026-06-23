import { describe, it, expect } from "vitest";
import { base58 } from "@scure/base";
import {
  generateMnemonic,
  validateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "../../src/accounts/wallet";
import { isValidBech32 } from "../../src/utils/address";

/**
 * Well-known PUBLIC test mnemonic (the canonical Hardhat/Anvil dev mnemonic).
 * NEVER use a real/funded mnemonic in tests.
 */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

/**
 * A 12-word phrase with valid words but an INVALID BIP-39 checksum. Deriving
 * from this must reject rather than silently produce a valid-looking wrong
 * account (fund-loss footgun).
 */
const BAD_CHECKSUM_MNEMONIC = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo";

describe("mnemonic helpers", () => {
  it("generateMnemonic() returns a 12-word phrase that validates", () => {
    const m = generateMnemonic();
    expect(m.split(" ")).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("generateMnemonic(256) returns a 24-word phrase that validates", () => {
    const m = generateMnemonic(256);
    expect(m.split(" ")).toHaveLength(24);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("validateMnemonic() rejects garbage", () => {
    expect(validateMnemonic("not a real mnemonic phrase")).toBe(false);
  });

  it("validateMnemonic() accepts the public test mnemonic", () => {
    expect(validateMnemonic(TEST_MNEMONIC)).toBe(true);
  });
});

describe("deriveEvmAccount (strong known-answer)", () => {
  it("derives the canonical first dev account at index 0 with EIP-55 checksum", async () => {
    const acct = await deriveEvmAccount(TEST_MNEMONIC);
    expect(acct.type).toBe("evm");
    expect(acct.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(acct.publicKey).toHaveLength(33); // compressed secp256k1
    expect(acct.privateKey).toHaveLength(32);
  });

  it("derives the canonical second dev account at index 1", async () => {
    const acct = await deriveEvmAccount(TEST_MNEMONIC, { accountIndex: 1 });
    expect(acct.address).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });

  it("produces a 0x-prefixed 20-byte (42-char) address", async () => {
    const acct = await deriveEvmAccount(TEST_MNEMONIC);
    expect(acct.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("deriveNativeAccount (QoreChain bech32)", () => {
  it("matches the cosmjs-cross-verified known answer at index 0", async () => {
    const acct = await deriveNativeAccount(TEST_MNEMONIC);
    expect(acct.type).toBe("native");
    // Cross-verified against @cosmjs/proto-signing DirectSecp256k1HdWallet
    // (prefix "qor", hdPath m/44'/118'/0'/0/0) — see report.
    expect(acct.address).toBe("qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu");
    expect(acct.address.startsWith("qor1")).toBe(true);
    expect(isValidBech32(acct.address, "qor")).toBe(true);
    expect(acct.publicKey).toHaveLength(33);
    expect(acct.privateKey).toHaveLength(32);
  });

  it("matches the cosmjs-cross-verified known answer at index 1", async () => {
    const acct = await deriveNativeAccount(TEST_MNEMONIC, { accountIndex: 1 });
    expect(acct.address).toBe("qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq");
    expect(isValidBech32(acct.address, "qor")).toBe(true);
  });

  it("is deterministic across calls", async () => {
    const a = await deriveNativeAccount(TEST_MNEMONIC);
    const b = await deriveNativeAccount(TEST_MNEMONIC);
    expect(a.address).toBe(b.address);
  });
});

describe("deriveSvmAccount (ed25519 / Solana convention)", () => {
  it("derives a deterministic base58 address decoding to 32 bytes", async () => {
    const acct = await deriveSvmAccount(TEST_MNEMONIC);
    expect(acct.type).toBe("svm");
    expect(base58.decode(acct.address)).toHaveLength(32);
    expect(acct.publicKey).toHaveLength(32);
    // Solana stores secret keys as 64 bytes (32 seed || 32 pubkey).
    expect(acct.secretKey).toHaveLength(64);
  });

  it("matches the known answer at index 0 (m/44'/501'/0'/0')", async () => {
    const acct = await deriveSvmAccount(TEST_MNEMONIC);
    expect(acct.address).toBe("oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96");
  });

  it("is deterministic across calls", async () => {
    const a = await deriveSvmAccount(TEST_MNEMONIC);
    const b = await deriveSvmAccount(TEST_MNEMONIC);
    expect(a.address).toBe(b.address);
  });
});

describe("accountIndex varies the address for every type", () => {
  it("native: different index → different address", async () => {
    const a0 = await deriveNativeAccount(TEST_MNEMONIC, { accountIndex: 0 });
    const a1 = await deriveNativeAccount(TEST_MNEMONIC, { accountIndex: 1 });
    expect(a0.address).not.toBe(a1.address);
  });

  it("evm: different index → different address", async () => {
    const a0 = await deriveEvmAccount(TEST_MNEMONIC, { accountIndex: 0 });
    const a1 = await deriveEvmAccount(TEST_MNEMONIC, { accountIndex: 1 });
    expect(a0.address).not.toBe(a1.address);
  });

  it("svm: different index → different address", async () => {
    const a0 = await deriveSvmAccount(TEST_MNEMONIC, { accountIndex: 0 });
    const a1 = await deriveSvmAccount(TEST_MNEMONIC, { accountIndex: 1 });
    expect(a0.address).not.toBe(a1.address);
  });
});

describe("derivation rejects an invalid mnemonic (fund-loss guard)", () => {
  // A typo'd mnemonic must NOT silently derive a valid-looking wrong account.
  it("deriveNativeAccount throws on a bad-checksum phrase", async () => {
    await expect(deriveNativeAccount(BAD_CHECKSUM_MNEMONIC)).rejects.toThrow(
      /invalid mnemonic/i,
    );
  });

  it("deriveEvmAccount throws on a bad-checksum phrase", async () => {
    await expect(deriveEvmAccount(BAD_CHECKSUM_MNEMONIC)).rejects.toThrow(
      /invalid mnemonic/i,
    );
  });

  it("deriveSvmAccount throws on a bad-checksum phrase", async () => {
    await expect(deriveSvmAccount(BAD_CHECKSUM_MNEMONIC)).rejects.toThrow(
      /invalid mnemonic/i,
    );
  });

  it("the error never leaks the mnemonic text", async () => {
    await expect(deriveEvmAccount(BAD_CHECKSUM_MNEMONIC)).rejects.toThrow(
      expect.not.stringContaining("zoo"),
    );
  });

  it("a valid phrase still derives for every type (regression)", async () => {
    await expect(deriveNativeAccount(TEST_MNEMONIC)).resolves.toBeDefined();
    await expect(deriveEvmAccount(TEST_MNEMONIC)).resolves.toBeDefined();
    await expect(deriveSvmAccount(TEST_MNEMONIC)).resolves.toBeDefined();
  });
});

describe("accountIndex guard rejects invalid indices", () => {
  it("native: throws on a negative index", async () => {
    await expect(
      deriveNativeAccount(TEST_MNEMONIC, { accountIndex: -1 }),
    ).rejects.toThrow(/accountIndex/i);
  });

  it("evm: throws on a non-integer index", async () => {
    await expect(
      deriveEvmAccount(TEST_MNEMONIC, { accountIndex: 1.5 }),
    ).rejects.toThrow(/accountIndex/i);
  });

  it("svm: throws on a negative index", async () => {
    await expect(
      deriveSvmAccount(TEST_MNEMONIC, { accountIndex: -1 }),
    ).rejects.toThrow(/accountIndex/i);
  });
});
