---
"@qorechain/sdk": major
---

Broadcast results are now JSON-serializable: `gasUsed` and `gasWanted` on `BroadcastResult` (from `TxClient.signAndBroadcast`, `signAndBroadcastHybrid`, `EthNativeSigner.signAndBroadcast`, and the helpers that return it, e.g. `ensurePqcRegistered`) and on `IncludedTx` (from `waitForTx` and `broadcastAndWait`) are plain `number`s instead of `bigint`s. Gas is bounded by the chain's max gas, far below `Number.MAX_SAFE_INTEGER`, so nothing is lost, and `JSON.stringify` on a broadcast result no longer throws `Do not know how to serialize a BigInt`.
