---
id: rollups
title: Rollups (RDK)
sidebar_position: 9
---

# Rollups (RDK)

QoreChain's **rdk** (Rollup Development Kit) module lets an app run app-specific
rollups that settle to the main chain. The lifecycle is
**create → batch → withdraw**:

1. **Create** a rollup (profile + VM + stake).
2. **Submit batches** — the sequencer posts settlement batches (state root, data
   hash, and an optional `withdrawalsRoot` committing L2→L1 messages).
3. **Challenge / resolve** — the fraud-proof game for optimistic batches.
4. **Withdraw** — anyone proves a withdrawal leaf against a finalized batch's
   `withdrawalsRoot`, and the recipient is paid from the rollup escrow.

`@qorechain/sdk` exposes a high-level `createRollupClient` helper with
strongly-typed option objects so you never hand-build a protobuf `Any`.

## Creating the client

`createRollupClient` binds to a connected `TxClient` (writes) and, optionally, a
typed query client and the `qor_` JSON-RPC client (reads):

```ts
import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createRollupClient,
} from "@qorechain/sdk";

const client = createClient({
  network: "testnet",
  endpoints: {
    rpc: "https://rpc-testnet.qore.host",
    rest: "https://api-testnet.qore.host",
    evmRpc: "https://evm-testnet.qore.host", // for the qor_* reads
  },
});

const tx = await client.connectTx(signer);

const comet = await connectComet("https://rpc-testnet.qore.host");
const queries = connectQueryClients(comet);

const rollup = createRollupClient(tx, {
  query: queries.rdk,   // typed reads (getRollup, getBatch, …)
  qor: client.qor,      // qor_ conveniences (getRollupStatus, …)
});
```

The helper signs as `tx.senderAddress` (creator / sequencer / challenger /
resolver / submitter, depending on the message).

## Create a rollup

```ts
await rollup.createRollup({
  rollupId: "my-app-rollup",
  profile: "default",       // e.g. "default", "high-throughput"
  vmType: "evm",            // "evm" | "wasm" | "svm" | …
  stakeAmount: 1_000_000,   // base units
});
```

## Submit a batch

The sequencer posts a settlement batch. Set `withdrawalsRoot` to the binary
Merkle root of the batch's L2→L1 messages so `executeWithdrawal` proofs can be
verified later:

```ts
await rollup.submitBatch({
  rollupId: "my-app-rollup",
  batchIndex: 0,
  stateRoot: newStateRoot,        // Uint8Array
  prevStateRoot: prevStateRoot,   // Uint8Array
  txCount: 128,
  dataHash: dataHash,             // Uint8Array, for data availability
  withdrawalsRoot: withdrawalsRoot, // Uint8Array (empty if no withdrawals)
});
```

## The challenge game

```ts
await rollup.challengeBatch({ rollupId, batchIndex: 0, proof: fraudProof });

// fraudUpheld true → batch rejected, challenger rewarded.
// fraudUpheld false → challenge dismissed, challenger bond forfeited.
await rollup.resolveChallenge({ rollupId, batchIndex: 0, fraudUpheld: true });
```

## Lifecycle controls

```ts
await rollup.pause({ rollupId, reason: "maintenance" });
await rollup.resume({ rollupId });
await rollup.stop({ rollupId });
```

## Execute a withdrawal

Finalize an L2→L1 withdrawal by proving its leaf against a finalized batch's
`withdrawalsRoot`. This is **permissionless** — anyone may submit a valid proof,
and the funds always go to the committed recipient. Replay-protected per
`(rollupId, batchIndex, withdrawalIndex)`:

```ts
await rollup.executeWithdrawal({
  rollupId: "my-app-rollup",
  batchIndex: 0,
  withdrawalIndex: 0,
  recipient: "qor1...",
  denom: "uqor",
  amount: 500_000,
  proof: [sibling0, sibling1], // binary-Merkle sibling hashes, leaf → root
});
```

## Reads

```ts
// Typed reads (need a query client):
const cfg = await rollup.getRollup("my-app-rollup");
const all = await rollup.listRollups();
const batch = await rollup.getBatch("my-app-rollup", 0);
const latest = await rollup.getLatestBatch("my-app-rollup");
const params = await rollup.getParams();

// qor_ conveniences (need a qor client):
const status = await rollup.getRollupStatus("my-app-rollup");
const profile = await rollup.suggestRollupProfile("payments");
const blob = await rollup.getDaBlobStatus("my-app-rollup", 0);
```

## Build-without-broadcast

`createRollupMsg`, `submitBatchMsg`, and `executeWithdrawalMsg` return the
`EncodeObject` without broadcasting, so you can batch several into one tx.

## SDK vs. RDK

This SDK is the **app-developer interaction** surface: it submits and reads
rollup transactions. The separate **Rollup Development Kit** is for *operating* a
rollup node — running the sequencer, prover, and data-availability layer. They
are complementary: build your app against this SDK; run the rollup with the RDK.

## See also

- The runnable [`rollup-lifecycle`](https://github.com/qorechain/qorechain-sdk/tree/main/examples/rollup-lifecycle)
  example.
- The [`rollup-app`](https://github.com/qorechain/qorechain-sdk/tree/main/templates/rollup-app)
  starter template (scaffold with `create-qorechain-dapp --template rollup-app`).
- The [Sidechains & Paychains](./multilayer) guide for the multilayer module.
