---
id: gas-fees-errors
title: Gas, fees & errors
sidebar_position: 7
---

# Gas, fees & errors

## Native auto-gas

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

const gasPrice = GasPrice.fromString("0.15uqor");
const fee = calculateFee(200_000, gasPrice); // ceil(gas * price)
```

### Hybrid transactions from chain v3.2.5

A native-lane transaction signed hybrid (secp256k1 + ML-DSA-87) is estimated
by simulating the signed transaction itself. What happens next depends on the
network:

| Network | Gas limit for `"auto"` |
| --- | --- |
| Has applied `v3.2.5` (mainnet and testnet today) | `ceil(simulated × 1.02) + 2000` (`exactHybridGas`) |
| Below `v3.2.5` | `ceil((simulated + HYBRID_VERIFY_GAS) × DEFAULT_GAS_MULTIPLIER)` |

From v3.2.5 the simulation already charges the post-quantum verification (once
per signer), so nothing is added per signer. The SDK asks the network once per
endpoint whether it has applied `v3.2.5`; if it cannot ask, it keeps the older,
larger estimate. A `gasMultiplier` you pass replaces either rule. On the native
lane the fee is the gas limit times the gas price, so the tighter limit is a
lower fee: a hybrid bank send simulates at about 166,300 gas and now asks for
about 171,600 instead of about 289,000.

`estimateGasDetails` returns `{ simulated, gasWanted, exact }` when you want to
see which rule applied. The same rule is in the Python, Go, Rust and Java SDKs.

:::note Fee floor
Both networks enforce a genesis min-gas-price (BaseFee) of **`0.1uqor` per unit
of gas** - transactions priced below the floor are rejected. The SDK default
(`0.15uqor`) sits above the floor for headroom; do not lower a custom gas price
below `0.1uqor`.
:::

### Following the chain minimum (opt-in)

The chain may later move its minimum gas price inside a governance band. Two
opt-in helpers read the minimum the ante enforces (the feemarket
`params.min_gas_price` at `GET /cosmos/evm/feemarket/v1/params`, converted from
the 18-decimal EVM unit to uqor and parsed exactly):

```ts
import { fetchMinGasPriceUqor, recommendedGasPriceUqor } from "@qorechain/sdk";

await fetchMinGasPriceUqor({ rest });     // "0.1": max(min_gas_price / 1e12, 0.1)
const price = await recommendedGasPriceUqor({ rest }); // max(0.15, minimum x 1.5)
await tx.signAndBroadcast(msgs, "auto", "", { autoFee: { gasPrice: `${price}uqor` } });
```

Nothing calls them by default: `DEFAULT_GAS_PRICE` stays `0.15uqor` and no
default path makes this network call.

### Gas caps and CosmWasm / cross-VM gas (chain v3.2.8)

- A native-lane transaction may declare at most **50,000,000** gas; the SDK
  refuses a larger limit before signing (`COSMOS_TX_MAX_GAS`).
- An EVM transaction may ask for at most the chain's EVM cap (30,000,000 on
  v3.2.8). Read it with `fetchEvmLimits({ rest })`
  (`GET /qorechain/pqc/v1/evm_limits`); `checkEvmGasLimit` refuses a larger
  limit.
- **Use `"auto"` (simulation) for CosmWasm and cross-VM gas.** The first call
  of a contract code in a block costs much more than a repeat (a cw20 transfer
  about 533k gas, repeats about 84k). For a transaction carrying a CosmWasm
  execute / instantiate / migrate or a `MsgCrossVMCall`, `"auto"` multiplies the
  simulation by at least 1.3 whatever rule applies, and `estimateFee` refuses
  its fixed fallback gas (200,000) when you pass `messages` without a `gas`:
  give an explicit gas limit or simulate.

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

### Native

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
