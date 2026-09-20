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
qorechain-sdk = "0.8" # imported as `qorechain`
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
| `msg` | Typed message composers (49 custom + standard Native) and `to_any`. |
| `query` | `RestClient`, `JsonRpcClient`, typed `qor_*` `QorClient`, and `TypedQueryClient`. |
| `client` | `create_client` / `ClientBuilder` composing the read clients + fees. |
| `tx` | `bank_send`, `send_messages`, `build_hybrid_tx`, `broadcast`, auto-gas, error decoding, tracking, and search. |
| `subscribe` | WebSocket new-block / tx subscriptions over the chain RPC `/websocket`. |
| `utils` | Hashing (sha256/keccak256/ripemd160), exact unit math, EVM/SVM address validators. |
| `ai` | AI pre-flight risk/anomaly scoring over the EVM precompiles (`simulate_with_risk_score`). |
| `cross_vm` | Unified cross-VM call helper over `MsgCrossVMCall` (single + atomic triple-VM). |
| `pqc_dx` | Quantum-safe DX: idempotent PQC-key registration + classical→hybrid migration. |

### Typed messages and composers

Every QoreChain custom-module message (57 across amm, bridge, rdk, multilayer,
pqc, svm, lightnode, license, abstractaccount, crossvm, rlconsensus) plus the
common standard Native messages have typed composers under `msg`. Each returns a
prost message; the `*_any` variants pack it into a `cosmrs::Any` with the correct
type URL, ready for `tx::send_messages` or `tx::build_hybrid_tx`.

New in chain v3.1.97: `msg::svm::update_params` builds
`/qorechain.svm.v1.MsgUpdateParams`, the governance message that replaces the SVM
module's runtime `SVMParams` wholesale (so `enabled` — and therefore closing the
SVM lane — is an ordinary proposal rather than a binary release). The replacement
is wholesale, so pass every field at its intended value, not only the ones being
changed.

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

**Lengths are exact.** Every entry point validates its inputs against the FIPS
204 sizes — signature 4627, public key 2592, secret key 4896 — before touching
the underlying library, and rejects anything else (`pqc_verify` returns `false`,
the signing paths return `Err`). A signature carrying even one extra trailing
byte is not valid. This is the SDK's own guarantee rather than an inherited one:
ML-DSA implementations disagree about trailing bytes (the Go binding over CIRCL
v1.6.1 accepts a 4628-byte signature; `fips204` does not), so the strict rule is
stated and tested here to keep every language binding on the same side.
`is_valid_pqc_signature_len` / `is_valid_pqc_public_key_len` /
`is_valid_pqc_secret_key_len` expose the check.

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
  `PQCHybridSignature` extension. The PQC half signs the per-network hybrid
  sign-bytes of `B0` (the body without the extension) and `A` (authInfo) — see
  below; the classical half signs the final body. The signer's PQC key must
  be registered on-chain (`MsgRegisterPQCKeyV2`) — or pass `include_pqc_public_key`
  to embed it for auto-registration.
- `broadcast_hybrid_tx` builds, signs and broadcasts a hybrid tx, choosing the
  sign-bytes version per network and retrying once on a version mismatch.

### Hybrid sign-bytes v1 / v2 (chain v3.2.0, testnet v3.1.98)

Chain release `v3.2.0` — which the testnet already took under the earlier name
`v3.1.98` — changed the bytes the ML-DSA-87 key signs. Each network verifies
exactly **one** form:

| form | bytes |
|---|---|
| v1 (legacy) | `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` |
| v2 | `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainId) ‖ chainId ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` |

v2 adds a domain tag and binds the chain id, so a PQC signature made for one
network never verifies on another. The key-migration (`MsgMigratePQCKey`) and
bridge-attestation payloads changed in the same release; the `signbytes` module
has v1/v2 builders and a version-dispatching builder for all three
(`hybrid_sign_bytes`, `migration_sign_bytes`, `bridge_attestation_sign_bytes`).

**Which form (the `auto` rule).** `qorechain-vladi` (mainnet) and
`qorechain-diana` (testnet) existed before v2: they verify v1 until the v2
upgrade plan is applied on them, and v2 after. Any other chain verifies v2 from
its first block.

**The switch has two plan names, so ask for both.** `SIGN_BYTES_V2_UPGRADES ==
["v3.2.0", "v3.1.98"]` (`SIGN_BYTES_V2_UPGRADE` is the primary, `"v3.2.0"`):
mainnet applies `v3.2.0`, the testnet already applied `v3.1.98` and keeps that
record forever. A client that asks one name only reads height 0 on the other
network, signs v1, and has every hybrid transaction there refused with `pqc`
code 21.

With `SignBytesMode::Auto` (the default on the async paths) the SDK asks the
node, for each name in order,

    GET {rest}/cosmos/upgrade/v1beta1/applied_plan/{name}  ->  {"height":"<n>"}

and signs v2 when **any** `n > 0` (compared numerically — the height is a
string, and a missing one counts as 0). The lookup stops at the first positive
height, so mainnet costs one request after its upgrade and the testnet two. The
answer is cached per `(rest URL, chain id)` for about a minute
(`SignBytesResolver::with_ttl`, `force_refresh`, `clear_cache`). If the chain
still refuses the tx with `pqc` code 21 ("hybrid PQC signature verification
failed"), the SDK re-asks the node, re-signs and broadcasts **once** more. A
legacy chain with no REST URL, or a failed query, is an error — the SDK never
guesses.

**Today:** the testnet has applied `v3.1.98` and verifies **v2 only**; the
mainnet has not, and stays on **v1** until it applies `v3.2.0` (the `auto` rule
then switches automatically).

**Override.** Pass an explicit version to pin the form with no network call:
`SignBytesMode::V1` / `V2` on the async paths (never retried), or
`sign_bytes_version: Some(SignBytesVersion::V1 | V2)` on the pure builders.
`build_hybrid_tx` and `sign_eth::sign_hybrid_eth` are synchronous and
network-free: with `sign_bytes_version: None` they sign v2 on a chain born with
v2 and **fail** on `qorechain-vladi` / `qorechain-diana` rather than silently
picking v1. The version used is reported on `BuiltTx::sign_bytes_version` /
`EthBuiltTx::sign_bytes_version`.

```rust,no_run
use qorechain::signbytes::{SignBytesMode, SignBytesResolver, SignBytesVersion};
use qorechain::tx::{broadcast_hybrid_tx, build_hybrid_tx, BroadcastMode, BuildHybridTxParams};

# async fn run(mut params: BuildHybridTxParams) -> qorechain::Result<()> {
let rest = "https://api-testnet.qore.host";

// Resolve once, then build offline.
let version = SignBytesResolver::new()
    .resolve(SignBytesMode::Auto, &params.chain_id, Some(rest))
    .await?;
params.sign_bytes_version = Some(version);
let built = build_hybrid_tx(params.clone())?;
assert_eq!(built.sign_bytes_version, Some(version));

// Or let the SDK resolve, sign, broadcast and retry once on a pqc/21 refusal.
let sent = broadcast_hybrid_tx(params, SignBytesMode::Auto, rest, BroadcastMode::Sync).await?;
println!("{} (retried: {})", sent.sign_bytes_version, sent.retried);

// Pin the form explicitly (no network call, no retry).
let _ = SignBytesVersion::V1;
# Ok(())
# }
```

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

Chain v3.1.83 adds `amm`, `license`, and `abstractaccount` typed query methods,
the `multilayer` `anchor` / `anchors` state-anchor queries, and abstractaccount
`register_authenticator_any` / `revoke_authenticator_any` message composers.

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

**Immediate vs queued (chain v3.1.97).** A call now executes **inside the
transaction** by default and the chain returns the callee's answer.
`call_with_responses` / `call_atomic_with_responses` decode it into
`CrossVmCallResponse { message_id, executed, data, gas_used }`. Set
`CallOptions::queue(true)` (the proto's `async` field) to only enqueue the
message for a later `MsgProcessQueue` dispatch — the response then carries just
the id with `executed == false`, and the outcome is read afterwards with
`get_message`.

`CallOptions::source_vm` is **ignored by the chain** from v3.1.97: the origin
lane is derived from the execution context rather than from the caller's own
description of itself. The SDK still sends the field so older nodes keep
accepting the message.

### Quantum-safe DX (v0.5.0)

The `pqc_dx` module makes a dApp PQC-protected in one idempotent call: check
whether the signer's Dilithium key is registered, register it if not, then sign
hybrid (ML-DSA-87 + secp256k1).

```rust,no_run
use qorechain::pqc_dx::PqcDx;
use qorechain::tx::Message;

# async fn run(pdx: PqcDx, messages: Vec<Message>) -> qorechain::Result<()> {
// Read-only status (over the qor_ namespace).
let registered = pdx.is_pqc_registered(&pdx.sender).await?;
let status = pdx.get_pqc_status(&pdx.sender).await?;

// Idempotent: registers the signer's Dilithium key only if it isn't already.
let ensure = pdx.ensure_pqc_registered().await?;

// Migrate a classical account to hybrid signing, then sign hybrid. The
// sign-bytes form follows `pdx.sign_bytes` (default Auto: resolved from
// `pdx.rest_url`, one retry on a pqc/21 refusal).
let path = pdx.migrate_to_hybrid().await?;
let sent = path.send_hybrid_detailed(messages).await?;
println!("signed {}", sent.sign_bytes_version);
let _ = (registered, status, ensure);
# Ok(())
# }
```

`PqcDx::sign_bytes` (`SignBytesMode`, default `Auto`) selects the hybrid
sign-bytes form; the sync `build_hybrid` needs an explicit `V1`/`V2` on
`qorechain-vladi` / `qorechain-diana` (or use `resolve_sign_bytes_version` +
`build_hybrid_with_version`).

`migrate_pqc_key` rotates an account's on-chain PQC key (`MsgMigratePQCKey`);
both key signatures cover `signbytes::migration_sign_bytes` in the form the chain
verifies (v1 binds no public keys, v2 binds both). See
the [quantum-safe](../../docs/docs/guides/quantum-safe.md) guide.

### Unified eth-native wallet (v0.6.0)

One `eth_secp256k1` key = ONE 20-byte identity rendered three ways — `qor1…`
(bech32), `0x…` (EIP-55), and SVM base58 (the 20 bytes right-padded with 12 zero
bytes to 32). A deposit to any of the three lands in the **same** balance, and the
key spends on **all** lanes. `unified::derive_unified_account` uses the Ethereum HD
path (`m/44'/60'/0'/0/{index}`); `unified::unified_account_from_seed` builds one
directly from a 32-byte secret. `unified::addresses_from_20` /
`unified::qore_addresses` convert between the three encodings. The legacy
coin-type-118 `derive_native_account` still works (additive).

Native-lane signing over the eth key: `sign_eth::sign_classical_eth` is a
classical secp256k1 signature over `keccak256(SignDoc)` with pubkey type
`/cosmos.evm.crypto.v1.ethsecp256k1.PubKey`; `sign_eth::sign_hybrid_eth` adds the
ML-DSA-87 post-quantum signature over the hybrid sign-bytes in
`EthSignParams::sign_bytes_version` (v1 / v2, see above). Account parsing accepts eth_secp256k1 public keys.

```rust,no_run
use qorechain::unified::{derive_unified_account, unified_account_from_seed};
use qorechain::sign_eth::{sign_hybrid_eth, EthSignParams};

# fn run(mnemonic: &str, secret_entropy: [u8; 32]) -> qorechain::Result<()> {
let account = derive_unified_account(mnemonic, 0)?;
account.cosmos; // "qor1…"    — QoreChain Native lane
account.evm;    // "0x…"      — EIP-55 checksummed
account.svm;    // "<base58>" — 20 bytes + 12 zero pad

// Or build one directly from a 32-byte seed. The seed IS the spend key, so it
// must be real secret entropy (CSPRNG / HSM / a mnemonic), never a wallet
// signature or anything else a third party can ask a wallet to produce.
let from_seed = unified_account_from_seed(secret_entropy)?;
let _ = (account, from_seed);
# Ok(())
# }
```

> **Removed in v0.8.0 (security).** `unified_account_from_phantom_signature`
> derived an account's spend key from an external wallet's signature over a fixed
> public message. That is unsafe: the signature is a bearer secret any page can
> request from the wallet, and it is deterministic, so whoever obtains it controls
> the account. The function now always returns an error. To let an external wallet
> key move funds, use the **authenticator lanes** below
> (`MsgRegisterAuthenticator` + `MsgExecuteCosmos` / `MsgExecuteEVM`), where the
> external signature authorizes a spend instead of becoming key material. Any
> account previously derived this way must be treated as exposed — move its funds.

See the [unified-wallet](../../docs/docs/guides/unified-wallet.md) guide.

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

## Authenticator lanes (v0.7.0 / chain v3.1.85)

A linked external key — a Phantom **ed25519** key, or a MetaMask **secp256k1**
key bound **by address** — spends from the ONE canonical PQC account through a
**relayer** that submits the tx and pays the fee (its own hybrid-PQC signature
satisfies the ante). The external key **never produces an ML-DSA co-signature**;
its signature over the domain-separated, replay-bound sign-bytes **is** the
authorization, under least-privilege, spending-limit and revocable terms
enforced on-chain.

Three messages carry the lanes, each with a composer:

- `MsgExecuteEVM` (`/qorechain.abstractaccount.v1.MsgExecuteEVM`) —
  `msg::abstractaccount::execute_evm`
- `MsgExecuteCosmos` (`/qorechain.abstractaccount.v1.MsgExecuteCosmos`) —
  `msg::abstractaccount::execute_cosmos`
- `MsgRotatePQCKey` (`/qorechain.pqc.v1.MsgRotatePQCKey`) —
  `msg::pqc::rotate_pqc_key`

**Sign-bytes helpers** (`authenticator` module) rebuild the exact digest the
chain re-derives: `authenticator::evm_auth_sign_bytes` / `cosmos_auth_sign_bytes`
(32-byte SHA-256 digests) and `rotation_sign_bytes` (the domain-separated string
both keys sign).

**NONCE semantics:**

- `MsgExecuteEVM.nonce` = the account's **current EVM nonce** (the relayer is a
  different account than the owner, so its envelope does **not** bump the
  account's nonce — pass it as-is, do **not** `+1`).
- `MsgExecuteCosmos.nonce` = the **per-authenticator sequence** for
  `(account, pubkey)`, a store counter distinct from the account's own sequence.

**Permission taxonomy & errors.** Query the on-chain permission schema with the
typed query client's `abstractaccount_permission_schema()` and compare an action
to it before submitting. `tx::errors::decode_tx_error` surfaces the lane
failures — codespace `abstractaccount`: `5` SpendingLimitExceeded, `6`
SessionKeyExpired, `10` PermissionDenied, `11` AuthenticatorReplay; codespace
`pqc`: `21` HybridVerifyFailed.

**Key rotation.** `authenticator::rotate_pqc_key_msg_from_mnemonic` migrates a
legacy `shake256(mnemonic)` key to the canonical, address-bound key (dual-signs
over `rotation_sign_bytes`); `authenticator::derive_pqc_legacy` re-derives the
old key for the old-key half.

```rust,no_run
use qorechain::authenticator::{
    evm_auth_sign_bytes, rotate_pqc_key_msg_from_mnemonic, RotateFromMnemonicOptions,
};
use qorechain::msg::abstractaccount::execute_evm;

# fn run(phantom_pubkey: Vec<u8>, current_evm_nonce: u64, mnemonic: &str) -> qorechain::Result<()> {
// Phantom ed25519 authenticator authorizes an EVM spend from the canonical
// account; the relayer broadcasts and pays. nonce = the account's CURRENT EVM
// nonce (relayer != owner -> no +1).
let digest = evm_auth_sign_bytes(
    "qorechain-diana", "qor1canonical…", &phantom_pubkey,
    "0xRecipient…", "1000000000000000000", // 1 QOR in aqor (wei)
    &[], current_evm_nonce,
);
let signature = phantom_sign(&digest); // your wallet signs the raw 32 bytes
let _exec = execute_evm(
    "qor1relayer…", "qor1canonical…", "ed25519", phantom_pubkey, signature,
    "0xRecipient…", "1000000000000000000", vec![], 100_000, current_evm_nonce,
);

// Migrate a legacy shake256(mnemonic) key to the address-bound key.
let opts = RotateFromMnemonicOptions::new("qor1canonical…", mnemonic, "qorechain-diana");
let rotation = rotate_pqc_key_msg_from_mnemonic(&opts)?;
let _ = rotation.msg; // MsgRotatePQCKey, broadcast BY the account, hybrid-cosigned
# Ok(())
# }
# fn phantom_sign(_d: &[u8; 32]) -> Vec<u8> { vec![] }
```

See the [authenticators](../../docs/docs/guides/authenticators.md) guide.

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
