/**
 * authenticator-spend - link a Phantom (ed25519) key and build a relayer-
 * submitted MsgExecuteCosmos on the Native authenticator lane (v3.1.85).
 *
 * The authenticator model: a linked external key (here a Phantom ed25519 key)
 * spends from the ONE canonical PQC-required account WITHOUT ever producing an
 * ML-DSA co-signature. A relayer submits the tx and pays fees (its own hybrid
 * signature satisfies the ante on the envelope); the authenticator's signature
 * over the domain-separated, replay-bound sign-bytes IS the authorization.
 *
 * Step 1 (chain v3.2.8): link the key. The owner sends ONE transaction with
 * [MsgUpdateSpendingRules, MsgRegisterAuthenticator]: the key proves possession
 * by signing the authenticator link message, and a key with the "send"
 * permission needs a spending rule on the account that bounds every denom.
 *
 * Step 2: spend. The Phantom key signs the auth digest and a relayer submits
 * MsgExecuteCosmos. From v3.2.8 a failed execution returns success=false in a
 * code-0 tx and consumes the nonce, so the relayer reads the result with
 * assertAuthenticatorExecutionsSucceeded.
 *
 * This is a DRY RUN: it derives a random ed25519 keypair to stand in for
 * Phantom, builds the messages, and prints them. It does NOT broadcast.
 */

import {
  authenticatorLinkMessage,
  buildPhantomExecuteCosmos,
  cosmosAuthSignBytes,
  linkAuthenticatorMsgs,
  qorechainRegistry,
  signAuthenticatorLinkPhantom,
  type AuthenticatorWallet,
} from "@qorechain/sdk";
import { ed25519 } from "@noble/curves/ed25519";
import { randomBytes } from "@noble/hashes/utils";

const CHAIN_ID = process.env.QORE_CHAIN_ID ?? "qorechain-diana";
// The canonical PQC-required account the Phantom key is linked to (the owner).
const ACCOUNT = process.env.QORE_ACCOUNT ?? "qor1account000000000000000000000000000000";
// The relayer that submits + pays fees (a DIFFERENT account than the owner).
const RELAYER = process.env.QORE_RELAYER ?? "qor1relayer000000000000000000000000000000";
const RECIPIENT = process.env.QORE_RECIPIENT ?? "qor1recipient0000000000000000000000000000";
const AMOUNT = process.env.QORE_AMOUNT ?? "100uqor";

/**
 * A local ed25519 keypair standing in for a Phantom wallet. In a browser this
 * is `window.solana`; the builder only needs `publicKey` + `signMessage`.
 */
function makeLocalPhantom(): AuthenticatorWallet {
  const secretKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    publicKey,
    async signMessage(message: Uint8Array) {
      // Phantom returns { signature }; the chain does ed25519.Verify(pub, digest, sig).
      return { signature: ed25519.sign(message, secretKey) };
    },
  };
}

async function main(): Promise<void> {
  const wallet = makeLocalPhantom();
  const pubkey =
    wallet.publicKey instanceof Uint8Array
      ? wallet.publicKey
      : wallet.publicKey.toBytes();

  // ---- Step 1: link the key (owner-signed, chain v3.2.8) ----
  console.log("Link message the wallet signs (possession proof):");
  console.log(authenticatorLinkMessage(CHAIN_ID, ACCOUNT, "ed25519", pubkey).replace(/^/gm, "  | "));
  const proof = await signAuthenticatorLinkPhantom({ chainId: CHAIN_ID, account: ACCOUNT, wallet });
  const linkMsgs = linkAuthenticatorMsgs({
    owner: ACCOUNT,
    chainId: CHAIN_ID, // verifies the proof before building
    ...proof,
    permissions: ["send"],
    expiryUnix: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    label: "phantom",
    // MsgUpdateSpendingRules REPLACES the account's rules: pass every rule to keep.
    spendingRule: { id: "phantom", enabled: true, perTxLimit: "1000000", dailyLimit: "5000000" },
  });
  console.log(`\nLink transaction (one tx, owner-signed): ${linkMsgs.map((m) => m.typeUrl).join(" + ")}\n`);

  // ---- Step 2: spend through the relayer ----
  // The per-authenticator sequence for (account, pubkey). Query it from chain
  // (fetchAuthNonce) in production; here we start at 0.
  const nonce = Number(process.env.QORE_NONCE ?? "0");

  console.log("Authenticator lane: Native (MsgExecuteCosmos)");
  console.log(`  chain      ${CHAIN_ID}`);
  console.log(`  account    ${ACCOUNT} (canonical PQC-required owner)`);
  console.log(`  relayer    ${RELAYER} (submits + pays fees)`);
  console.log(`  to         ${RECIPIENT}`);
  console.log(`  amount     ${AMOUNT}`);
  console.log(`  nonce      ${nonce} (per-authenticator sequence)`);

  // Show the exact 32-byte digest the wallet signs (byte-exact vs the chain).
  const digest = cosmosAuthSignBytes({
    chainId: CHAIN_ID,
    account: ACCOUNT,
    pubkey,
    to: RECIPIENT,
    amount: AMOUNT,
    nonce,
  });
  const digestHex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  console.log(`\nauth sign-bytes (sha256, 32B): ${digestHex}`);

  // Build the relayer-ready message: the Phantom wallet signs the digest.
  const m = await buildPhantomExecuteCosmos({
    wallet,
    relayer: RELAYER,
    chainId: CHAIN_ID,
    account: ACCOUNT,
    to: RECIPIENT,
    amount: AMOUNT,
    nonce,
  });

  const v = m.value as {
    scheme: string;
    pubkey: Uint8Array;
    signature: Uint8Array;
    amount: { denom: string; amount: string }[];
  };
  console.log(`\nMsgExecuteCosmos:`);
  console.log(`  typeUrl    ${m.typeUrl}`);
  console.log(`  scheme     ${v.scheme}`);
  console.log(`  pubkey     ${v.pubkey.length}B ed25519`);
  console.log(`  signature  ${v.signature.length}B`);
  console.log(`  amount     ${JSON.stringify(v.amount)}`);

  // Prove it encodes via the default registry (what the relayer would broadcast).
  const registry = qorechainRegistry();
  const bytes = registry.encode(m);
  console.log(`\nencoded ${bytes.length} bytes (ready for the relayer to sign + broadcast).`);
  console.log(
    "\nDry run only - the owner broadcasts the link tx, then a live relayer (paying fees)",
  );
  console.log(
    "broadcasts the spend and checks it with assertAuthenticatorExecutionsSucceeded(result, [msg]).",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
