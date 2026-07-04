/**
 * unified-wallet — one identity, three lanes.
 *
 * A unified eth-native QoreChain account is ONE `eth_secp256k1` key rendered as
 * all THREE address encodings, sharing ONE on-chain balance:
 *
 *   - cosmos  qor1…      (bech32, the native lane)
 *   - evm     0x…        (EIP-55 hex, spendable on the EVM lane)
 *   - svm     <base58>   (the 32-byte SVM address = addr20 ‖ 12 zero bytes)
 *
 * The 20 address bytes ARE the Ethereum derivation `keccak256(pubkey)[12:]`, so
 * the key is EVM-native; the qor1/svm forms are just other encodings of those
 * same 20 bytes. The account also carries a deterministic ML-DSA-87 (Dilithium-5)
 * PQC keypair for the mainnet hybrid signature.
 *
 * This example runs fully offline — it derives and prints an account, then shows
 * decoding any one encoding back into all three. It does NOT broadcast anything.
 *
 * Legacy note: the classic coin-118 native derivation (`deriveNativeAccount`) is
 * still supported and unchanged; unified accounts are an additional, opt-in model.
 */

import {
  deriveUnifiedAccount,
  unifiedAccountFromSeed,
  qoreAddresses,
} from "@qorechain/sdk";

// A PUBLIC, well-known dev mnemonic — NEVER use a funded mnemonic in code.
const MNEMONIC =
  "test test test test test test test test test test test junk";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function main(): Promise<void> {
  // 1) Derive the unified account from a mnemonic (HD path m/44'/60'/0'/0/0).
  const account = await deriveUnifiedAccount(MNEMONIC, 0);

  console.log("One identity, three lanes:");
  console.log("  cosmos :", account.cosmos);
  console.log("  evm    :", account.evm);
  console.log("  svm    :", account.svm);
  console.log("  addr20 :", toHex(account.addressBytes));
  console.log();
  console.log("Keys:");
  console.log("  publicKey (33B compressed):", account.publicKey);
  console.log("  pqc.publicKey  bytes:", account.pqc.publicKey.length); // 2592
  console.log("  pqc.secretKey  bytes:", account.pqc.secretKey.length); // 4896
  // privateKey / pqc.secretKey are secret — do not print in real apps.

  // 2) Any ONE encoding decodes to all three (they are the same 20 bytes).
  const fromEvm = qoreAddresses({ evm: account.evm });
  console.log();
  console.log("Decode the EVM address back into all three:");
  console.log("  cosmos :", fromEvm.cosmos);
  console.log("  svm    :", fromEvm.svm);

  // 3) A seed-derived unified account (32 bytes used AS the secp256k1 key). This
  //    is how the Phantom P1a flow anchors an account to a signature.
  const seedAccount = unifiedAccountFromSeed(new Uint8Array(32).fill(1));
  console.log();
  console.log("Seed-derived account (0x01 × 32):");
  console.log("  cosmos :", seedAccount.cosmos);
  console.log("  evm    :", seedAccount.evm);
  console.log("  svm    :", seedAccount.svm);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
