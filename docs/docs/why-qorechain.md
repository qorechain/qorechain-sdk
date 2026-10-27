---
id: why-qorechain
title: Why QoreChain SDK
sidebar_position: 2
---

# Why QoreChain SDK

The QoreChain SDK gives you everything a modern multi-chain SDK does - typed
messages for every module, typed queries, accounts for three VMs from one
mnemonic, auto-gas, error decoding, subscriptions, wallets, and a React kit.

It also wraps three protocol features of the QoreChain network: AI risk-scoring
precompiles on the EVM, three co-resident VMs with a native cross-VM bridge, and
hybrid post-quantum (ML-DSA-87) signing on the native lane. This page shows what
each one does and how the SDK exposes it.

---

## 1. AI pre-flight risk scoring

**Scan a transaction with on-chain AI before you broadcast it.**

QoreChain ships AI risk analysis as EVM precompiles. The SDK calls them for you
and returns gas plus a risk/anomaly verdict in a single call - so a wallet or
dApp can warn (or block) *before* signing.

```ts
import { createClient } from "@qorechain/sdk";
import { simulateWithRiskScore } from "@qorechain/evm";

const client = createClient({ network: "mainnet", endpoints: { evmRpc } });

const preflight = await simulateWithRiskScore(client.evm, {
  from: account.address,
  to: contractAddress,
  data: calldata,
  value: 0n,
});

console.log(preflight.gas);            // estimated gas
console.log(preflight.risk.level);     // on-chain risk level
console.log(preflight.anomaly.flagged);// anomalous pattern?
if (!preflight.safe) {
  // advisory verdict - set your own policy
  console.warn("Transaction flagged by on-chain AI risk scoring");
}
```

**How it works:** the scoring is served by two read-only EVM precompiles
(`aiRiskScore` at `0x…0B01`, `aiAnomalyCheck` at `0x…0B02`), queried with a
plain `eth_call` before anything is signed. The `safe` verdict is advisory: your
application decides what to do with it. See [AI pre-flight](./guides/ai-preflight.md).

---

## 2. Unified cross-VM calls - one account, three VMs, one transaction

**Call a contract on any VM, and batch calls across all three atomically.**

QoreChain runs CosmWasm, EVM, and SVM contracts on the same chain with a native
cross-VM bridge. The SDK exposes one interface to call any of them - and to pack
several cross-VM calls into a single, atomic transaction signed once.

```ts
import { createCrossVMClient } from "@qorechain/sdk";

const crossVM = createCrossVMClient(tx, { query: client.query });

// Call an EVM contract from a native account (payload ABI-encoded for you).
await crossVM.call({
  targetVm: "evm",
  targetContract: "0xToken…",
  evm: { abi, functionName: "transfer", args: [recipient, amount] },
});

// One signature, three VMs, atomic: EVM → SVM → CosmWasm.
await crossVM.callAtomic([
  { targetVm: "evm", targetContract: "0x…", evm: { abi, functionName: "approve", args } },
  { targetVm: "svm", targetContract: "Prog…", svm: { data } },
  { targetVm: "cosmwasm", targetContract: "qor1…", cosmwasm: { swap: { … } } },
]);
```

**How it works:** the three VMs share one chain and a native bridge module
(`crossvm` + the `CrossVMBridge` precompile). The SDK encodes each call's payload
for its target VM and packs several calls into one transaction, signed once. See
[Cross-VM calls](./guides/cross-vm.md).

---

## 3. Post-quantum hybrid signing

**Register an ML-DSA-87 key and sign hybrid in one call.**

On the native (Cosmos SDK) lane the chain requires a hybrid signature by
default: classical secp256k1 plus ML-DSA-87 (FIPS 204). On the EVM lane, a
transaction is admitted only from a PQC-registered account inside a bounded
authorisation window opened from the native lane. The SVM lane is not open yet.
The SDK makes adopting hybrid signing one call: check, register, and switch to
hybrid signing, with a React badge that shows whether the account has a
registered key.

```ts
import { ensurePqcRegistered, migrateToHybrid } from "@qorechain/sdk";

// Idempotent: registers the signer's ML-DSA-87 key on-chain if not already.
const rest = "https://api.qore.host";
const { alreadyRegistered, txHash } = await ensurePqcRegistered(tx, { pqcKeypair, rest });

// Switch the signing path to hybrid (classical + post-quantum).
const hybrid = await migrateToHybrid(tx, { pqcKeypair, rest });
await hybrid.send(messages);
```

```tsx
import { PqcStatusBadge } from "@qorechain/react";

// Shows "PQC key registered" when the address has a registered ML-DSA-87 key.
<PqcStatusBadge address={account.address} />
```

**How it works:** `ensurePqcRegistered` reads the account's key status first and
registers the key only when none is there, so it is safe to call on every start;
`migrateToHybrid` returns a send path that signs every native transaction with
both keys. See [Post-quantum hybrid signing](./guides/quantum-safe.md).

---

## Everything else, too

Beyond these three features, the SDK covers the full chain surface across
**TypeScript, Python, Go, Rust, and Java**: typed composers for every module
(including sidechains/paychains via `multilayer` and rollups via `rdk`), typed
queries, the tx lifecycle, subscriptions, browser wallets, and the
[`@qorechain/react`](./guides/react.md) hooks kit.

It also ships a **unified eth-native wallet**: one key is one identity rendered
as `qor1…`, `0x…`, and an SVM address that all share a single balance - so a
wallet is never "funded on one lane but not another," and the same key signs on
every lane. See [Unified wallet](./guides/unified-wallet.md).

Ready to build? Start with the [Quickstart](./quickstart.md).
