//! High-level quantum-safe developer-experience helper for QoreChain's
//! `x/pqc` module.
//!
//! QoreChain treats post-quantum cryptography (PQC) as a first-class signature
//! scheme: an account registers an ML-DSA-87 (Dilithium-5) key on-chain
//! (`MsgRegisterPQCKey`), after which its transactions can carry a hybrid
//! (classical secp256k1 + ML-DSA-87) signature that the ante handler verifies in
//! full. The low-level primitives already exist — [`generate_pqc_keypair`](crate::pqc::generate_pqc_keypair),
//! [`build_hybrid_tx`](crate::tx::build_hybrid_tx), the `msg::pqc` composers, and
//! the `qor_getPQCKeyStatus` read. This module wraps them into a tiny, idempotent
//! surface so a dApp becomes **quantum-safe by default**: one call to be
//! PQC-protected.
//!
//! It mirrors the canonical TypeScript SDK's `pqc` DX surface and follows the
//! explicit signer/account-context idiom of the parallel [`CrossVm`](crate::cross_vm::CrossVm)
//! helper: construct a [`PqcDx`] with the signer's key material and account
//! context (chain id, account number, sequence), then:
//!
//! - [`PqcDx::is_pqc_registered`] / [`PqcDx::get_pqc_status`] — read whether an
//!   address has a registered PQC key (via `qor_getPQCKeyStatus`).
//! - [`PqcDx::ensure_pqc_registered`] — register the signer's Dilithium key if
//!   (and only if) it is not already registered. Idempotent: safe to call on
//!   every app start.
//! - [`PqcDx::migrate_to_hybrid`] — ensure registration, then expose a hybrid
//!   send path (build a hybrid tx with the bound PQC keypair).
//! - [`PqcDx::migrate_pqc_key`] — rotate an account's PQC key
//!   (`MsgMigratePQCKey`).
//!
//! Reads go through an optional [`QorClient`]; writes use the signer key material
//! carried by [`PqcDx`] and broadcast over its REST URL.
//!
//! ## Precompile alternative
//!
//! The same status is readable on the EVM side via the
//! `pqcKeyStatus(address) returns (bool registered, uint8 algorithmId, bytes
//! pubkey)` precompile at [`PQC_KEY_STATUS_PRECOMPILE`]. The helpers below prefer
//! the `qor_getPQCKeyStatus` JSON-RPC method; the precompile is the documented
//! alternative for callers already on the EVM side.

use crate::error::{Error, Result};
use crate::msg::pqc::{migrate_pqc_key_any, register_pqc_key_any};
use crate::pqc::ALGORITHM_DILITHIUM5;
use crate::query::QorClient;
use crate::tx::{
    broadcast, build_hybrid_tx, send_messages, BroadcastMode, BuildHybridTxParams, BuiltTx, Fee,
    Message, SendMessagesParams,
};
use serde_json::Value;

/// EVM precompile address for the `pqcKeyStatus` read (documented alternative to
/// the `qor_getPQCKeyStatus` JSON-RPC method used by this module).
pub const PQC_KEY_STATUS_PRECOMPILE: &str = "0x0000000000000000000000000000000000000A02";

/// The default key-type tag forwarded to `MsgRegisterPQCKey`.
pub const DEFAULT_KEY_TYPE: &str = "hybrid";

/// Normalized PQC registration status for an address, decoded from the rich JSON
/// object returned by `qor_getPQCKeyStatus`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PqcStatus {
    /// Whether the address has a registered PQC key.
    pub registered: bool,
    /// The registered algorithm id, when known (Dilithium-5 = `1`).
    pub algorithm_id: Option<u8>,
    /// The registered PQC public key, when the chain returns it (decoded from a
    /// hex or base64 string, or a JSON byte array).
    pub pubkey: Option<Vec<u8>>,
}

/// The result of [`PqcDx::ensure_pqc_registered`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsureResult {
    /// `true` when the key was already registered (no transaction was sent).
    pub already_registered: bool,
    /// The registration transaction hash, when a registration was broadcast.
    pub tx_hash: Option<String>,
}

/// The signer/account context plus broadcast target for the PQC DX helpers.
///
/// Mirrors [`CrossVm`](crate::cross_vm::CrossVm): it carries the classical
/// secp256k1 key pair, the signer's ML-DSA-87 (Dilithium-5) key material, the
/// chain id, the on-chain account number / sequence, the fee, and the REST URL
/// used to broadcast. An optional [`QorClient`] enables the status reads and
/// makes [`PqcDx::ensure_pqc_registered`] idempotent.
#[derive(Debug, Clone)]
pub struct PqcDx {
    /// The signer's bech32 sender address.
    pub sender: String,
    /// The signer's 32-byte secp256k1 private key.
    pub private_key: Vec<u8>,
    /// The signer's 33-byte compressed secp256k1 public key (registered on-chain
    /// as the account's classical key).
    pub public_key: Vec<u8>,
    /// The signer's ML-DSA-87 (Dilithium-5) public key — the Dilithium key
    /// registered on-chain.
    pub pqc_public_key: Vec<u8>,
    /// The signer's ML-DSA-87 (Dilithium-5) secret key — the post-quantum half
    /// used for hybrid signing.
    pub pqc_secret_key: Vec<u8>,
    /// The chain id (e.g. `"qorechain-diana"`).
    pub chain_id: String,
    /// The signer's on-chain account number.
    pub account_number: u64,
    /// The signer's current account sequence (nonce).
    pub sequence: u64,
    /// The fee to pay.
    pub fee: Fee,
    /// The key-type tag forwarded to `MsgRegisterPQCKey`. Defaults to
    /// [`DEFAULT_KEY_TYPE`] when empty.
    pub key_type: String,
    /// The REST (LCD) URL used to broadcast (`/cosmos/tx/v1beta1/txs`).
    pub rest_url: String,
    /// Broadcast mode. Defaults to [`BroadcastMode::Sync`].
    pub mode: BroadcastMode,
    /// Optional `qor_*` client for the status reads / idempotency check.
    pub qor: Option<QorClient>,
}

impl PqcDx {
    /// Whether `address` has a registered PQC key.
    ///
    /// Thin boolean wrapper over [`PqcDx::get_pqc_status`] using
    /// `qor_getPQCKeyStatus`. Requires a configured [`QorClient`].
    pub async fn is_pqc_registered(&self, address: &str) -> Result<bool> {
        Ok(self.get_pqc_status(address).await?.registered)
    }

    /// Reads the PQC registration status of an address via `qor_getPQCKeyStatus`.
    ///
    /// The chain returns a rich JSON object; this helper normalizes the common
    /// fields (`registered`/`isRegistered`/`is_registered`,
    /// `algorithmId`/`algorithm_id`, `pubkey`/`publicKey`/`public_key`) into a
    /// [`PqcStatus`]. Unknown / non-object shapes degrade to
    /// `PqcStatus { registered: false, .. }`.
    ///
    /// Requires a configured [`QorClient`].
    pub async fn get_pqc_status(&self, address: &str) -> Result<PqcStatus> {
        let qor = self.require_qor("get_pqc_status")?;
        let raw = qor.get_pqc_key_status(address).await?;
        Ok(parse_pqc_status(&raw))
    }

    /// Registers the signer's PQC key if it is not already registered —
    /// idempotent.
    ///
    /// When a [`QorClient`] is configured and the key is already registered, this
    /// returns `EnsureResult { already_registered: true, tx_hash: None }` WITHOUT
    /// broadcasting. Otherwise it builds and broadcasts `MsgRegisterPQCKey` with
    /// the signer's Dilithium public key plus its classical ECDSA public key.
    ///
    /// This is the single call that makes a dApp quantum-safe: run it once at
    /// startup (or before the first hybrid tx) and the account is PQC-protected
    /// thereafter.
    ///
    /// Note: without a configured [`QorClient`], no pre-flight check is possible,
    /// so the registration is broadcast unconditionally — the chain's own
    /// idempotency then applies.
    pub async fn ensure_pqc_registered(&self) -> Result<EnsureResult> {
        if self.qor.is_some() && self.is_pqc_registered(&self.sender).await? {
            return Ok(EnsureResult {
                already_registered: true,
                tx_hash: None,
            });
        }

        let built = self.build_register()?;
        let resp = broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await?;
        Ok(EnsureResult {
            already_registered: false,
            tx_hash: extract_tx_hash(&resp),
        })
    }

    /// Builds + signs (but does not broadcast) the `MsgRegisterPQCKey` for the
    /// signer.
    ///
    /// Useful for inspection, packing into a larger tx, or a deferred-broadcast
    /// flow.
    pub fn build_register(&self) -> Result<BuiltTx> {
        let msg = register_pqc_key_any(
            self.sender.clone(),
            self.pqc_public_key.clone(),
            self.public_key.clone(),
            self.key_type(),
        );
        send_messages(SendMessagesParams {
            private_key: self.private_key.clone(),
            public_key: self.public_key.clone(),
            messages: vec![msg],
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
            sequence: self.sequence,
            fee: self.fee.clone(),
            memo: String::new(),
            timeout_height: 0,
        })
    }

    /// Ensures the signer's PQC key is registered (idempotent — see
    /// [`PqcDx::ensure_pqc_registered`]) and returns a [`HybridSendPath`] with the
    /// bound PQC keypair, ready to build hybrid (classical + ML-DSA-87)
    /// transactions.
    ///
    /// After this call the dApp's transactions can carry a verified hybrid
    /// signature.
    pub async fn migrate_to_hybrid(&self) -> Result<HybridSendPath> {
        let ensured = self.ensure_pqc_registered().await?;
        Ok(HybridSendPath {
            already_registered: ensured.already_registered,
            registration_tx_hash: ensured.tx_hash,
            dx: self.clone(),
        })
    }

    /// Builds + signs (but does not broadcast) a hybrid (classical + ML-DSA-87)
    /// transaction over the given messages, using the bound PQC key material.
    ///
    /// On-chain prerequisite: the signer's PQC key must already be registered
    /// (call [`PqcDx::ensure_pqc_registered`] first, or use
    /// [`PqcDx::migrate_to_hybrid`]).
    pub fn build_hybrid(&self, messages: Vec<Message>) -> Result<BuiltTx> {
        build_hybrid_tx(BuildHybridTxParams {
            private_key: self.private_key.clone(),
            public_key: self.public_key.clone(),
            pqc_secret_key: self.pqc_secret_key.clone(),
            pqc_public_key: self.pqc_public_key.clone(),
            messages,
            fee: self.fee.clone(),
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
            sequence: self.sequence,
            memo: String::new(),
            timeout_height: 0,
            include_pqc_public_key: false,
        })
    }

    /// Builds, signs, and broadcasts a hybrid transaction over the given messages,
    /// returning the REST broadcast response JSON.
    pub async fn send_hybrid(&self, messages: Vec<Message>) -> Result<Value> {
        let built = self.build_hybrid(messages)?;
        broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await
    }

    /// Rotates the account's PQC key via `MsgMigratePQCKey`, broadcasting the tx
    /// and returning the REST broadcast response JSON.
    ///
    /// The chain proves ownership of BOTH the old and new keys (the caller
    /// supplies `old_signature` / `new_signature` per the chain's migration
    /// contract), so key rotation never strands an account. `new_algorithm_id`
    /// defaults to [`ALGORITHM_DILITHIUM5`] when `0`.
    pub async fn migrate_pqc_key(&self, opts: &MigrateKeyOptions) -> Result<Value> {
        let built = self.build_migrate_pqc_key(opts)?;
        broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await
    }

    /// Builds + signs (but does not broadcast) the `MsgMigratePQCKey` for the
    /// signer.
    pub fn build_migrate_pqc_key(&self, opts: &MigrateKeyOptions) -> Result<BuiltTx> {
        let algorithm_id = if opts.new_algorithm_id == 0 {
            ALGORITHM_DILITHIUM5
        } else {
            opts.new_algorithm_id
        };
        let msg = migrate_pqc_key_any(
            self.sender.clone(),
            opts.old_public_key.clone(),
            opts.new_public_key.clone(),
            algorithm_id,
            opts.old_signature.clone(),
            opts.new_signature.clone(),
        );
        send_messages(SendMessagesParams {
            private_key: self.private_key.clone(),
            public_key: self.public_key.clone(),
            messages: vec![msg],
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
            sequence: self.sequence,
            fee: self.fee.clone(),
            memo: String::new(),
            timeout_height: 0,
        })
    }

    fn key_type(&self) -> String {
        if self.key_type.is_empty() {
            DEFAULT_KEY_TYPE.to_string()
        } else {
            self.key_type.clone()
        }
    }

    fn require_qor(&self, ctx: &str) -> Result<&QorClient> {
        self.qor.as_ref().ok_or_else(|| {
            Error::MissingEndpoint(format!("qor (pqc_dx.{ctx} requires a QorClient)"))
        })
    }
}

/// Options for [`PqcDx::migrate_pqc_key`] (PQC key rotation, `MsgMigratePQCKey`).
#[derive(Debug, Clone, Default)]
pub struct MigrateKeyOptions {
    /// The current (old) PQC public key being rotated out.
    pub old_public_key: Vec<u8>,
    /// The new PQC public key to register.
    pub new_public_key: Vec<u8>,
    /// The new key's algorithm id. `0` defaults to [`ALGORITHM_DILITHIUM5`].
    pub new_algorithm_id: u32,
    /// Signature by the OLD key proving ownership of the rotation request.
    pub old_signature: Vec<u8>,
    /// Signature by the NEW key proving ownership of the new key.
    pub new_signature: Vec<u8>,
}

/// A hybrid send path returned by [`PqcDx::migrate_to_hybrid`]: the PQC key is
/// guaranteed registered, and the bound [`PqcDx`] builds / broadcasts hybrid
/// (classical + ML-DSA-87) transactions.
#[derive(Debug, Clone)]
pub struct HybridSendPath {
    /// Whether the PQC key was already registered before this call.
    pub already_registered: bool,
    /// The registration tx hash, when a registration was broadcast.
    pub registration_tx_hash: Option<String>,
    /// The bound DX context (PQC key material pre-bound).
    pub dx: PqcDx,
}

impl HybridSendPath {
    /// Builds + signs a hybrid tx over the given messages (PQC key pre-bound).
    pub fn build_hybrid(&self, messages: Vec<Message>) -> Result<BuiltTx> {
        self.dx.build_hybrid(messages)
    }

    /// Builds, signs, and broadcasts a hybrid tx over the given messages (PQC key
    /// pre-bound), returning the REST broadcast response JSON.
    pub async fn send_hybrid(&self, messages: Vec<Message>) -> Result<Value> {
        self.dx.send_hybrid(messages).await
    }
}

/// Truthy-coerce a JSON value the chain may return as bool / number / string.
fn as_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().map(|i| i != 0).unwrap_or(false),
        Value::String(s) => s == "true" || s == "1",
        _ => false,
    }
}

/// Parse a numeric field the chain may return as a number or a string into a
/// `u8` algorithm id.
fn as_u8(v: &Value) -> Option<u8> {
    match v {
        Value::Number(n) => n.as_u64().and_then(|x| u8::try_from(x).ok()),
        Value::String(s) => s.trim().parse::<u8>().ok(),
        _ => None,
    }
}

/// Decode a pubkey the chain may return as a hex string (with/without `0x`), a
/// base64 string, or a JSON array of byte values.
fn decode_pubkey(v: &Value) -> Option<Vec<u8>> {
    match v {
        Value::String(s) if s.is_empty() => None,
        Value::String(s) => {
            let trimmed = s.strip_prefix("0x").unwrap_or(s);
            if let Ok(bytes) = hex::decode(trimmed) {
                return Some(bytes);
            }
            use base64::engine::general_purpose::STANDARD as BASE64;
            use base64::Engine;
            BASE64.decode(s).ok()
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for it in items {
                let b = it.as_u64().and_then(|x| u8::try_from(x).ok())?;
                out.push(b);
            }
            Some(out)
        }
        _ => None,
    }
}

/// Normalizes the rich `qor_getPQCKeyStatus` JSON object into a [`PqcStatus`].
fn parse_pqc_status(raw: &Value) -> PqcStatus {
    let obj = match raw {
        Value::Object(_) => raw,
        _ => return PqcStatus::default(),
    };

    let registered = ["registered", "isRegistered", "is_registered"]
        .iter()
        .find_map(|k| obj.get(*k))
        .map(as_bool)
        .unwrap_or(false);

    let algorithm_id = ["algorithmId", "algorithm_id"]
        .iter()
        .find_map(|k| obj.get(*k))
        .and_then(as_u8);

    let pubkey = ["pubkey", "publicKey", "public_key"]
        .iter()
        .find_map(|k| obj.get(*k))
        .and_then(decode_pubkey);

    PqcStatus {
        registered,
        algorithm_id,
        pubkey,
    }
}

/// Extracts the broadcast tx hash from a REST `/cosmos/tx/v1beta1/txs` response.
fn extract_tx_hash(resp: &Value) -> Option<String> {
    resp.get("tx_response")
        .and_then(|r| r.get("txhash"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_status_registered_snake_case() {
        let raw = json!({ "registered": true, "algorithm_id": 1, "public_key": "0xdeadbeef" });
        let s = parse_pqc_status(&raw);
        assert!(s.registered);
        assert_eq!(s.algorithm_id, Some(1));
        assert_eq!(s.pubkey, Some(vec![0xde, 0xad, 0xbe, 0xef]));
    }

    #[test]
    fn parse_status_camel_case_and_string_fields() {
        let raw = json!({ "isRegistered": "true", "algorithmId": "1" });
        let s = parse_pqc_status(&raw);
        assert!(s.registered);
        assert_eq!(s.algorithm_id, Some(1));
        assert_eq!(s.pubkey, None);
    }

    #[test]
    fn parse_status_unregistered_and_unknown_shapes() {
        assert!(!parse_pqc_status(&json!({ "registered": false })).registered);
        assert_eq!(parse_pqc_status(&Value::Null), PqcStatus::default());
        assert_eq!(parse_pqc_status(&json!("nope")), PqcStatus::default());
    }

    #[test]
    fn pubkey_decodes_base64_and_array() {
        // "AQID" is base64 for [1,2,3]; it is not valid hex, so base64 wins.
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": "AQID" }));
        assert_eq!(s.pubkey, Some(vec![1, 2, 3]));
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": [4, 5, 6] }));
        assert_eq!(s.pubkey, Some(vec![4, 5, 6]));
    }

    #[test]
    fn extract_tx_hash_reads_nested_field() {
        assert_eq!(
            extract_tx_hash(&json!({ "tx_response": { "txhash": "ABC123" } })),
            Some("ABC123".to_string())
        );
        assert_eq!(extract_tx_hash(&json!({ "tx_response": { "txhash": "" } })), None);
        assert_eq!(extract_tx_hash(&json!({})), None);
    }
}
