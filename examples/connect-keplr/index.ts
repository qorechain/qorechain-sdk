/**
 * connect-keplr — connect a Keplr/Leap browser wallet and send a QOR transfer.
 *
 * Shows:
 *  - suggestChainInfo(network) → a Keplr/Leap chain-info object to register the chain
 *  - getCosmosWallet({ wallet, network }) → an OfflineSigner + accounts
 *  - client.connectTx(signer) → a TxClient that signs through the wallet (DIRECT)
 *  - tx.bankSend(recipient, amount) → broadcast a transfer
 *
 * This is a BROWSER example: injected wallets live on `window`. Bundle it into a
 * web app (e.g. with Vite) and call `run()` from a button handler. Running under
 * Node prints guidance and exits cleanly (no `window`), so it still type-checks
 * and runs as part of the workspace.
 */

import {
  getCosmosWallet,
  suggestChainInfo,
  getNetwork,
  TxClient,
} from "@qorechain/sdk";

export async function run(): Promise<void> {
  const network = getNetwork("testnet");

  // Build the chain-info object; register it with the wallet so it knows the chain.
  const chainInfo = suggestChainInfo(network);
  const injected = (window as unknown as {
    keplr?: { experimentalSuggestChain(info: unknown): Promise<void> };
  }).keplr;
  await injected?.experimentalSuggestChain(chainInfo);

  // Connect the wallet and resolve the signer + accounts.
  const { signer, accounts, wallet } = await getCosmosWallet({
    wallet: "keplr", // or "leap"
    network,
  });
  const sender = accounts[0].address;
  console.log(`connected ${wallet}: ${sender}`);

  // Sign + broadcast a transfer through the wallet. `TxClient.connect` accepts
  // the wallet's OfflineSigner (DIRECT signing, required for custom messages).
  const tx = await TxClient.connect({
    rpcEndpoint: network.endpoints.rpc,
    signer,
  });
  const amount = [{ denom: network.coin.base, amount: "1000000" }];
  const result = await tx.bankSend(sender, amount); // self-send demo
  console.log(`broadcast ok — ${result.transactionHash}`);
}

// Browser entrypoint guard: only run automatically when a wallet is present.
if (typeof window === "undefined") {
  console.log("connect-keplr is a browser example — bundle it into a web app.");
  console.log("It calls window.keplr / window.leap, which only exist in a browser.");
} else {
  void run();
}
