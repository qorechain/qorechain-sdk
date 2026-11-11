---
id: cross-vm
title: Cross-VM guide
sidebar_position: 4
---

# Cross-VM guide

QoreChain runs **EVM, SVM, and CosmWasm side by side**, and the `x/crossvm`
module lets a single native account invoke a contract on any of them. The SDK
provides a high-level `createCrossVMClient` helper to build, sign, and broadcast
these calls - including packing several into **one atomic transaction across all
three VMs** - plus typed read helpers to track message state. EVM→native routing
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

// Call an EVM contract from a native account - the payload is ABI-encoded.
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

`buildCall` returns the `EncodeObject` without broadcasting - handy for
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

### Async calls into CosmWasm (chain v3.2.8)

`async: true` queues the call for a later `ProcessQueue` dispatch. For an async
call into **CosmWasm** two fields bound what it may cost:

- `asyncGasLimit`: the contract execution the call may use, in base gas units.
  0 or unset means 500,000; a set value is 250,000 to 10,000,000.
- `asyncMaxFactor`: the highest wasm congestion factor the sender will pay, in
  millionths (1,000,000 = 1x). 0 or unset means four times the factor at
  submission.

```ts
await xvm.call({
  targetVm: "cosmwasm",
  targetContract: "qor1c...",
  cosmwasm: { ping: {} },
  async: true,
  asyncGasLimit: 400_000,
  asyncMaxFactor: 2_000_000,
});
```

Both are refused on a synchronous call and on any other target VM, and the
range is checked before anything is signed. The call holds an escrow of
`asyncGasLimit x factor x gas price` (about 0.2 QOR with the defaults),
refunded for what it did not use when it finishes, pays a queue-slot fee, and a
sender may have at most 100 calls pending.

### Gas: use simulation

The first call of a contract code in a block costs much more than a repeat (a
cw20 transfer about 533k gas, repeats about 84k). Keep `fee: "auto"` (the
default; the estimate gets at least a 1.3x margin for a transaction with a
cross-VM call) or pass an explicit gas limit. `estimateFee` refuses its fixed
fallback gas for such a transaction when you pass the `messages`.

## Atomic triple-VM transactions

`callAtomic` packs multiple `MsgCrossVMCall` messages into **one transaction
body** so they execute atomically under a single signature - the triple-VM
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
  endpoints: { rest: "https://api-testnet.qore.host" },
});

// A single message by id.
const msg = await getCrossVmMessage(client.rest, messageId);

// All pending messages: follows pagination.next_key page by page (at most
// 100 per page), with a safety cap of 100 pages (`{ maxPages }`).
const pending = await getPendingCrossVmMessages(client.rest);
// One page: getPendingCrossVmMessagesPage(client.rest, { key, limit }).

// Module parameters.
const params = await getCrossVmParams(client.rest);
```

These return typed shapes: `CrossVmMessage`, `CrossVmMessageResponse`,
`PendingCrossVmMessagesResponse`, and `CrossVmParamsResponse`.

`payload_hex` in the pending list is cut to its first 1,024 bytes; read one
message with `getCrossVmMessage` for its full payload. The typed query client
has the same walk as `queries.crossvm.allPendingMessages()`.

## Governance: crossvm parameters

`MsgUpdateParams` replaces every crossvm parameter at once, so a field left out
becomes 0 (and an empty `bridgeTargetPins` wipes the pins). From chain v3.2.8
`msg.crossvm.updateParams` requires all 18 fields. Build a proposal from the
values in force and change only what you mean to:

```ts
import { crossvmUpdateParamsFromCurrent } from "@qorechain/sdk";

const update = await crossvmUpdateParamsFromCurrent({
  rest: "https://api-testnet.qore.host",
  authority: govModuleAddress,
  changes: { maxQueueSize: 2000 },
});
```

The params route lists the values in force (defaults filled in for a stored
zero), so copying them keeps the current behaviour. `rdkUpdateParamsFromCurrent`
does the same for the rdk module, and `svmUpdateParamsFromCurrent` for svm
(`/qorechain/svm/v1/params`, served from chain v3.2.8, where `enabled` is
reported as in force); it refuses `enabled: true` without a
`maxCustodyHardUqor`.

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
