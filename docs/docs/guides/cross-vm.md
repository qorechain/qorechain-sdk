---
id: cross-vm
title: Cross-VM guide
sidebar_position: 4
---

# Cross-VM guide

QoreChain's `x/crossvm` module lets contracts on one VM trigger actions on
another. The SDK provides typed read helpers to track cross-VM message state,
and the EVM→native routing itself runs on-chain via the **cross-VM bridge
precompile** in `@qorechain/evm`.

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
