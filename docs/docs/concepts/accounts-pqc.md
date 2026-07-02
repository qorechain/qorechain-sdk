---
id: accounts-pqc
title: Accounts & PQC signing
sidebar_position: 2
---

# Accounts & PQC signing

QoreChain accounts are derived from a single BIP-39 mnemonic. The same mnemonic
yields a native, an EVM, and an SVM account via independent derivation paths.

## HD derivation

```ts
import {
  generateMnemonic,
  validateMnemonic,
  deriveNativeAccount,
  deriveEvmAccount,
  deriveSvmAccount,
} from "@qorechain/sdk";

const mnemonic = generateMnemonic(); // 12 words; pass 256 for 24 words

const native = await deriveNativeAccount(mnemonic);
console.log(native.address); // "qor1..."  (secp256k1, bech32)

const evm = await deriveEvmAccount(mnemonic);
console.log(evm.address); // "0x..."   (EIP-55 checksummed)

const svm = await deriveSvmAccount(mnemonic);
console.log(svm.address); // base58 ed25519 public key
```

The mnemonic is validated (words **and** checksum) before any key is derived, so
a typo raises rather than silently producing a wrong account. You can validate
explicitly with `validateMnemonic(mnemonic)`.

### Derivation schemes

| Type | Curve | Path | Address |
| --- | --- | --- | --- |
| native | secp256k1 | `m/44'/118'/0'/0/{i}` | bech32 `qor` of `ripemd160(sha256(pubkey))` |
| evm | secp256k1 | `m/44'/60'/0'/0/{i}` | `0x` + `keccak256(pubkey)[-20:]`, EIP-55 |
| svm | ed25519 | `m/44'/501'/{i}'/0'` | base58 of the 32-byte public key |

Pass an account index to derive additional accounts. In TypeScript:

```ts
const second = await deriveNativeAccount(mnemonic, { accountIndex: 1 });
```

In Python/Go/Rust the index is a positional argument
(`derive_native_account(mnemonic, 1)` / `DeriveNativeAccount(mnemonic, 1)` /
`derive_native_account(&mnemonic, 1)`).

### Known-answer note

The derivation schemes are deterministic and covered by known-answer tests
across all four SDKs, so the same mnemonic produces identical addresses in
TypeScript, Python, Go, and Rust. This lets you derive in one language and verify
in another.

## Post-quantum cryptography (PQC)

QoreChain supports **ML-DSA-87** (Dilithium-5, FIPS 204) signatures. The SDK
exposes the primitives directly.

```ts
import {
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
} from "@qorechain/sdk";

const keypair = generatePqcKeypair();
const message = new TextEncoder().encode("hello");

const signature = pqcSign(keypair.secretKey, message);
const ok = pqcVerify(keypair.publicKey, message, signature);
```

The exported length constants (`ML_DSA_87_PUBLIC_KEY_LENGTH`,
`ML_DSA_87_SECRET_KEY_LENGTH`, `ML_DSA_87_SIGNATURE_LENGTH`,
`ML_DSA_87_SEED_LENGTH`) let you validate buffer sizes.

### Pluggable signers

For composition, the SDK provides a `Signer` abstraction plus `PqcSigner` and
`HybridSigner` implementations, and a `SignatureMode` enum. Use these when you
want to plug PQC signing into your own flow rather than calling the primitives
directly.

## Hybrid signing

A **hybrid** transaction carries both a classical secp256k1 signature and an
ML-DSA-87 signature, so it remains valid under classical verification while
gaining post-quantum protection. The post-quantum part travels as a
`PQCHybridSignature` extension on the transaction.

```ts
import {
  buildHybridTx,
  deriveNativeAccount,
  directSignerFromPrivateKey,
} from "@qorechain/sdk";

const account = await deriveNativeAccount(mnemonic);
const signer = await directSignerFromPrivateKey(account.privateKey, "qor");

// buildHybridTx assembles a tx with BOTH a classical signature and an
// ML-DSA-87 signature attached as a PQCHybridSignature extension.
// (See packages/ts and the pqc-hybrid-sign example for the full call.)
```

### On-chain prerequisite

Before a hybrid transaction will PQC-verify on-chain, the signer's PQC public
key must be **registered** via the chain's `MsgRegisterPQCKeyV2` — *unless* you set
`includePqcPublicKey: true`, which embeds the key in the extension so the chain
can auto-register it on first use.

### Hybrid tx contract (high level)

The transaction is signed classically over the standard sign bytes (which
**exclude** the PQC extension), and the ML-DSA-87 signature is computed and
attached as the `PQCHybridSignature` extension. Because the classical sign bytes
exclude the extension, the classical signature stays valid whether or not a
verifier understands the PQC part. The lower-level helpers
(`encodeHybridExtension`, `attachHybridExtension`,
`buildHybridSignatureExtension`, `HYBRID_SIG_TYPE_URL`) and the end-to-end
builders (`buildHybridTx`, `signAndBroadcastHybrid`) are exported for advanced
use.

> Hybrid transaction submission is being finalized for the live network. The
> local sign/verify primitives and tx-building helpers are available today.

## Algorithm identifiers

The SDK exports algorithm IDs and helpers for protocol-level work:
`AlgorithmUnspecified`, `AlgorithmDilithium5`, `AlgorithmMLKEM1024`,
`algorithmName(id)`, and `isSignatureAlgorithm(id)`.
