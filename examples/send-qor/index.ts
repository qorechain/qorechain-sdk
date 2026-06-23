/**
 * send-qor — derive a native account from a mnemonic and broadcast a QOR transfer.
 *
 * Shows:
 *  - deriveNativeAccount(mnemonic) → a secp256k1 account with a private key
 *  - directSignerFromPrivateKey(privateKey, prefix) → a cosmjs offline signer
 *  - client.connectTx(signer) → a TxClient bound to the consensus RPC
 *  - toBase("1.5") → the integer base amount ("1500000" uqor)
 *  - txClient.simulate() + client.fees.estimate() + txClient.bankSend()
 *
 * Requirements to actually send:
 *  - A reachable consensus RPC (QORE_RPC_URL) AND REST endpoint (QORE_REST_URL).
 *  - A FUNDED account: the address derived from QORE_MNEMONIC must hold QOR.
 *
 * The public BIP-39 test mnemonic is used by default — it is NOT funded on any
 * real network, so this will fail at broadcast unless you supply a funded
 * QORE_MNEMONIC and a reachable node.
 */

import {
  createClient,
  deriveNativeAccount,
  directSignerFromPrivateKey,
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

  const client = createClient({
    network: "testnet",
    endpoints: {
      rpc: process.env.QORE_RPC_URL ?? "http://localhost:26657",
      rest: process.env.QORE_REST_URL ?? "http://localhost:1317",
    },
  });

  const prefix = client.network.bech32.account; // "qor"
  const baseDenom = client.network.coin.base; // "uqor"

  // Derive the native account and build a direct (protobuf) offline signer.
  const account = await deriveNativeAccount(mnemonic);
  const signer = await directSignerFromPrivateKey(account.privateKey, prefix);

  console.log(`sender:    ${account.address}`);
  console.log(`recipient: ${recipient}`);

  const amount = [{ denom: baseDenom, amount: toBase(displayAmount) }];
  console.log(`amount:    ${displayAmount} ${client.network.coin.display} (${amount[0].amount} ${baseDenom})`);

  // Connect a TxClient (opens the RPC connection).
  const tx = await client.connectTx(signer);

  // Build the MsgSend, simulate it to size the gas, and ask the fee oracle.
  const messages = [
    {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: account.address,
        toAddress: recipient,
        amount,
      },
    },
  ];
  const gasEstimate = await tx.simulate(messages);
  console.log(`gas (simulated): ${gasEstimate}`);

  const fee = await client.fees.estimate("normal");
  console.log(`fee: ${fee.amount.map((c) => `${c.amount}${c.denom}`).join(",")} (gas ${fee.gas})`);

  const result = await tx.bankSend(recipient, amount, { fee });
  console.log(`broadcast ok — tx hash ${result.transactionHash} at height ${result.height ?? "?"}`);

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
