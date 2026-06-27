---
id: why-qorechain
title: Why QoreChain SDK
sidebar_position: 2
---

# Why QoreChain SDK

The QoreChain SDK gives you everything a modern multi-chain SDK does — typed
messages for every module, typed queries, accounts for three VMs from one
mnemonic, auto-gas, error decoding, subscriptions, wallets, and a React kit.

But three capabilities are **only possible on QoreChain**, because they are built
on protocol features no other Layer 1 has: on-chain AI, three co-resident VMs
with a native bridge, and mandatory post-quantum cryptography. These are the
reasons to build here.

---

## 1. AI pre-flight risk scoring

**Scan a transaction with on-chain AI before you broadcast it.**

QoreChain ships AI risk analysis as EVM precompiles. The SDK calls them for you
and returns gas plus a risk/anomaly verdict in a single call — so a wallet or
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
  // advisory verdict — set your own policy
  console.warn("Transaction flagged by on-chain AI risk scoring");
}
```

**Why it's unique:** the scoring runs *inside the chain* as a deterministic
precompile (`aiRiskScore` at `0x…0B01`, `aiAnomalyCheck` at `0x…0B02`). Other
networks can only bolt on off-chain, non-deterministic AI services. This is the
first SDK that AI-screens a transaction before it is signed, with an on-chain
result. See [AI pre-flight](./guides/ai-preflight.md).

---

## 2. Unified cross-VM calls — one account, three VMs, one transaction

**Call a contract on any VM, and batch calls across all three atomically.**

QoreChain runs CosmWasm, EVM, and SVM contracts on the same chain with a native
cross-VM bridge. The SDK exposes one interface to call any of them — and to pack
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

**Why it's unique:** QoreChain is the only L1 with three co-resident VMs and a
native bridge module (`crossvm` + the `CrossVMBridge` precompile). Single-VM
chains cannot express "one account, three VMs, one atomic transaction" — their
SDKs have nothing to wrap. Write once, call any VM. See
[Cross-VM calls](./guides/cross-vm.md).

---

## 3. Quantum-safe by default

**Make a signer post-quantum protected in one call.**

QoreChain enforces hybrid post-quantum signatures (ML-DSA-87 + classical) at the
protocol level. The SDK makes adopting them a one-liner: check, register, and
migrate to hybrid signing — with a React badge to show users they're protected.

```ts
import { ensurePqcRegistered, migrateToHybrid } from "@qorechain/sdk";

// Idempotent: registers the signer's ML-DSA-87 key on-chain if not already.
const { alreadyRegistered, txHash } = await ensurePqcRegistered(tx, { pqcKeypair });

// Switch the signing path to hybrid (classical + post-quantum).
const hybrid = await migrateToHybrid(tx, { pqcKeypair });
await hybrid.send(messages);
```

```tsx
import { QuantumSafeBadge } from "@qorechain/react";

// Shows a "Quantum-safe" indicator when the address has a registered PQC key.
<QuantumSafeBadge address={account.address} />
```

**Why it's unique:** post-quantum cryptography is native and mandatory on
QoreChain, not an experiment. This is the first SDK where "quantum-safe by
default" is a single call plus a drop-in badge. See
[Quantum-safe](./guides/quantum-safe.md).

---

## Everything else, too

Beyond the three differentiators, the SDK covers the full chain surface across
**TypeScript, Python, Go, Rust, and Java**: typed composers for every module
(including sidechains/paychains via `multilayer` and rollups via `rdk`), typed
queries, the tx lifecycle, subscriptions, browser wallets, and the
[`@qorechain/react`](./guides/react.md) hooks kit.

Ready to build? Start with the [Quickstart](./quickstart.md).
