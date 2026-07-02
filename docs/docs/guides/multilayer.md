---
id: multilayer
title: Sidechains & Paychains (multilayer)
sidebar_position: 8
---

# Sidechains & Paychains (multilayer)

QoreChain's **multilayer** module lets an app run additional execution layers
alongside the main chain:

- **Sidechains** — general-purpose layers with their own block production and VM
  support, settling state back to the main chain on an interval.
- **Paychains** — payment-optimized layers tuned for high-throughput, low-fee
  transfers.

The lifecycle is **register → anchor → route**:

1. **Register** a sidechain or paychain (declare it on the main chain).
2. **Anchor** the layer's state root back to the main chain each settlement
   interval (done by the layer's relayer).
3. **Route** individual transactions to the best-fit layer.

`@qorechain/sdk` exposes a high-level `createMultilayerClient` helper so you can
do all of this with strongly-typed option objects — no hand-built protobuf
`Any` payloads.

## Creating the client

`createMultilayerClient` binds to a connected `TxClient` (for writes) and, for
the typed reads, a query client from `connectQueryClients`:

```ts
import { connectComet } from "@cosmjs/tendermint-rpc";
import {
  createClient,
  connectQueryClients,
  createMultilayerClient,
} from "@qorechain/sdk";

const client = createClient({
  network: "testnet",
  endpoints: { rpc: "https://rpc-testnet.qore.host", rest: "https://api-testnet.qore.host" },
});

const tx = await client.connectTx(signer); // an OfflineSigner

// Reads go over the consensus RPC's ABCI query path.
const comet = await connectComet("https://rpc-testnet.qore.host");
const queries = connectQueryClients(comet);

const multilayer = createMultilayerClient(tx, { query: queries.multilayer });
```

The helper signs as `tx.senderAddress`, so you never repeat your address. Pass
`{ query }` only if you need the read methods; writes work without it.

## Register a sidechain and a paychain

```ts
await multilayer.registerSidechain({
  layerId: "game-sidechain",
  description: "High-throughput game state sidechain",
  targetBlockTimeMs: 500,
  maxTransactionsPerBlock: 10_000,
  minValidators: 3,
  settlementIntervalBlocks: 100,
  supportedVmTypes: ["evm", "wasm"],
  supportedDomains: ["gaming"],
});

await multilayer.registerPaychain({
  layerId: "payments-paychain",
  description: "Low-fee payments paychain",
  maxTransactionsPerBlock: 50_000,
  settlementIntervalBlocks: 50,
  baseFeeMultiplier: "0.5",
});
```

Each write returns the broadcast result (`transactionHash`, `code`, …). Numeric
fields accept `number | bigint | string` — the helper coerces them to the
string form the chain expects for 64-bit integers.

## Anchor a state root

The layer's relayer commits the layer state root to the main chain each
settlement interval:

```ts
await multilayer.anchorState({
  layerId: "game-sidechain",
  layerHeight: 100,
  stateRoot: stateRootBytes,        // Uint8Array
  transactionCount: 4_321,
  // Optional: validatorSetHash, pqcAggregateSignature, compressedStateProof
});
```

## Route a transaction

Hand the router an opaque payload and let it pick the cheapest/fastest layer
within your constraints:

```ts
await multilayer.routeTransaction({
  transactionPayload: payloadBytes,  // Uint8Array
  preferredLayer: "game-sidechain",  // empty lets the router choose freely
  maxLatencyMs: 1_000,
  maxFee: "1000",
});
```

## Reads

With a query client attached, the typed reads return decoded responses:

```ts
const layer = await multilayer.getLayer("game-sidechain");
const all = await multilayer.listLayers();
const stats = await multilayer.routingStats(); // gas savings, latency, counts
const params = await multilayer.getParams();
```

## Build-without-broadcast

Every write has a matching `*Msg` method that returns the `EncodeObject` without
broadcasting, so you can batch several messages into one transaction yourself:

```ts
const m1 = multilayer.registerSidechainMsg({ layerId: "a", minValidators: 3 });
const m2 = multilayer.anchorStateMsg({ layerId: "a", layerHeight: 1, stateRoot });
await tx.signAndBroadcast([m1, m2], "auto");
```

## SDK vs. running a layer

This SDK is the **app-developer** surface: it submits and reads multilayer
transactions. **Operating** the off-chain layer node itself (block production,
the relayer that calls `anchorState`) is a separate concern handled outside the
SDK.

## See also

- The runnable [`register-sidechain`](https://github.com/qorechain/qorechain-sdk/tree/main/examples/register-sidechain)
  example.
- The [`rollup-app`](https://github.com/qorechain/qorechain-sdk/tree/main/templates/rollup-app)
  starter template (scaffold with `create-qorechain-dapp --template rollup-app`).
- The [Rollups (RDK)](./rollups) guide for app-specific rollups.
