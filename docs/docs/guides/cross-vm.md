---
id: cross-vm
title: Cross-VM guide
sidebar_position: 4
---

# Cross-VM guide

QoreChain runs **EVM, SVM, and CosmWasm side by side**, and the `x/crossvm`
module lets a single native account invoke a contract on any of them. The SDK
provides a high-level `createCrossVMClient` helper to build, sign, and broadcast
these calls — including packing several into **one atomic transaction across all
three VMs** — plus typed read helpers to track message state. EVM→native routing
initiated *from inside the EVM* still runs on-chain via the **cross-VM bridge
precompile** in `@qorechain/evm`.

## Unified cross-VM calls

`createCrossVMClient` wraps `MsgCrossVMCall` (type URL
`/qorechain.crossvm.v1.MsgCrossVMCall`) so you never hand-build a `{ typeUrl,
value }` or encode a payload yourself. The client's sender is the connected
`TxClient`'s address; `sourceVm` defaults to `"evm"`.

```ts
import { createClient, createCrossVMClient } from "@qorechain/sdk";

const client = createClient({ network: "testnet", endpoints: { rpc, rest } });
const tx = await client.connectTx(signer);
const xvm = createCrossVMClient(tx);

// Call an EVM contract from a native account — the payload is ABI-encoded.
const { messageId, result } = await xvm.call({
  sourceVm: "cosmwasm",
  targetVm: "evm",
  targetContract: "0xToken",
  evm: { abi: erc20Abi, functionName: "transfer", args: ["0xRecipient", 1n] },
});
```

`VMType` is one of `"evm" | "cosmwasm" | "svm"` (also exported as the `VM_TYPES`
array).

### Per-VM payload encoding

Pick exactly **one** payload shape per call:

| Shape | Encoding |
|---|---|
| `{ payload: Uint8Array \| Hex }` | raw bytes, passed through unchanged |
| `{ evm: { abi, functionName, args } }` | ABI-encoded with viem's `encodeFunctionData` (selector + args) |
| `{ cosmwasm: object }` | `JSON.stringify` then UTF-8 bytes (the CosmWasm execute-msg convention) |
| `{ svm: { data: Uint8Array \| Hex } }` | raw bytes (an SVM instruction blob) |

The EVM path lazily imports `viem`, so the optional `viem` peer is only needed
when you actually use an `{ evm: ... }` payload.

### Build-only (offline)

`buildCall` returns the `EncodeObject` without broadcasting — handy for
inspection, batching by hand, or signing elsewhere. (EVM payloads are
ABI-encoded asynchronously, so for those use `call`/`callAtomic`, or pre-encode
and pass `{ payload }`.)

```ts
const msg = xvm.buildCall({
  targetVm: "svm",
  targetContract: "Prog...",
  svm: { data: new Uint8Array([1, 2, 3]) },
});
```

## Atomic triple-VM transactions

`callAtomic` packs multiple `MsgCrossVMCall` messages into **one transaction
body** so they execute atomically under a single signature — the triple-VM
headline. One signature, calls across EVM + SVM + CosmWasm that all land together
or not at all:

```ts
const { messageIds, result } = await xvm.callAtomic([
  {
    targetVm: "evm",
    targetContract: "0xToken",
    evm: { abi: erc20Abi, functionName: "transfer", args: ["0xRecipient", 2n] },
  },
  { targetVm: "svm", targetContract: "Prog...", svm: { data: instructionBytes } },
  { targetVm: "cosmwasm", targetContract: "qor1c...", cosmwasm: { ping: {} } },
]);
```

## Reading a message back

`getMessage` reads a cross-VM message by id, preferring the typed query client
and falling back to the `qor_getCrossVMMessage` JSON-RPC method:

```ts
import { connectQueryClients } from "@qorechain/sdk";
import { connectComet } from "@cosmjs/tendermint-rpc";

const comet = await connectComet(rpc);
const queries = connectQueryClients(comet);
const reader = createCrossVMClient(tx, { query: queries.crossvm });

const msg = await reader.getMessage(messageId);
```

## Reading cross-VM message state

`@qorechain/sdk` exports typed REST wrappers over `x/crossvm`:

```ts
import {
  createClient,
  getCrossVmMessage,
  getPendingCrossVmMessages,
  getCrossVmParams,
} from "@qorechain/sdk";

const client = createClient({
  endpoints: { rest: "https://rest.testnet.example" },
});

// A single message by id.
const msg = await getCrossVmMessage(client.rest, messageId);

// All pending messages.
const pending = await getPendingCrossVmMessages(client.rest);

// Module parameters.
const params = await getCrossVmParams(client.rest);
```

These return typed shapes: `CrossVmMessage`, `CrossVmMessageResponse`,
`PendingCrossVmMessagesResponse`, and `CrossVmParamsResponse`.

You can also read a message through the `qor_` JSON-RPC namespace:

```ts
const m = await client.qor.getCrossVMMessage(messageId);
```

## The EVM bridge precompile

EVM→native routing executes on-chain through the cross-VM bridge precompile,
exposed in `@qorechain/evm`:

```ts
import { PRECOMPILE_ADDRESSES } from "@qorechain/evm";

console.log(PRECOMPILE_ADDRESSES.crossVmBridge);
// 0x0000000000000000000000000000000000000901
```

Call the precompile from a Solidity contract (or via viem) at that address to
route a message to the native layer, then track its state with the read helpers
above. See the [EVM guide](evm.md) for the full precompile list.
