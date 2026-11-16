/**
 * send-qor - derive a native account from a mnemonic and broadcast a QOR transfer.
 *
 * QoreChain requires a hybrid signature (secp256k1 + ML-DSA-87) on every
 * transaction from an account with a registered PQC key, and an account without
 * one can only send the registration itself. So this example:
 *  - deriveNativeAccount(mnemonic) → the secp256k1 account
 *  - derivePqcCanonical(address, mnemonic) → the account's ML-DSA-87 key
 *  - ensurePqcRegistered(...) → registers that key once (skipped when it already is)
 *  - client.connectTx(signer, { pqcKeypair }) → a TxClient that signs hybrid
 *  - toBase("1.5") → the integer base amount ("1500000" uqor)
 *  - txClient.bankSend() with the default fee "auto" (simulated, hybrid included)
 *
 * Requirements to actually send:
 *  - A reachable consensus RPC (QORE_RPC_URL) AND REST endpoint (QORE_REST_URL).
 *  - A FUNDED account: the address derived from QORE_MNEMONIC must hold QOR.
 *
 * The public BIP-39 test mnemonic is used by default - it is NOT funded on any
 * real network, so this will fail unless you supply a funded QORE_MNEMONIC and a
 * reachable node.
 */

import {
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  ensurePqcRegistered,
  toBase,
} from "@qorechain/sdk";

// Public, well-known test mnemonic. Override with QORE_MNEMONIC (a funded one).
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

async function main(): Promise<void> {
  const mnemonic = process.env.QORE_MNEMONIC ?? TEST_MNEMONIC;
  const recipient =
    process.env.QORE_RECIPIENT ??
    "qor1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqscl8t9";
  const displayAmount = process.env.QORE_AMOUNT ?? "1.5";
  const rest = process.env.QORE_REST_URL ?? "http://localhost:1317";

  const client = createClient({
    network: "testnet",
    endpoints: {
      rpc: process.env.QORE_RPC_URL ?? "http://localhost:26657",
      rest,
    },
  });

  const prefix = client.network.bech32.account; // "qor"
  const baseDenom = client.network.coin.base; // "uqor"

  // Derive the native account, its ML-DSA-87 key, and a direct (protobuf) signer.
  const account = await deriveNativeAccount(mnemonic);
  const pqcKeypair = derivePqcCanonical(account.address, mnemonic);
  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);

  console.log(`sender:    ${account.address}`);
  console.log(`recipient: ${recipient}`);

  const amount = [{ denom: baseDenom, amount: toBase(displayAmount) }];
  console.log(`amount:    ${displayAmount} ${client.network.coin.display} (${amount[0].amount} ${baseDenom})`);

  // 1. Register the PQC key once. Registration is the one message the chain
  //    accepts signed classically; the helper reads the account first and does
  //    nothing when this key is already registered.
  const classical = await client.connectTx(signer);
  const reg = await ensurePqcRegistered(classical, { pqcKeypair, rest });
  console.log(
    reg.alreadyRegistered
      ? "PQC key:   already registered"
      : `PQC key:   registered now (tx ${reg.txHash ?? "?"})`,
  );
  classical.disconnect();

  // 2. Connect a TxClient that signs every transaction hybrid.
  const tx = await client.connectTx(signer, { pqcKeypair });

  // 3. Send. The default fee "auto" simulates the hybrid transaction and sizes
  //    gas and fee from it.
  const result = await tx.bankSend(recipient, amount);
  console.log(`broadcast ok - tx hash ${result.transactionHash} at height ${result.height ?? "?"}`);

  tx.disconnect();
}

main().catch((err: unknown) => {
  console.error("\nFailed to send QOR.");
  console.error(
    "Needs a reachable node (QORE_RPC_URL + QORE_REST_URL) and a FUNDED QORE_MNEMONIC.",
  );
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
