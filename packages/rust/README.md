# qorechain (Rust)

Rust SDK for QoreChain — network presets, denomination/address utilities, HD
account derivation (native / EVM / SVM), post-quantum (ML-DSA-87) signing, typed
messages for every custom chain module, the full transaction lifecycle (auto-gas,
error decoding, tracking, search), typed queries, WebSocket subscriptions, and
async read clients for the REST (LCD) and `qor_*` JSON-RPC surfaces.

This crate lives in the `qorechain-sdk` monorepo and mirrors the TypeScript,
Python, and Go SDK surfaces for the native chain.

## Install

```toml
[dependencies]
qorechain = "0.2"
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
| `proto` | Generated prost types for every QoreChain custom module. |
| `msg` | Typed message composers (49 custom + standard Cosmos) and `to_any`. |
| `query` | `RestClient`, `JsonRpcClient`, typed `qor_*` `QorClient`, and `TypedQueryClient`. |
| `client` | `create_client` / `ClientBuilder` composing the read clients + fees. |
| `tx` | `bank_send`, `send_messages`, `build_hybrid_tx`, `broadcast`, auto-gas, error decoding, tracking, and search. |
| `subscribe` | WebSocket new-block / tx subscriptions over the chain RPC `/websocket`. |
| `utils` | Hashing (sha256/keccak256/ripemd160), exact unit math, EVM/SVM address validators. |

### Typed messages and composers

Every QoreChain custom-module message (49 across amm, bridge, rdk, multilayer,
pqc, svm, lightnode, license, abstractaccount, crossvm, rlconsensus) plus the
common standard Cosmos messages have typed composers under `msg`. Each returns a
prost message; the `*_any` variants pack it into a `cosmrs::Any` with the correct
type URL, ready for `tx::send_messages` or `tx::build_hybrid_tx`:

```rust
use qorechain::msg;
use cosmrs::proto::cosmos::base::v1beta1::Coin;

let any = msg::amm::swap_exact_in_any(
    "qor1sender",
    1,                                  // pool id
    Coin { denom: "uqor".into(), amount: "1000".into() },
    "uatom",
    "990",
);
assert_eq!(any.type_url, "/qorechain.amm.v1.MsgSwapExactIn");
```

The prost types are generated offline by `scripts/codegen-rust.sh` (buf +
`protoc-gen-prost`) and committed under `src/proto`, so `cargo build` needs no
protoc. Type URLs use the exact on-chain message names (e.g.
`MsgRegisterPQCKey`), which is what the chain's interface registry resolves.

### Out of scope

Browser wallet adapters and EVM/SVM transaction adapters are intentionally not
bundled — Rust dApps use `ethers-rs`/`alloy` (EVM) and the Solana SDK (SVM)
directly. The ICS-20 IBC `MsgTransfer` is not bundled either (the underlying
proto crate omits IBC types); build it with `ibc-proto` and pack it via
`msg::to_any` using `msg::cosmos::MSG_TRANSFER`.

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

### Generic messages, auto-gas, tracking, and search

```rust,no_run
use qorechain::{msg, tx};
use cosmrs::proto::cosmos::base::v1beta1::Coin;

# async fn run(priv_key: Vec<u8>, pub_key: Vec<u8>) -> qorechain::Result<()> {
let rest = "http://localhost:1317";

// Build any messages and sign them with send_messages.
let messages = vec![msg::amm::swap_exact_in_any(
    "qor1sender",
    1,
    Coin { denom: "uqor".into(), amount: "1000".into() },
    "uatom",
    "990",
)];

let built = tx::send_messages(tx::SendMessagesParams {
    private_key: priv_key,
    public_key: pub_key,
    messages,
    chain_id: "qorechain-diana".into(),
    account_number: 1,
    sequence: 0,
    fee: tx::estimate_fee(rest, &[], 1.4, "0.025uqor").await?, // auto-gas via simulate
    memo: String::new(),
    timeout_height: 0,
})?;

// Broadcast and wait for inclusion; a failed code returns a typed QoreTxError.
let result = tx::broadcast_and_wait(rest, &built.tx_raw_bytes, tx::WaitOptions::default()).await?;
println!("included at height {}", result.height);

// Search by events.
let page = tx::search_txs(rest, &["message.sender=qor1sender"], 1, 50).await?;
let _ = page.total;
# Ok(())
# }
```

### Typed queries

`TypedQueryClient` runs the modules' gRPC `Query` services over the chain RPC
`abci_query` transport (no gRPC dependency) and returns the strongly typed prost
responses:

```rust,no_run
use qorechain::TypedQueryClient;

# async fn run() -> qorechain::Result<()> {
let q = TypedQueryClient::new("http://localhost:26657");
let acct = q.pqc_account("qor1...").await?;     // qorechain.pqc.v1.Query/Account
let slot = q.svm_slot().await?;                 // qorechain.svm.v1.Query/Slot
let _ = (acct.found, slot.slot);
# Ok(())
# }
```

### WebSocket subscriptions

```rust,no_run
use qorechain::SubscribeClient;

# async fn run() -> qorechain::Result<()> {
let client = SubscribeClient::connect("http://localhost:26657").await?;
let mut sub = client.subscribe_new_blocks()?;
while let Some(event) = sub.events.recv().await {
    println!("new block: {}", event.data);
}
sub.unsubscribe()?;
# Ok(())
# }
```

## Development

Regenerate the committed prost types (maintainer only; needs `buf` and
`protoc-gen-prost`):

```sh
bash scripts/codegen-rust.sh
```

```sh
cd packages/rust
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```
