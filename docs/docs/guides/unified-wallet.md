---
id: unified-wallet
title: Unified wallet
sidebar_position: 6
---

# Unified wallet

A **unified eth-native account** is ONE `eth_secp256k1` key that is the SAME
20-byte identity rendered as all three QoreChain address encodings, sharing ONE
on-chain balance. A wallet never "has funds on one lane but not another" again.

The 20 address bytes are the Ethereum derivation
`keccak256(uncompressedPublicKey[1:])[12:]`, so the key is natively spendable on
the EVM lane; the native (`qor1…`) and SVM (base58) forms are just other
encodings of the same 20 bytes.

> The classic coin-118 native derivation (`deriveNativeAccount`, HD path
> `m/44'/118'/0'/0/{index}`) is still supported and unchanged. Unified accounts
> are an additional, opt-in identity model built on the eth-native (coin-60) key.

## Derive a unified account

`deriveUnifiedAccount(mnemonic, index = 0)` uses the Ethereum HD path
`m/44'/60'/0'/0/{index}`.

```ts
import { deriveUnifiedAccount } from "@qorechain/sdk";

const account = await deriveUnifiedAccount(
  "test test test test test test test test test test test junk",
  0,
);

account.cosmos; // "qor1…"  bech32, native lane
account.evm; //    "0x…"   EIP-55 hex, EVM lane
account.svm; //    "<base58>"  32-byte SVM address (addr20 ‖ 12 zero bytes)
account.addressBytes; // the raw 20 bytes shared by all three
account.publicKey; //   0x… 33-byte compressed secp256k1 public key
account.pqc; //         { publicKey (2592B), secretKey (4896B) } ML-DSA-87
```

The PQC keypair is derived deterministically from
`shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32)`, so it is
recoverable from `{ address, mnemonic }` and identical across QoreChain's
language SDKs.

### The three encodings

One 20-byte account, three renderings:

| Lane   | Encoding                                       |
| ------ | ---------------------------------------------- |
| cosmos | bech32 with the `qor` prefix                   |
| evm    | `0x` + EIP-55 mixed-case checksum hex          |
| svm    | base58 of `addr20 ‖ 12 zero bytes` (32 bytes)  |

Decode any ONE encoding into all three:

```ts
import { qoreAddresses, addressesFrom20 } from "@qorechain/sdk";

const all = qoreAddresses({ evm: account.evm });
all.cosmos; // qor1…
all.svm; //    base58

// or straight from the raw bytes
const same = addressesFrom20(account.addressBytes);
```

### Accounts from a raw seed

`unifiedAccountFromSeed(seed32)` uses 32 bytes directly as the secp256k1 private
key (same address derivation). The PQC seed context prefixes the key hex with a
literal `"seed:"`:
`shake256("qorechain:pqc:v1|" + cosmos + "|seed:" + hex(seed32), 32)`.

```ts
import { unifiedAccountFromSeed } from "@qorechain/sdk";

const account = unifiedAccountFromSeed(new Uint8Array(32).fill(1));
```

## eth_secp256k1 native-lane signing

A unified account signs native transactions with the
`eth_secp256k1` scheme, which differs from the classic Native secp256k1 path in
two ways:

1. The classical signature is secp256k1 over the **keccak256** of the SignDoc
   bytes (not sha256), serialized as the 64-byte `r ‖ s` (low-s normalized).
2. The `SignerInfo` public key `Any` uses the type URL
   `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey` — its `value` is the same wire
   shape as the standard secp256k1 `PubKey`, only the type URL differs.

Mainnet requires the ML-DSA-87 hybrid extension, so use the hybrid signer for
normal txs; the classical-only path is for the one-time, bootstrap-exempt
`MsgRegisterPQCKeyV2`.

```ts
import { EthNativeSigner, deriveUnifiedAccount } from "@qorechain/sdk";

const account = await deriveUnifiedAccount(mnemonic, 0);
const signer = new EthNativeSigner(account); // signMode: "hybrid" by default

// `transport` is a connected StargateClient (or anything with broadcastTx).
await signer.bankSend(
  transport,
  "qor1recipient…",
  [{ denom: "uqor", amount: "1000000" }],
  { chainId: "qorechain-vladi", accountNumber, sequence, fee },
);
```

For lower-level control, `signHybridEth(params)` / `signClassicalEth(params)`
return the assembled `TxRaw` bytes and the signing artifacts.

Reading an eth-native account's `account_number` / `sequence` from a
`BaseAccount` whose on-chain pubkey uses the `eth_secp256k1` type URL:

```ts
import { accountAuthInfo } from "@qorechain/sdk";

const { accountNumber, sequence, publicKey } = accountAuthInfo(baseAccount);
```

## Phantom (P1a)

A user can bootstrap ONE canonical QoreChain identity from Phantom without
exporting any key: they sign a fixed, domain-separated message with Phantom's
ed25519 key, and the 32-byte SHAKE-256 of that signature seeds a unified account.

```ts
import { connectPhantomUnified } from "@qorechain/sdk";

// In the browser (uses window.solana):
const account = await connectPhantomUnified();
```

The signed message is
`"QoreChain unified account derivation v1\n<phantom-pubkey-base58>"`. This is
**non-custodial**: the derived account is a SEPARATE canonical key from the
Phantom ed25519 key — Phantom never sees the derived secp256k1/PQC secrets, and
the derived account is a distinct on-chain identity, not the Phantom address.

Given a raw signature you already have, derive directly:

```ts
import { unifiedAccountFromPhantomSignature } from "@qorechain/sdk";

const account = unifiedAccountFromPhantomSignature(signatureBytes);
```
