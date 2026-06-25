---
id: gas-fees-errors
title: Gas, fees & errors
sidebar_position: 7
---

# Gas, fees & errors

## Native (Cosmos) auto-gas

`TxClient.signAndBroadcast` accepts `"auto"` as the fee, which simulates the
transaction to estimate gas, then applies a gas price and multiplier:

```ts
const result = await tx.signAndBroadcast([message], "auto");
```

The defaults are `DEFAULT_GAS_MULTIPLIER` and `DEFAULT_GAS_PRICE`; override them
per-call via the `autoFee` option, or pass an explicit `StdFee`. The gas math is
also exposed directly:

```ts
import { GasPrice, calculateFee, estimateFee } from "@qorechain/sdk";

const gasPrice = GasPrice.fromString("0.025uqor");
const fee = calculateFee(200_000, gasPrice); // ceil(gas * price)
```

## EVM fees

`@qorechain/evm` wraps viem's fee estimation:

```ts
import { estimateEip1559Fees, gasPrice } from "@qorechain/evm";

const { maxFeePerGas, maxPriorityFeePerGas } = await estimateEip1559Fees(client.publicClient);
const legacy = await gasPrice(client.publicClient); // legacy single price
```

Pass the EIP-1559 pair into a viem write when you want explicit fee control.

## SVM compute budget & priority fees

`@qorechain/svm` adds compute-budget instructions and reads recent
prioritization fees:

```ts
import { withComputeBudget, estimatePriorityFee } from "@qorechain/svm";

const microLamports = await estimatePriorityFee(connection, writableAccounts);

// Prepend setComputeUnitLimit + setComputeUnitPrice instructions (mutates tx).
withComputeBudget(tx, { units: 200_000, microLamports });
```

`withComputeBudget` inserts the limit and price instructions at the front of the
transaction, as the runtime requires.

## Error decoding

Each package decodes its native error format into a structured, human-readable
shape.

### Native (Cosmos)

A non-zero ABCI delivery code throws a typed `QoreTxError`. You can also decode
results manually:

```ts
import { decodeTxError, isTxFailure, QoreTxError } from "@qorechain/sdk";

try {
  await tx.signAndBroadcast([message], "auto");
} catch (err) {
  if (err instanceof QoreTxError) {
    console.error(err.code, err.codespace, err.message);
  }
}

const decoded = decodeTxError({ code, codespace, rawLog });
```

### EVM

```ts
import { decodeEvmError } from "@qorechain/evm";

try {
  await writeContract(wallet, { /* ... */ });
} catch (err) {
  const decoded = decodeEvmError(err); // DecodedEvmError
  console.error(decoded);
}
```

### SVM

```ts
import { decodeSvmError } from "@qorechain/svm";

const decoded = decodeSvmError(err); // DecodedSvmError
```
