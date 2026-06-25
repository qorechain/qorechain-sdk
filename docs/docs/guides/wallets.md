---
id: wallets
title: Wallets
sidebar_position: 5
---

# Wallets

The SDK connects to the major browser wallets across all three runtimes. Each
connector returns a signer that plugs directly into the relevant tx path.

## Cosmos wallets (Keplr / Leap)

`getCosmosWallet` connects an injected Cosmos wallet and returns an
`OfflineSigner` plus account info. The signer goes straight into
`TxClient.connect`.

```ts
import {
  getCosmosWallet,
  suggestChainInfo,
  getNetwork,
  TxClient,
} from "@qorechain/sdk";

const network = getNetwork("testnet");

// `suggestChainInfo(network)` builds the Keplr/Leap chain-info object you can
// pass to the wallet's own `experimentalSuggestChain` to register the chain.
const chainInfo = suggestChainInfo(network);

const { signer, accounts } = await getCosmosWallet({
  wallet: "keplr", // or "leap"; defaults to "keplr"
  network,
});

const tx = await TxClient.connect({
  rpcEndpoint: network.endpoints.rpc,
  signer,
});
```

DIRECT signing carries both standard and QoreChain custom messages, so the full
`msg` composer set works through the wallet.

## EVM wallets (MetaMask / EIP-1193)

`@qorechain/evm` discovers EIP-1193 / EIP-6963 providers and builds a viem wallet
client. It can also add the QoreChain network to the wallet and switch chains.

```ts
import {
  discoverEvmProviders,
  getEvmWalletClient,
  addQoreChainNetwork,
  switchChain,
} from "@qorechain/evm";

const providers = discoverEvmProviders(); // EIP-6963 detail list
const { walletClient, address, provider, chain } = await getEvmWalletClient();

// Make sure the wallet is on the QoreChain EVM network.
await addQoreChainNetwork(provider, networkInfo);
await switchChain(provider, chain.id);
```

The returned `walletClient` is the write client used by the ERC-20/721/1155 and
contract helpers.

## SVM wallets (Phantom / Wallet-Standard)

`@qorechain/svm` connects a Wallet-Standard / Phantom provider and returns a
signer for transactions.

```ts
import { detectSvmProvider, getSvmWallet } from "@qorechain/svm";

const provider = detectSvmProvider();
const { publicKey, signTransaction, signAllTransactions } = await getSvmWallet();
```

Use the returned signer with the SOL transfer and program-invoke builders from
the [SVM guide](./svm).
