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

`unifiedAccountFromSeed(seed32, opts)` uses 32 bytes directly as the secp256k1
private key (same address derivation). From 0.13.0 the PQC key needs a second
secret that the seed says nothing about. Pass exactly one of:

- `recoveryCode`: a `QRC1-…` recovery code (`generatePqcRecoveryCode()`), or
- `pqcSecret`: 32 bytes of independent secret entropy,

both derived as
`ML-DSA-87 keygen(shake256("qorechain:pqc:recovery:v1|" + cosmos + "|" ‖ secret32, 32))`,
the same key `pqcKeyFromRecoveryCode(code, cosmos)` gives. The third choice,
`legacySeedDerivation: true`, keeps the old derivation
(`shake256("qorechain:pqc:v1|" + cosmos + "|seed:" + hex(seed32), 32)`): use it
only to recover the PQC key of an account created before 0.13.0, so you can
rotate it (MsgRotatePQCKey) to a key from a recovery code; never for new
accounts. No option, or more than one, throws.

```ts
import { generatePqcRecoveryCode, unifiedAccountFromSeed } from "@qorechain/sdk";

const recoveryCode = generatePqcRecoveryCode(); // show once, store apart from the seed
const account = unifiedAccountFromSeed(seed32, { recoveryCode });
```

A recovery code is 56 Crockford base32 characters after `QRC1-` (256 secret bits
and a checksum, in groups of 4). Case, spaces and separators are tolerated, and
O / I / L are read as 0 / 1; a mistyped character fails the checksum.
`isValidRecoveryCode(code)` checks one, and `pqcRecoveryCodeFromSecret(secret32)`
encodes 32 bytes an app already holds.

## eth_secp256k1 native-lane signing

A unified account signs native transactions with the
`eth_secp256k1` scheme, which differs from the classic Native secp256k1 path in
two ways:

1. The classical signature is secp256k1 over the **keccak256** of the SignDoc
   bytes (not sha256), serialized as the 64-byte `r ‖ s` (low-s normalized).
2. The `SignerInfo` public key `Any` uses the type URL
   `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey` - its `value` is the same wire
   shape as the standard secp256k1 `PubKey`, only the type URL differs.

Mainnet requires the ML-DSA-87 hybrid extension, so use the hybrid signer for
normal txs; the classical-only path is for the one-time, bootstrap-exempt
`MsgRegisterPQCKeyV2`.

```ts
import { EthNativeSigner, deriveUnifiedAccount } from "@qorechain/sdk";

const account = await deriveUnifiedAccount(mnemonic, 0);
// signMode: "hybrid" by default. `rest` lets the signer ask the network which
// hybrid sign-bytes form it verifies (v1 on mainnet until its v3.2.0 upgrade,
// v2 on the testnet since its upgrade); without it, hybrid signing on those
// networks throws rather than guess.
const signer = new EthNativeSigner(account, { rest: "https://api.qore.host" });

// `transport` is a connected StargateClient (or anything with broadcastTx).
await signer.bankSend(
  transport,
  "qor1recipient…",
  [{ denom: "uqor", amount: "1000000" }],
  { chainId: "qorechain-vladi", accountNumber, sequence, fee },
);
```

For lower-level control, `signHybridEth(params)` / `signClassicalEth(params)`
return the assembled `TxRaw` bytes and the signing artifacts. `signHybridEth` is
synchronous, so on `qorechain-vladi` / `qorechain-diana` it needs the form passed
in: resolve it first with `resolveSignBytesVersion({ chainId, rest })` and pass it
as `signBytesVersion`.

Reading an eth-native account's `account_number` / `sequence` from a
`BaseAccount` whose on-chain pubkey uses the `eth_secp256k1` type URL:

```ts
import { accountAuthInfo } from "@qorechain/sdk";

const { accountNumber, sequence, publicKey } = accountAuthInfo(baseAccount);
```

## Linking an external wallet (Phantom / MetaMask)

An earlier API derived a unified account from a Phantom signature. It was
**removed in v0.8.0**: a wallet signature is a bearer secret that any page can
ask the wallet to produce, so it must never be used as the secret entropy of a
spend key. `unifiedAccountFromPhantomSignature` and `connectPhantomUnified` now
throw, and any account previously derived that way must be treated as exposed -
move its funds.

To let an external wallet key act for an account, use the **authenticator
lanes**: register the key with `MsgRegisterAuthenticator`, then spend from the
canonical PQC account via `MsgExecuteCosmos` / `MsgExecuteEVM` under a
permission and a `SpendingRule`. See the
[Authenticators guide](./authenticators.md).

Relatedly, `unifiedAccountFromSeed` takes the 32 bytes it is given as the spend
key, so pass real secret entropy - a CSPRNG seed or a mnemonic-derived key -
never a wallet signature.
