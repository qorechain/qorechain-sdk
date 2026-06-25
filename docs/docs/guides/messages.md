---
id: messages
title: Messages & transactions
sidebar_position: 0
---

# Messages & transactions

`@qorechain/sdk` ships typed composers for **every** transaction message the
chain supports — standard Cosmos modules (bank, staking, distribution, gov,
authz, feegrant, IBC) and QoreChain custom modules (AMM, bridge, RDK,
multilayer, PQC, SVM, lightnode, license, abstract-account, cross-VM, RL
consensus). A message registry resolves these for signing and decoding.

## The `msg` composers

Each composer returns a cosmjs `EncodeObject` (`{ typeUrl, value }`) ready to
sign and broadcast. Group access is `msg.<module>.<message>(value)`:

```ts
import { msg } from "@qorechain/sdk";

// AMM swap
const swap = msg.amm.swapExactIn({
  sender,
  poolId: "1",
  tokenIn: { denom: "uqor", amount: "1000000" },
  denomOut: "uusdc",
  minOut: "990000",
});

// Staking delegate
const delegate = msg.staking.delegate({
  delegatorAddress: sender,
  validatorAddress: "qorvaloper1...",
  amount: { denom: "uqor", amount: "5000000" },
});

// Governance vote
const vote = msg.gov.vote({ proposalId: 7n, voter: sender, option: 1 });

// PQC key registration
const reg = msg.pqc.registerPqcKey({ /* module-specific fields */ });
```

The composers use the generated `fromPartial`, so you only supply the fields you
care about. For the raw encode/decode types, import from `qorechainTypes`.

## Sending a transaction

`TxClient` simulates, signs, and broadcasts. Build one with `TxClient.connect`
(it seeds the registry with all QoreChain message types by default), then call
`signAndBroadcast` with one or more composed messages:

```ts
import { TxClient } from "@qorechain/sdk";

const tx = await TxClient.connect({
  rpcEndpoint: "https://rpc.testnet.example",
  signer, // an OfflineSigner (private-key adapter or a browser wallet)
});

const result = await tx.signAndBroadcast([swap], "auto");
console.log(result.transactionHash, result.code);
```

You can batch multiple messages in a single transaction by passing them in the
array. `"auto"` triggers gas simulation (see the
[Gas, fees & errors](./gas-fees-errors) guide); pass an explicit `StdFee` for
manual control. A non-zero delivery code throws a typed `QoreTxError`.

A `bankSend` convenience wraps the common token-transfer case:

```ts
await tx.bankSend("qor1...", [{ denom: "uqor", amount: "1000000" }]);
```

## The registry

`qorechainRegistry(extraTypes?)` returns a cosmjs `Registry` seeded with the
standard Cosmos types plus all QoreChain custom-module messages — this is what
`TxClient` uses by default. Use `qorechainRegistryTypes` if you need the raw
`[typeUrl, type]` pairs (e.g. to extend another client's registry).

## Hybrid (PQC) signing

QoreChain supports a hybrid classical + post-quantum signature on native
transactions. See the [Accounts & PQC](../concepts/accounts-pqc) concept page
and the `buildHybridTx` / `signAndBroadcastHybrid` helpers for the end-to-end
path.
