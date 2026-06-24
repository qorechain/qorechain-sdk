# qorechain (Rust)

Rust SDK for QoreChain — network presets, denomination/address utilities, HD
account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing, and
async read clients for the REST (LCD) and `qor_*` JSON-RPC surfaces.

This crate lives in the `qorechain-sdk` monorepo and mirrors the TypeScript,
Python, and Go SDK surfaces — including native transaction building/signing,
REST broadcast, and end-to-end hybrid (classical + ML-DSA-87) transaction
signing (`tx` module).

## Install

```toml
[dependencies]
qorechain = "0.1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

Requires Rust 1.74+.

## Modules

| Module | Purpose |
|---|---|
| `networks` | Network presets (`testnet` and `mainnet`, both live), `get_network`. |
| `denom` | `to_base` / `from_base` exact integer money math (no floats). |
| `address` | bech32 ⇄ hex conversion and validation. |
| `accounts` | BIP-39 mnemonics + HD derivation (native, EVM, SVM). |
| `pqc` | ML-DSA-87 (FIPS 204) keygen / sign / verify + hybrid extension. |
| `query` | `RestClient`, `JsonRpcClient`, and the typed `qor_*` `QorClient`. |
| `client` | `create_client` / `ClientBuilder` composing the read clients + fees. |
| `tx` | `bank_send`, `broadcast`, `fee_from_estimate`, and `build_hybrid_tx`. |

## Quickstart

### Create a client

```rust,no_run
use qorechain::ClientBuilder;

#[tokio::main]
async fn main() -> qorechain::Result<()> {
    let client = ClientBuilder::new().build()?; // defaults to "testnet"
    println!("{:?}", client.network.chain_id); // Some("qorechain-diana")

    let balances = client
        .rest
        .get_all_balances("qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu")
        .await?;
    let stats = client.qor.get_ai_stats().await?;
    let fee = client.fees.estimate("fast").await?;
    let _ = (balances, stats, fee);
    Ok(())
}
```

Mainnet (chain id `qorechain-vladi`) is live; select it and override the
localhost defaults with your node URLs:

```rust,no_run
use qorechain::ClientBuilder;

let client = ClientBuilder::new()
    .network("mainnet")
    .rest("https://rest.example")
    .evm_rpc("https://evm.example")
    .build()
    .unwrap();
// client.network.chain_id == Some("qorechain-vladi".into())
```

### Derive accounts

```rust
use qorechain::accounts::{
    derive_evm_account, derive_native_account, derive_svm_account, generate_mnemonic,
};

let mnemonic = generate_mnemonic(128).unwrap();

let native = derive_native_account(&mnemonic, 0).unwrap(); // qor1...
let evm = derive_evm_account(&mnemonic, 0).unwrap();       // 0x... (EIP-55)
let svm = derive_svm_account(&mnemonic, 0).unwrap();       // base58 ed25519
```

Derivation paths: native `m/44'/118'/0'/0/{i}`, EVM `m/44'/60'/0'/0/{i}`,
SVM `m/44'/501'/{i}'/0'`. Invalid mnemonics (wrong checksum) return an error.

### Post-quantum signing

```rust
use qorechain::pqc::{
    build_hybrid_signature_extension, generate_pqc_keypair, pqc_sign, pqc_verify,
    ALGORITHM_DILITHIUM5,
};

let kp = generate_pqc_keypair().unwrap();             // ML-DSA-87: 2592 / 4896
let sig = pqc_sign(&kp.secret_key, b"...").unwrap();  // 4627-byte signature
assert!(pqc_verify(&kp.public_key, b"...", &sig));

let ext =
    build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &sig, Some(&kp.public_key)).unwrap();
// serializes to {"algorithm_id":1,"pqc_signature":"<base64>","pqc_public_key":"<base64>"}
let _ = ext;
```

### Denomination math

```rust
use qorechain::{from_base, to_base};

assert_eq!(to_base("1.5", 6).unwrap(), "1500000");
assert_eq!(from_base("1500000", 6).unwrap(), "1.5");
```

All amount math is exact integer arithmetic on decimal strings — never floating
point — so conversions never drift for any magnitude.

## Transactions

The `tx` module builds, signs, and broadcasts native transactions, and provides
end-to-end hybrid (classical secp256k1 + post-quantum ML-DSA-87) signing:

- `bank_send` builds and signs a `cosmos.bank.v1beta1.MsgSend` into a
  broadcast-ready `TxRaw` (`SIGN_MODE_DIRECT`).
- `broadcast` POSTs signed bytes to the REST `/cosmos/tx/v1beta1/txs` endpoint
  (`sync` / `async` / `block`).
- `fee_from_estimate` turns an AI fee-oracle response into a `Fee`.
- `build_hybrid_tx` produces a tx carrying the classical signature in
  `TxRaw.signatures` PLUS an ML-DSA-87 signature in the `TxBody`
  `PQCHybridSignature` extension. The PQC half signs
  `BE32(len(B0)) || B0 || BE32(len(A)) || A` (body without the extension, then
  authInfo); the classical half signs the final body. The signer's PQC key must
  be registered on-chain (`MsgRegisterPQCKey`) — or pass `include_pqc_public_key`
  to embed it for auto-registration.

Transaction proto encoding/signing is delegated to the `cosmrs` crate; no
proto/crypto primitives are reimplemented here.

## Development

```sh
cd packages/rust
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```
