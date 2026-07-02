/**
 * pqc-hybrid-sign — post-quantum signing with ML-DSA-87 (Dilithium-5).
 *
 * Part 1 (runs fully offline, no node needed):
 *  - generatePqcKeypair() → an ML-DSA-87 keypair
 *  - pqcSign() / pqcVerify() → sign a message and verify it (and a tamper check)
 *
 * Part 2 (also offline — builds, does NOT broadcast):
 *  - buildHybridTx() assembles a transaction carrying BOTH a classical
 *    secp256k1 signature AND the ML-DSA-87 signature attached as a
 *    PQCHybridSignature extension.
 *
 * On-chain prerequisite for hybrid txs: the signer's PQC public key must be
 * registered via the chain's MsgRegisterPQCKeyV2 before a hybrid tx will
 * PQC-verify — UNLESS you set `includePqcPublicKey: true`, which embeds the key
 * in the extension for auto-registration on first use. This example just builds
 * the signed bytes locally; broadcasting them needs a reachable node and a
 * funded, sequence-correct account.
 */

import {
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  buildHybridTx,
  deriveNativeAccount,
  directSignerFromPrivateKey,
  toBase,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
} from "@qorechain/sdk";
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function localSignVerify(): Promise<void> {
  console.log("== Part 1: local ML-DSA-87 sign / verify ==");

  const keypair = generatePqcKeypair();
  console.log(`public key:  ${keypair.publicKey.length} bytes (expected ${ML_DSA_87_PUBLIC_KEY_LENGTH})`);

  const message = new TextEncoder().encode("QoreChain is quantum-safe");
  const signature = pqcSign(keypair.secretKey, message);
  console.log(`signature:   ${signature.length} bytes (expected ${ML_DSA_87_SIGNATURE_LENGTH})`);

  const valid = pqcVerify(keypair.publicKey, message, signature);
  console.log(`verify:      ${valid ? "OK" : "FAILED"}`);

  // Negative control: a tampered message must NOT verify.
  const tampered = new TextEncoder().encode("QoreChain is quantum-safe!");
  const tamperedValid = pqcVerify(keypair.publicKey, tampered, signature);
  console.log(`tamper check: ${tamperedValid ? "UNEXPECTEDLY VALID" : "correctly rejected"}`);

  if (!valid || tamperedValid) {
    throw new Error("PQC sign/verify self-check failed");
  }
}

async function buildHybrid(): Promise<void> {
  console.log("\n== Part 2: build a hybrid (classical + PQC) transaction ==");

  // Classical identity: a native secp256k1 account from a mnemonic.
  const account = await deriveNativeAccount(TEST_MNEMONIC);
  const signer = await directSignerFromPrivateKey(account.privateKey, "qor");

  // The post-quantum half.
  const pqcKeypair = generatePqcKeypair();

  // The registry must encode the messages canonically — use cosmjs defaults.
  const registry = new Registry(defaultRegistryTypes);

  const built = await buildHybridTx({
    registry,
    signer,
    pqcKeypair,
    messages: [
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: account.address,
          toAddress: account.address,
          amount: [{ denom: "uqor", amount: toBase("0.1") }],
        },
      },
    ],
    fee: { amount: [{ denom: "uqor", amount: "5000" }], gas: "200000" },
    chainId: "qorechain-diana",
    // Offline demo values: a live build would read these from the chain.
    accountNumber: 0,
    sequence: 0,
    // Embed the PQC public key so the chain can auto-register on first use.
    includePqcPublicKey: true,
  });

  console.log(`sender:            ${account.address}`);
  console.log(`pqc signature:     ${built.pqcSignature.length} bytes`);
  console.log(`pqc signed message: ${built.pqcSignedMessage.length} bytes (framed body+authInfo)`);
  console.log(`txRaw bytes:       ${built.txRawBytes.length} bytes (ready to broadcast)`);

  // The PQC signature is computed over the framed (body-without-extension +
  // authInfo) message — verify it locally against the embedded key.
  const pqcOk = pqcVerify(
    pqcKeypair.publicKey,
    built.pqcSignedMessage,
    built.pqcSignature,
  );
  console.log(`pqc half verifies: ${pqcOk ? "OK" : "FAILED"}`);
  if (!pqcOk) {
    throw new Error("hybrid tx PQC half failed to verify");
  }

  console.log(
    "\nNote: broadcasting this requires a reachable node and a funded, sequence-correct account.",
  );
}

async function main(): Promise<void> {
  await localSignVerify();
  await buildHybrid();
  console.log("\nSUCCESS: all PQC checks passed.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
