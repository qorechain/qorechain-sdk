---
id: events
title: Events & subscriptions
sidebar_position: 6
---

# Events & subscriptions

The SDK exposes real-time subscriptions for each runtime over the respective
websocket endpoints. Every subscribe helper returns an unsubscribe function.

## Cosmos: new blocks & transactions

`createSubscriptionClient(rpcUrl)` connects a websocket-capable consensus RPC
client (an `http(s)://` URL is accepted and upgraded internally). Then subscribe
to new blocks or filtered transactions:

```ts
import {
  createSubscriptionClient,
  subscribeNewBlocks,
  subscribeTx,
  buildTxQuery,
} from "@qorechain/sdk";

const sub = await createSubscriptionClient("https://rpc-testnet.qore.host");

const stopBlocks = subscribeNewBlocks(sub, (block) => {
  console.log("new block", block);
});

// Filter transactions by event attributes.
const query = buildTxQuery({ "message.sender": "qor1..." });
const stopTxs = subscribeTx(
  sub,
  (tx) => console.log("tx", tx.height),
  (err) => console.error(err),
  query,
);

// Later:
stopBlocks();
stopTxs();
sub.disconnect?.();
```

## EVM: blocks, events, pending txs

`@qorechain/evm` provides viem-backed watchers over a websocket transport.

```ts
import {
  createEvmSubscriptionClient,
  watchBlocks,
  watchEvent,
  watchContractEvent,
  watchPendingTransactions,
} from "@qorechain/evm";

const ws = await createEvmSubscriptionClient({ endpoints: { evmWs: "wss://evm-ws-testnet.qore.host" } });

const unwatch = watchBlocks(ws, (block) => console.log(block.number));
// watchContractEvent(ws, { address, abi, eventName, onLogs });
// watchPendingTransactions(ws, (hashes) => ...);

unwatch();
```

## SVM: logs, accounts, slots

`@qorechain/svm` wraps the Solana-compatible subscription methods.

```ts
import { onLogs, onAccountChange, onSlotChange } from "@qorechain/svm";

const sub = onLogs(connection, "all", (logs) => console.log(logs), "confirmed");
// onAccountChange(connection, pubkey, cb);
// onSlotChange(connection, cb);

await sub.off();
```

## Waiting for inclusion

To wait for a broadcast transaction to land (rather than streaming all txs), use
the tracking helpers:

```ts
import { waitForTx, broadcastAndWait, withRetry } from "@qorechain/sdk";

const included = await waitForTx(getTxFn, hash, { timeoutMs: 30_000 });
```
