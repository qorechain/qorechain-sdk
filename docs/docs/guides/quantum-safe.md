---
id: quantum-safe
title: Quantum-safe by default
sidebar_position: 12
---

# Quantum-safe by default

QoreChain treats post-quantum cryptography as a **first-class** signature scheme.
An account registers an **ML-DSA-87 (Dilithium-5, NIST FIPS 204)** key on-chain,
after which its transactions can carry a **hybrid** signature — the usual
classical secp256k1 signature **plus** an ML-DSA-87 signature. The chain's ante
handler verifies both, so a quantum-safe account stays fully compatible with
classical verification while gaining protection against a future quantum
adversary.

The SDK packages this into a tiny, idempotent surface so a dApp becomes
**quantum-safe by default**: one call to be PQC-protected.

## Check status

`isPqcRegistered` / `getPqcStatus` read whether an address has a registered PQC
key via the `qor_getPQCKeyStatus` JSON-RPC method. They accept either a
`QorClient` or the composed client from `createClient`:

```ts
import { createClient, isPqcRegistered, getPqcStatus } from "@qorechain/sdk";

const client = createClient({ network: "mainnet", endpoints: { /* … */ } });

const safe = await isPqcRegistered(client, "qor1…");
const status = await getPqcStatus(client, "qor1…");
// status: { registered: boolean; algorithmId?: number; pubkey?: string | Uint8Array }
```

The same status is also readable on the EVM side via the
`pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes pubkey)`
precompile at `0x0000000000000000000000000000000000000A02` (exposed as
`pqcKeyStatus` in `@qorechain/evm`). The helpers above prefer the JSON-RPC method,
which needs no viem peer.

## Register in one call

`ensurePqcRegistered` makes an account quantum-safe. It is **idempotent**: pass a
status source and it skips the registration when the key is already registered,
so it is safe to call on every app start.

```ts
import { generatePqcKeypair, ensurePqcRegistered } from "@qorechain/sdk";

const tx = await client.connectTx(signer);
const pqcKeypair = generatePqcKeypair(); // or derive deterministically from the wallet

const res = await ensurePqcRegistered(tx, {
  pqcKeypair,
  statusSource: client, // makes the call idempotent (skips if already registered)
});
// res: { alreadyRegistered: boolean; txHash?: string }
```

Under the hood it builds and broadcasts `MsgRegisterPQCKeyV2` (the chain's
classical-exempt bootstrap path, with an explicit ML-DSA-87 `algorithmId`)
carrying the signer's Dilithium public key (from `pqcKeypair`) plus, optionally,
the account's ECDSA public key.

:::note Deterministic signing
ML-DSA-87 signing in every SDK language is **deterministic** (FIPS-204 §3.4,
`rnd` = 32 zero bytes). The chain's verifier accepts only deterministic
signatures — randomized ("hedged") signatures are rejected with codespace
`pqc`. The SDK signs deterministically by default; the hedged variants are
opt-in and for off-chain use only.
:::

## Sign hybrid

`migrateToHybrid` ensures registration and hands back a hybrid send path with the
keypair pre-bound to the existing `buildHybridTx` / `signAndBroadcastHybrid`
builders:

```ts
import { migrateToHybrid } from "@qorechain/sdk";

const hybrid = await migrateToHybrid(tx, { pqcKeypair, statusSource: client });

await hybrid.signAndBroadcastHybrid({
  registry,
  signer,          // classical secp256k1 direct signer
  messages,
  fee,
  chainId,
  accountNumber,
  sequence,
  transport,       // a connected broadcast transport (e.g. StargateClient)
});
```

## Rotate a key

If you need to rotate the PQC key (algorithm upgrade or a compromised key), use
`migratePqcKey`, which broadcasts `MsgMigratePQCKey` proving ownership of both the
old and the new key:

```ts
import { migratePqcKey } from "@qorechain/sdk";

await migratePqcKey(tx, {
  oldPublicKey,
  newPublicKey,
  oldSignature, // by the old key
  newSignature, // by the new key
});
```

## In the UI

The [`@qorechain/react`](./react.md) kit surfaces all of this in React: the
`usePqcStatus` hook and the `<QuantumSafeBadge/>` component show a **Quantum-safe**
indicator whenever the connected account has a registered PQC key.
