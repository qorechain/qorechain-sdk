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
| `ai` | AI pre-flight risk/anomaly scoring over the EVM precompiles (`simulate_with_risk_score`). |
| `cross_vm` | Unified cross-VM call helper over `MsgCrossVMCall` (single + atomic triple-VM). |
| `pqc_dx` | Quantum-safe DX: idempotent PQC-key registration + classical→hybrid migration. |

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
  be registered on-chain (`MsgRegisterPQCKeyV2`) — or pass `include_pqc_public_key`
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
    fee: tx::estimate_fee(rest, &[], 1.4, "0.15uqor").await?, // auto-gas via simulate
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

### Sidechains, paychains & rollups (v0.4.0)

The multilayer (sidechains/paychains) and `rdk` (rollup) modules have typed
composers under `msg` and typed reads on `TypedQueryClient`. Compose a write with
`msg::multilayer::*_any` / `msg::rdk::*_any` (the `_any` variants pack the message
into a `cosmrs::Any`) and sign it with `tx::send_messages`; read layer and rollup
state through the typed query client.

```rust,no_run
use qorechain::{msg, TypedQueryClient};

# async fn run() -> qorechain::Result<()> {
// Multilayer: register a sidechain / paychain, anchor state, route a tx.
let register = msg::multilayer::register_sidechain_any(
    "qor1creator", "game-l2", "game sidechain", 0, 0, 0, 0, vec![], vec![]);
let route = msg::multilayer::route_transaction_any(
    "qor1sender", b"...".to_vec(), "game-l2", 0, "");

// Rollups (rdk): create a rollup, submit a batch, execute a withdrawal.
let create = msg::rdk::create_rollup_any("qor1creator", "r1", "default", "evm", 1);
let withdraw = msg::rdk::execute_withdrawal_any(
    "qor1submitter", "r1", 0, 0, "qor1rcpt", "uqor", 100, vec![vec![0x01]]);

// Typed reads.
let q = TypedQueryClient::new("http://localhost:26657");
let layer = q.multilayer_layer("game-l2").await?;
let layers = q.multilayer_layers().await?;
let stats = q.multilayer_routing_stats().await?;
let rollup = q.rdk_rollup("r1").await?;
let _ = (register, route, create, withdraw, layer, layers, stats, rollup);
# Ok(())
# }
```

See the [multilayer](../../docs/docs/guides/multilayer.md) and
[rollups](../../docs/docs/guides/rollups.md) guides.

### AI pre-flight risk scoring (v0.5.0)

The `ai` module exposes QoreChain's on-chain AI risk/anomaly model over two EVM
precompiles, so you get an advisory verdict on a transaction before broadcasting
it. `AiClient::simulate_with_risk_score` bundles a gas estimate, the
`aiRiskScore` precompile (`AI_RISK_SCORE_PRECOMPILE`, `0x…0B01`), and the
`aiAnomalyCheck` precompile (`AI_ANOMALY_CHECK_PRECOMPILE`, `0x…0B02`) into one
`Preflight`.

```rust,no_run
use qorechain::{AiClient, PreflightTx};

# async fn run() -> qorechain::Result<()> {
let ai = AiClient::new("https://evm.example");

let verdict = ai.simulate_with_risk_score(PreflightTx {
    from: "0xSender".into(),
    to: "0xContract".into(),
    data: vec![0xde, 0xad, 0xbe, 0xef],
    value: "0".into(),
}).await?;
if !verdict.safe { /* AI pre-flight flagged the transaction */ }

// Or call the precompiles individually.
let risk = ai.ai_risk_score(b"\xde\xad\xbe\xef").await?;
let anomaly = ai.ai_anomaly_check("0xSender", 1_000_000).await?;
let _ = (risk, anomaly);
# Ok(())
# }
```

See the [AI pre-flight](../../docs/docs/guides/ai-preflight.md) guide.

### Unified cross-VM calls (v0.5.0)

The `cross_vm` module wraps `MsgCrossVMCall` so you can route a single call — or
several atomically in **one** transaction (`call_atomic`) — across the EVM,
CosmWasm, and SVM VMs (`VM_TYPES`). A `Payload::Raw(bytes)` is sent as-is (the
EVM form: ABI-encoded calldata); a `Payload::CosmWasm(json)` is serialized to
compact UTF-8 JSON.

```rust,no_run
use qorechain::{cross_vm::CrossVm, CallOptions, Payload, VM_TYPE_COSMWASM, VM_TYPE_EVM, VM_TYPE_SVM};
use serde_json::json;

# async fn run(xvm: CrossVm) -> qorechain::Result<()> {
// Single call into a CosmWasm contract (payload JSON-encoded).
let res = xvm.call(&CallOptions::new(
    VM_TYPE_COSMWASM, "qor1contract…", Payload::CosmWasm(json!({ "increment": {} })),
)).await?;

// Atomic triple-VM batch in ONE tx.
let atomic = xvm.call_atomic(&[
    CallOptions::new(VM_TYPE_EVM, "0xC…", Payload::Raw(abi_calldata)),
    CallOptions::new(VM_TYPE_SVM, "Prog…", Payload::Raw(raw_bytes)),
    CallOptions::new(VM_TYPE_COSMWASM, "qor1…", Payload::CosmWasm(json!({ "stake": {} }))),
]).await?;

let built = xvm.build_call(&CallOptions::new(VM_TYPE_EVM, "0xC…", Payload::Raw(raw_bytes)))?;
let status = xvm.get_message("42").await?; // read a routed message's status
let _ = (res, atomic, built, status);
# Ok(())
# }
```

A `CrossVm` is a struct literal carrying the signer's key material, chain id,
account number / sequence, fee, REST URL, and an optional `QorClient` for
`get_message`. See the [cross-VM](../../docs/docs/guides/cross-vm.md) guide.

### Quantum-safe DX (v0.5.0)

The `pqc_dx` module makes a dApp PQC-protected in one idempotent call: check
whether the signer's Dilithium key is registered, register it if not, then sign
hybrid (ML-DSA-87 + secp256k1).

```rust,no_run
use qorechain::pqc_dx::PqcDx;
use cosmrs::Any;

# async fn run(pdx: PqcDx, messages: Vec<Any>) -> qorechain::Result<()> {
// Read-only status (over the qor_ namespace).
let registered = pdx.is_pqc_registered(&pdx.sender).await?;
let status = pdx.get_pqc_status(&pdx.sender).await?;

// Idempotent: registers the signer's Dilithium key only if it isn't already.
let ensure = pdx.ensure_pqc_registered().await?;

// Migrate a classical account to hybrid signing, then sign hybrid.
let path = pdx.migrate_to_hybrid().await?;
let sent = path.send_hybrid(messages).await?;
let _ = (registered, status, ensure, sent);
# Ok(())
# }
```

`migrate_pqc_key` rotates an account's on-chain PQC key (`MsgMigratePQCKey`). See
the [quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

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
