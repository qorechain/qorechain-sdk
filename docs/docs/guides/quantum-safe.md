---
id: quantum-safe
title: Post-quantum hybrid signing
sidebar_position: 12
---

# Post-quantum hybrid signing

QoreChain supports post-quantum cryptography as a signature scheme next to the
classical one. An account registers an **ML-DSA-87 (Dilithium-5, NIST FIPS 204)**
key on-chain, after which its transactions carry a **hybrid** signature - the
usual classical secp256k1 signature **plus** an ML-DSA-87 signature. The chain's
ante handler verifies both, so a PQC-registered account stays compatible with
classical verification and also carries a signature from a post-quantum scheme.

What this covers, lane by lane:

- **Native (Cosmos SDK) lane:** the chain requires the hybrid secp256k1 +
  ML-DSA-87 signature by default. Registering the key is the classical bootstrap
  message; every transaction after it is hybrid-signed.
- **EVM lane:** an EVM transaction is admitted only from an account with a
  registered ML-DSA-87 key and an open, bounded authorisation window. The window
  is opened by a hybrid-signed message on the native lane; the EVM transaction
  itself is signed with secp256k1.
- **SVM lane:** not open yet.

The SDK packages this into a small, idempotent surface: one call registers the
account's ML-DSA-87 key and switches it to hybrid signing on the native lane.

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

`ensurePqcRegistered` registers the account's ML-DSA-87 key. It is **idempotent**: pass a
status source and it skips the registration when the key is already registered,
so it is safe to call on every app start.

```ts
import { derivePqcCanonical, ensurePqcRegistered } from "@qorechain/sdk";

// The recoverable key: derived from the account's mnemonic, bound to its address.
const pqcKeypair = derivePqcCanonical(account.address, mnemonic);
// With the keypair, the client signs every transaction hybrid (the
// registration itself stays classical, the chain's bootstrap path).
const tx = await client.connectTx(signer, { pqcKeypair });

const res = await ensurePqcRegistered(tx, {
  pqcKeypair,
  rest: "https://api.qore.host", // checks first: skips if already registered
});
// res: { alreadyRegistered: boolean; txHash?: string }

await tx.bankSend("qor1…", [{ denom: "uqor", amount: "1000000" }]); // hybrid-signed
```

The same key in the other SDKs: `derive_pqc_canonical(address, mnemonic)`
(Python), `authenticator.DerivePQCCanonical` (Go),
`try_derive_pqc_canonical` (Rust), `Authenticator.derivePqcCanonical` (Java).
They sign hybrid through their hybrid transaction builders
(`build_hybrid_tx`, `tx.BuildHybridMessages`, `build_hybrid_tx`,
`PqcDx.HybridSendPath`).

:::warning Always let it check first
The chain refuses a second registration of the same key **after charging the
fee**. `ensurePqcRegistered` therefore reads the status first, over REST
(`/qorechain/pqc/v1/account/{address}`, which every public endpoint serves), and
refuses to register when it cannot tell - it never registers blind. Pass `rest`
(or `statusSource` for a node that exposes `qor_*`); `force: true` skips the
check and is only for an account known to have no key.
:::

:::caution One account, one key
When the account already has a key, `ensurePqcRegistered` checks that it is
**this** keypair's. If another key is registered (a second device, a keypair
generated separately, an unfinished rotation) it throws `PqcKeyMismatchError`
and sends nothing: every hybrid transaction signed with this keypair would be
refused. Sign with the keypair that registered the account, or rotate its key
with `MsgRotatePQCKey`.
:::

Under the hood it builds and broadcasts `MsgRegisterPQCKeyV2` (the chain's
classical-exempt bootstrap path, with an explicit ML-DSA-87 `algorithmId`)
carrying the signer's Dilithium public key (from `pqcKeypair`) plus, optionally,
the account's ECDSA public key.

:::note Deterministic signing
ML-DSA-87 signing in every SDK language is **deterministic** by default
(FIPS-204 §3.4, `rnd` = 32 zero bytes), so signatures are reproducible against
the test vectors. This is an SDK default, not a chain rule: the chain verifies
any valid FIPS-204 ML-DSA-87 signature, hedged or deterministic. The hedged
(randomized) variants are opt-in and equally accepted.
:::

## Sign hybrid

`migrateToHybrid` ensures registration and hands back a hybrid send path with the
keypair pre-bound to the existing `buildHybridTx` / `signAndBroadcastHybrid`
builders:

```ts
import { migrateToHybrid } from "@qorechain/sdk";

const hybrid = await migrateToHybrid(tx, { pqcKeypair, rest: "https://api.qore.host" });

await hybrid.signAndBroadcastHybrid({
  registry,
  signer,          // classical secp256k1 direct signer
  messages,
  fee,
  chainId,
  rest,            // the network's REST (LCD) URL - picks the sign-bytes form
  accountNumber,
  sequence,
  transport,       // a connected broadcast transport (e.g. StargateClient)
});
```

:::caution The sign-bytes form depends on the network
Chain v3.1.98 introduced a v2 form of the hybrid sign-bytes that binds a domain
tag and the chain id. A network verifies exactly **one** form at any height: the
testnet (`qorechain-diana`) switched to v2 at its `v3.1.98` upgrade (height 5,746,000),
mainnet (`qorechain-vladi`) at its `v3.2.0` upgrade (height 2,981,742); both verify
only v2 today. The SDK
asks for both plan names, so it follows either network. Pass `rest` and the SDK asks the
network (`signBytesVersion: "auto"`, the default), caching the answer for about a
minute. Without `rest` on those two networks the SDK throws rather than guess -
a wrong guess is refused on-chain with `pqc` code 21. Force a form with
`signBytesVersion: "v1"` or `"v2"`.

`signAndBroadcastHybrid` re-resolves and retries once on a `pqc` code 21
refusal. If you broadcast yourself, detect it with `isHybridSignBytesRejection`
and rebuild with `forceRefreshSignBytesVersion: true`.
:::

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

## Publish an encryption key (KEM registry, chain v3.2.5)

Besides its ML-DSA-87 signing key, an account can publish one ML-KEM-1024
(FIPS 203) encapsulation key so that anyone can encrypt to it. It is not an
authentication key; the account keeps signing with ML-DSA-87.

```ts
import { msg, fetchKemKey } from "@qorechain/sdk";

// Register (or replace) the key: algorithm 2 = ML-KEM-1024, 1568 bytes.
await tx.signAndBroadcast([msg.pqc.registerKemKey({ sender: address, publicKey })], "auto");

// Anyone can read it (bech32 or 0x address).
const { found, key } = await fetchKemKey({ rest, address });

// Withdraw it.
await tx.signAndBroadcast([msg.pqc.removeKemKey({ sender: address })], "auto");
```

- One key per account; registering again replaces it.
- Both messages need the account's hybrid signature, and the account must
  already hold a registered post-quantum signature key. There is no proof of
  possession: the hybrid signature authenticates the registration. Both are
  refused through authz.
- `registerKemKey` checks the key before signing: exactly 1568 bytes, every
  coefficient below 3329, not all zero.
- Refusals are named: `pqc` 250 (registry not enabled), 251 (invalid key),
  252 (nothing to remove), 253 (the same key is already published), 254 (no
  post-quantum signature key).
- The chain stores and serves the raw key only. Encryption to it is not part of
  this SDK.

## In the UI

The [`@qorechain/react`](./react.md) kit surfaces all of this in React: the
`usePqcStatus` hook and the `<PqcStatusBadge/>` component show a **PQC key
registered** indicator whenever the connected account has a registered ML-DSA-87
key.
