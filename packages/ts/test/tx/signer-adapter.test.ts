import { describe, it, expect } from "vitest";
import { deriveNativeAccount } from "../../src/accounts/wallet";
import { directSignerFromPrivateKey } from "../../src/tx/signer-adapter";

// The canonical PUBLIC dev mnemonic (also used in the Task 13 wallet tests).
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

// Known value cross-checked against deriveNativeAccount (Task 13).
const EXPECTED_ADDRESS = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";

describe("directSignerFromPrivateKey", () => {
  it("adapts a native secp256k1 private key to a signer with the expected qor1 address", async () => {
    const account = await deriveNativeAccount(TEST_MNEMONIC);
    const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
    const accounts = await signer.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].address).toBe(EXPECTED_ADDRESS);
  });

  it("matches deriveNativeAccount's address", async () => {
    const account = await deriveNativeAccount(TEST_MNEMONIC);
    const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
    const accounts = await signer.getAccounts();
    expect(accounts[0].address).toBe(account.address);
  });

  it("uses the supplied bech32 prefix", async () => {
    const account = await deriveNativeAccount(TEST_MNEMONIC);
    const signer = await directSignerFromPrivateKey(account.privateKey, "cosmos");
    const accounts = await signer.getAccounts();
    expect(accounts[0].address.startsWith("cosmos1")).toBe(true);
  });
});
