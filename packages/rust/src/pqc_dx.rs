//! High-level developer-experience helper for QoreChain's
//! `x/pqc` module.
//!
//! QoreChain treats post-quantum cryptography (PQC) as a first-class signature
//! scheme: an account registers an ML-DSA-87 (Dilithium-5) key on-chain
//! (`MsgRegisterPQCKeyV2`), after which its transactions can carry a hybrid
//! (classical secp256k1 + ML-DSA-87) signature that the ante handler verifies in
//! full. The low-level primitives already exist - [`generate_pqc_keypair`](crate::pqc::generate_pqc_keypair),
//! [`build_hybrid_tx`](crate::tx::build_hybrid_tx), the `msg::pqc` composers, and
//! the `qor_getPQCKeyStatus` read. This module wraps them into a tiny, idempotent
//! surface: one call registers the signer's ML-DSA-87 key, and native-lane
//! transactions are then **hybrid-signed by default**.
//!
//! It mirrors the canonical TypeScript SDK's `pqc` DX surface and follows the
//! explicit signer/account-context idiom of the parallel [`CrossVm`](crate::cross_vm::CrossVm)
//! helper: construct a [`PqcDx`] with the signer's key material and account
//! context (chain id, account number, sequence), then:
//!
//! - [`PqcDx::is_pqc_registered`] / [`PqcDx::get_pqc_status`] - read whether an
//!   address has a registered PQC key (via `qor_getPQCKeyStatus`).
//! - [`PqcDx::ensure_pqc_registered`] - register the signer's Dilithium key if
//!   (and only if) it is not already registered. Idempotent: safe to call on
//!   every app start.
//! - [`PqcDx::migrate_to_hybrid`] - ensure registration, then expose a hybrid
//!   send path (build a hybrid tx with the bound PQC keypair).
//! - [`PqcDx::migrate_pqc_key`] - rotate an account's PQC key
//!   (`MsgMigratePQCKey`).
//!
//! ## Sign-bytes version
//!
//! The hybrid ML-DSA-87 signature covers the per-network sign-bytes (v1 or v2,
//! see [`crate::signbytes`]). [`PqcDx::sign_bytes`] defaults to
//! [`SignBytesMode::Auto`]: the async send paths ask [`PqcDx::rest_url`] whether
//! the v2 upgrade (`v3.2.0` / `v3.1.98`) is applied (cached ~60 s) and, if the chain refuses the
//! tx with `pqc` code 21, re-resolve and retry exactly once. The sync
//! [`PqcDx::build_hybrid`] cannot ask the node, so on `qorechain-vladi` /
//! `qorechain-diana` it needs an explicit `V1` / `V2` (or use
//! [`PqcDx::build_hybrid_with_version`] after [`PqcDx::resolve_sign_bytes_version`]).
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
use crate::msg::pqc::migrate_pqc_key_any;
use crate::pqc::ALGORITHM_DILITHIUM5;
use crate::query::QorClient;
use crate::signbytes::{
    broadcast_with_sign_bytes_retry, default_sign_bytes_resolver, require_sign_bytes_version,
    HybridBroadcast, SignBytesMode, SignBytesVersion,
};
use crate::tx::{
    broadcast, build_hybrid_tx, send_messages, BroadcastMode, BuildHybridTxParams, BuiltTx, Fee,
    Message, SendMessagesParams,
};
use serde_json::Value;

/// EVM precompile address for the `pqcKeyStatus` read (documented alternative to
/// the `qor_getPQCKeyStatus` JSON-RPC method used by this module).
pub const PQC_KEY_STATUS_PRECOMPILE: &str = "0x0000000000000000000000000000000000000A02";

/// The default key-type tag forwarded to `MsgRegisterPQCKeyV2`.
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
    /// Whether the key was proven by a proof of possession (chain v3.2.4): a
    /// registration carrying a valid proof, or a rotation or migration.
    /// `Some(false)` for a key registered without one; `None` on nodes below
    /// v3.2.4 (and from `qor_getPQCKeyStatus`, which does not carry it).
    pub possession_proven: Option<bool>,
}

/// The result of [`PqcDx::ensure_pqc_registered`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsureResult {
    /// `true` when the key was already registered (no transaction was sent).
    pub already_registered: bool,
    /// Whether the registered key was compared with
    /// [`PqcDx::pqc_public_key`] and matched: `Some(true)` when it was,
    /// `Some(false)` when the account has a key and no answer carried it, so
    /// it could not be checked (do not assume it is yours). `None` when a
    /// registration was sent.
    pub key_verified: Option<bool>,
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
    /// The signer's ML-DSA-87 (Dilithium-5) public key - the Dilithium key
    /// registered on-chain.
    pub pqc_public_key: Vec<u8>,
    /// The signer's ML-DSA-87 (Dilithium-5) secret key - the post-quantum half
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
    /// The key-type tag forwarded to `MsgRegisterPQCKeyV2`. Defaults to
    /// [`DEFAULT_KEY_TYPE`] when empty.
    pub key_type: String,
    /// The REST (LCD) URL used to broadcast (`/cosmos/tx/v1beta1/txs`).
    pub rest_url: String,
    /// Broadcast mode. Defaults to [`BroadcastMode::Sync`].
    pub mode: BroadcastMode,
    /// Optional `qor_*` client for the status reads / idempotency check.
    pub qor: Option<QorClient>,
    /// Which hybrid sign-bytes form to sign: `Auto` (default; resolved per
    /// network from `rest_url`), or a fixed `V1` / `V2`. See
    /// [`crate::signbytes`].
    pub sign_bytes: SignBytesMode,
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
        parse_pqc_status(&raw)
    }

    /// Registers the signer's PQC key if it is not already registered -
    /// idempotent.
    ///
    /// When the account already has a key, this returns
    /// `EnsureResult { already_registered: true, key_verified: Some(true), .. }`
    /// WITHOUT broadcasting, provided the registered key is
    /// [`PqcDx::pqc_public_key`]. When it is a different key it returns
    /// [`Error::PqcKeyMismatch`] and sends nothing: every hybrid transaction
    /// signed with this keypair would be refused. A cached status that carries
    /// no public key is re-read uncached and compared; when no answer carries
    /// the key the result says `key_verified: Some(false)` instead of claiming
    /// the key is yours (the REST route always carries it). Otherwise it builds
    /// and broadcasts `MsgRegisterPQCKeyV2` with the signer's Dilithium public
    /// key plus its classical ECDSA public key.
    ///
    /// This is the single call that registers the signer's ML-DSA-87 key: run it
    /// once at startup (or before the first hybrid tx) and the account is
    /// PQC-registered thereafter.
    ///
    /// The pre-flight check reads REST from `rest_url` ([`fetch_pqc_status`]);
    /// the `qor_*` JSON-RPC namespace is not exposed on public endpoints. An
    /// unreadable status is an error, never a blind registration: the chain
    /// charges the fee before refusing a second one. Before reporting a
    /// different key, the status is read once more uncached (a rotation may
    /// have just landed). A refusal as "already registered" (`pqc` 7) counts as
    /// `already_registered` once the key on chain is confirmed to be this one
    /// (`key_verified: Some(true)`) or carries none (`Some(false)`); any other
    /// non-zero CheckTx code in the broadcast answer is returned as
    /// [`Error::Tx`].
    pub async fn ensure_pqc_registered(&self) -> Result<EnsureResult> {
        let status = fetch_pqc_status(&self.rest_url, &self.sender).await?;
        if status.registered {
            // Registered, but by whom? A different key means this signer's hybrid
            // transactions would all be refused; say so now rather than "done".
            // A status without the key cannot be compared: re-read it rather
            // than take "registered" for "yours".
            let key_verified = match is_registered_pqc_key(&status, &self.pqc_public_key) {
                Some(true) => true,
                _ => self.check_registered_key_uncached().await?,
            };
            return Ok(EnsureResult {
                already_registered: true,
                key_verified: Some(key_verified),
                tx_hash: None,
            });
        }

        // From chain v3.2.3 the registration carries a proof that the registrant
        // holds the key. Sign it once the network has applied v3.2.3, never
        // before: a node below it refuses the whole transaction for the field.
        let rest = crate::query::RestClient::new(self.rest_url.clone());
        let applied = crate::upgrades::is_upgrade_applied(
            &rest,
            crate::upgrades::CHAIN_UPGRADE_V3_2_3,
            Some(&self.rest_url),
        )
        .await?;
        let proof = if applied {
            self.proof_of_possession()?
        } else {
            Vec::new()
        };
        let built = self.build_register_with_proof_of_possession(proof)?;
        let resp = broadcast(&self.rest_url, &built.tx_raw_bytes, self.mode).await?;
        if is_already_registered(&resp) {
            // The key was registered after all (a race, or a stale answer): fine
            // when it is this signer's key, an error when it is another.
            let key_verified = self.check_registered_key_uncached().await?;
            return Ok(EnsureResult {
                already_registered: true,
                key_verified: Some(key_verified),
                tx_hash: None,
            });
        }
        // Any other refusal is a failure, never a registration.
        if let Some(err) = check_tx_error(&resp) {
            return Err(Error::Tx(err));
        }
        Ok(EnsureResult {
            already_registered: false,
            key_verified: None,
            tx_hash: extract_tx_hash(&resp),
        })
    }

    /// Builds + signs (but does not broadcast) the `MsgRegisterPQCKeyV2` for the
    /// signer.
    ///
    /// Uses `/qorechain.pqc.v1.MsgRegisterPQCKeyV2` - the chain's current
    /// (classical-exempt bootstrap) registration path - with an explicit
    /// `algorithm_id` (ML-DSA-87 / Dilithium-5).
    ///
    /// Useful for inspection, packing into a larger tx, or a deferred-broadcast
    /// flow.
    pub fn build_register(&self) -> Result<BuiltTx> {
        self.build_register_with_proof_of_possession(Vec::new())
    }

    /// The bound key's proof of possession (chain v3.2.3), signed over this
    /// signer's chain id and sender.
    ///
    /// # Errors
    ///
    /// As [`crate::key_integrity::sign_proof_of_possession`].
    pub fn proof_of_possession(&self) -> Result<Vec<u8>> {
        crate::key_integrity::sign_proof_of_possession(
            &self.chain_id,
            &self.sender,
            &self.pqc_public_key,
            &self.pqc_secret_key,
        )
    }

    /// [`PqcDx::build_register`] carrying a proof of possession (from
    /// [`PqcDx::proof_of_possession`]). A node below v3.2.3 refuses the whole
    /// transaction when it is set: use this only once the network has applied
    /// v3.2.3. An empty `proof` leaves the field off the wire.
    ///
    /// # Errors
    ///
    /// When the classical key is not the sender's (refused from v3.2.2), or the
    /// key is `classical_only`, empty or degenerate (refused from v3.2.3) - not
    /// network-gated: such a registration is wrong anywhere.
    pub fn build_register_with_proof_of_possession(&self, proof: Vec<u8>) -> Result<BuiltTx> {
        crate::classical_key::validate_classical_key_for_sender(&self.sender, &self.public_key)?;
        crate::key_integrity::validate_registered_pqc_key(&self.key_type(), &self.pqc_public_key)?;
        let mut register = crate::msg::pqc::register_pqc_key_v2(
            self.sender.clone(),
            self.pqc_public_key.clone(),
            ALGORITHM_DILITHIUM5,
            self.public_key.clone(),
            self.key_type(),
        );
        register.proof_of_possession = proof;
        let msg = crate::msg::to_any(&register, crate::msg::pqc::REGISTER_PQC_KEY_V2);
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

    /// Ensures the signer's PQC key is registered (idempotent - see
    /// [`PqcDx::ensure_pqc_registered`]) and returns a [`HybridSendPath`] with the
    /// bound PQC keypair, ready to build hybrid (classical + ML-DSA-87)
    /// transactions.
    ///
    /// After this call the dApp's transactions can carry a verified hybrid
    /// signature. Fails with [`Error::PqcKeyMismatch`] (nothing sent) when the
    /// account is registered with a different key.
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
    /// The sign-bytes version comes from [`PqcDx::sign_bytes`]. This is a sync,
    /// network-free build, so `Auto` resolves only where no node is needed (v2 on
    /// a chain born with v2); on `qorechain-vladi` / `qorechain-diana` it is an
    /// error - use [`PqcDx::send_hybrid`], or
    /// [`PqcDx::resolve_sign_bytes_version`] + [`PqcDx::build_hybrid_with_version`].
    ///
    /// On-chain prerequisite: the signer's PQC key must already be registered
    /// (call [`PqcDx::ensure_pqc_registered`] first, or use
    /// [`PqcDx::migrate_to_hybrid`]).
    pub fn build_hybrid(&self, messages: Vec<Message>) -> Result<BuiltTx> {
        let version = require_sign_bytes_version(&self.chain_id, self.sign_bytes.fixed())?;
        self.build_hybrid_with_version(messages, version)
    }

    /// Builds + signs (but does not broadcast) a hybrid transaction framed with
    /// the given sign-bytes `version`.
    pub fn build_hybrid_with_version(
        &self,
        messages: Vec<Message>,
        version: SignBytesVersion,
    ) -> Result<BuiltTx> {
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
            sign_bytes_version: Some(version),
        })
    }

    /// Resolves [`PqcDx::sign_bytes`] for this chain (asking [`PqcDx::rest_url`]
    /// when `Auto` on a legacy chain; cached by the process-wide resolver).
    pub async fn resolve_sign_bytes_version(&self) -> Result<SignBytesVersion> {
        default_sign_bytes_resolver()
            .resolve(self.sign_bytes, &self.chain_id, Some(&self.rest_url))
            .await
    }

    /// Builds, signs, and broadcasts a hybrid transaction over the given messages,
    /// returning the REST broadcast response JSON.
    ///
    /// See [`PqcDx::send_hybrid_detailed`] for the version resolution and the
    /// one-shot retry on a `pqc` code-21 refusal.
    pub async fn send_hybrid(&self, messages: Vec<Message>) -> Result<Value> {
        Ok(self.send_hybrid_detailed(messages).await?.response)
    }

    /// Builds, signs, and broadcasts a hybrid transaction, returning the
    /// response together with the sign-bytes version used.
    ///
    /// With [`SignBytesMode::Auto`] the version is resolved from
    /// [`PqcDx::rest_url`]; if the broadcast is refused as "hybrid PQC signature
    /// verification failed" (`pqc` code 21), the version is force-refreshed and
    /// the tx re-signed and broadcast exactly once more. A fixed `V1` / `V2` is
    /// never retried.
    pub async fn send_hybrid_detailed(&self, messages: Vec<Message>) -> Result<HybridBroadcast> {
        let rest_url = self.rest_url.as_str();
        let mode = self.mode;
        broadcast_with_sign_bytes_retry(
            default_sign_bytes_resolver(),
            self.sign_bytes,
            &self.chain_id,
            Some(rest_url),
            |version| {
                self.build_hybrid_with_version(messages.clone(), version)
                    .map(|b| b.tx_raw_bytes)
            },
            |tx| async move { broadcast(rest_url, &tx, mode).await },
        )
        .await
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

    /// Reads the status once more, bypassing the cache, and fails with
    /// [`Error::PqcKeyMismatch`] when the account is registered with a key other
    /// than [`PqcDx::pqc_public_key`].
    /// Re-reads the status uncached: [`Error::PqcKeyMismatch`] when the key on
    /// chain is another, otherwise whether it was compared and matched
    /// (`false` when the answer carries no key).
    async fn check_registered_key_uncached(&self) -> Result<bool> {
        forget_pqc_status(&self.rest_url, &self.sender);
        let now = fetch_pqc_status(&self.rest_url, &self.sender).await?;
        let matched = is_registered_pqc_key(&now, &self.pqc_public_key);
        if now.registered && matched == Some(false) {
            return Err(PqcKeyMismatchError::new(
                &self.sender,
                pqc_status_public_key(&now).unwrap_or_default().to_vec(),
                self.pqc_public_key.clone(),
            )
            .into());
        }
        Ok(matched == Some(true))
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
///
/// `old_signature` / `new_signature` are ML-DSA signatures over the per-network
/// migration sign-bytes - build them with
/// [`crate::signbytes::migration_sign_bytes`] using the version the chain
/// verifies (v1 binds no public keys; v2 binds both).
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
    /// See [`PqcDx::build_hybrid`] for the sign-bytes version rule.
    pub fn build_hybrid(&self, messages: Vec<Message>) -> Result<BuiltTx> {
        self.dx.build_hybrid(messages)
    }

    /// Builds, signs, and broadcasts a hybrid tx, returning the response and the
    /// sign-bytes version used (see [`PqcDx::send_hybrid_detailed`]).
    pub async fn send_hybrid_detailed(&self, messages: Vec<Message>) -> Result<HybridBroadcast> {
        self.dx.send_hybrid_detailed(messages).await
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
/// base64 string (standard or URL-safe; the REST route answers base64), or a
/// JSON array of byte values.
fn decode_pubkey(v: &Value) -> Option<Vec<u8>> {
    match v {
        Value::String(s) if s.is_empty() => None,
        Value::String(s) => {
            let trimmed = s
                .strip_prefix("0x")
                .or_else(|| s.strip_prefix("0X"))
                .unwrap_or(s);
            if let Ok(bytes) = hex::decode(trimmed) {
                return Some(bytes);
            }
            use base64::engine::general_purpose::{
                STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD,
            };
            use base64::Engine;
            [STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD]
                .iter()
                .find_map(|engine| engine.decode(s).ok())
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
fn parse_pqc_status(raw: &Value) -> Result<PqcStatus> {
    // No answer is not "not registered": reading it that way makes a client
    // re-register a key the chain already has, and pay the fee each time.
    let known = [
        "registered",
        "isRegistered",
        "is_registered",
        "has_pqc_key",
        "pubkey",
        "publicKey",
        "public_key",
    ];
    let obj = match raw {
        Value::Object(o) if known.iter().any(|k| o.contains_key(*k)) => raw,
        _ => {
            return Err(Error::InvalidResponse(
                "qor_getPQCKeyStatus gave no usable answer; cannot tell whether a PQC key is registered"
                    .into(),
            ))
        }
    };

    let registered = ["registered", "isRegistered", "is_registered", "has_pqc_key"]
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

    // A non-empty key implies registration even if the flag is absent.
    let registered = registered || pubkey.as_ref().is_some_and(|k| !k.is_empty());
    Ok(PqcStatus {
        registered,
        algorithm_id,
        pubkey,
        possession_proven: None,
    })
}

/// The registered public key carried by a [`PqcStatus`], as bytes: the REST
/// route returns it base64, `qor_getPQCKeyStatus` hex; both are decoded when
/// the status is read. `None` when the status carries no key (or an empty one).
pub fn pqc_status_public_key(status: &PqcStatus) -> Option<&[u8]> {
    status.pubkey.as_deref().filter(|k| !k.is_empty())
}

/// Whether the key a [`PqcStatus`] reports registered is `public_key`:
/// `Some(true)` / `Some(false)`, or `None` when the status carries no readable
/// key. An unregistered status is `Some(false)`.
pub fn is_registered_pqc_key(status: &PqcStatus, public_key: &[u8]) -> Option<bool> {
    if !status.registered {
        return Some(false);
    }
    pqc_status_public_key(status).map(|registered| registered == public_key)
}

/// Returned (as [`Error::PqcKeyMismatch`]) by [`PqcDx::ensure_pqc_registered`]
/// and [`PqcDx::migrate_to_hybrid`] when the account already has a PQC key and
/// it is NOT the caller's keypair. Nothing is broadcast: the chain refuses a
/// second registration after charging the fee, and every hybrid transaction
/// signed with the caller's key would be refused. Sign with the keypair that
/// registered the account, or rotate the key (`MsgRotatePQCKey`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PqcKeyMismatchError {
    /// The account.
    pub address: String,
    /// The key registered on chain.
    pub registered_public_key: Vec<u8>,
    /// The caller's key.
    pub public_key: Vec<u8>,
}

impl PqcKeyMismatchError {
    /// A short stable identifier for this error.
    pub const KIND: &'static str = "pqc_key_mismatch";

    /// Builds the error for `address`.
    pub fn new(address: &str, registered_public_key: Vec<u8>, public_key: Vec<u8>) -> Self {
        Self {
            address: address.to_string(),
            registered_public_key,
            public_key,
        }
    }

    /// [`PqcKeyMismatchError::KIND`].
    pub fn kind(&self) -> &'static str {
        Self::KIND
    }
}

impl std::fmt::Display for PqcKeyMismatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} already has a different PQC key registered (registered {}, this keypair {}). \
             Nothing was sent. Sign with the keypair that registered the account, or rotate \
             its key with MsgRotatePQCKey.",
            self.address,
            key_fingerprint(&self.registered_public_key),
            key_fingerprint(&self.public_key),
        )
    }
}

impl std::error::Error for PqcKeyMismatchError {}

/// First 8 bytes of shake256(key), hex: enough to tell two keys apart in a
/// message.
fn key_fingerprint(key: &[u8]) -> String {
    use sha3::digest::{ExtendableOutput, Update, XofReader};
    let mut hasher = sha3::Shake256::default();
    hasher.update(key);
    let mut out = [0u8; 8];
    hasher.finalize_xof().read(&mut out);
    hex::encode(out)
}

/// Positive answers per (rest_url, address), with the key: a registered key
/// stays registered (it may rotate, which is why a mismatch is re-read).
static REGISTERED_CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, PqcStatus>>> =
    std::sync::Mutex::new(None);

fn status_cache_key(rest_url: &str, address: &str) -> String {
    format!("{}|{address}", rest_url.trim_end_matches('/'))
}

/// Drops one cached positive answer.
fn forget_pqc_status(rest_url: &str, address: &str) {
    if let Some(c) = REGISTERED_CACHE.lock().expect("pqc status cache").as_mut() {
        c.remove(&status_cache_key(rest_url, address));
    }
}

/// Reads the PQC registration status over REST
/// (`GET {rest_url}/qorechain/pqc/v1/account/{address}`), the route every
/// public endpoint serves (the `qor_*` JSON-RPC namespace is not exposed
/// publicly).
///
/// The chain answers `{"found": false}` for an account without a key. Anything
/// that is not a readable `found` - an HTTP error, a missing field, a transport
/// failure - is UNKNOWN: retried once, then returned as an error. It is never
/// read as "not registered". A positive answer (with the registered key, from
/// `account.public_key`) is cached per (rest_url, address).
///
/// # Errors
///
/// [`Error::InvalidResponse`] when the status cannot be read.
pub async fn fetch_pqc_status(rest_url: &str, address: &str) -> Result<PqcStatus> {
    let base = rest_url.trim_end_matches('/').to_string();
    let key = status_cache_key(&base, address);
    if let Some(cached) = REGISTERED_CACHE
        .lock()
        .expect("pqc status cache")
        .as_ref()
        .and_then(|c| c.get(&key).cloned())
    {
        return Ok(cached);
    }
    let rest = crate::query::RestClient::new(base.clone());
    let mut last = String::new();
    for _ in 0..2 {
        match rest.get_pqc_account(address).await {
            Ok(body) => match body.get("found").and_then(Value::as_bool) {
                Some(false) => return Ok(PqcStatus::default()),
                Some(true) => {
                    let account = body.get("account");
                    let field =
                        |names: &[&str]| account.and_then(|a| names.iter().find_map(|n| a.get(*n)));
                    let status = PqcStatus {
                        registered: true,
                        algorithm_id: field(&["algorithm_id", "algorithmId", "algorithm"])
                            .and_then(as_u8),
                        pubkey: field(&["public_key", "publicKey"]).and_then(decode_pubkey),
                        possession_proven: field(&["possession_proven", "possessionProven"])
                            .and_then(Value::as_bool),
                    };
                    REGISTERED_CACHE
                        .lock()
                        .expect("pqc status cache")
                        .get_or_insert_with(Default::default)
                        .insert(key, status.clone());
                    return Ok(status);
                }
                None => last = format!("no \"found\" field in the answer for {address}"),
            },
            Err(e) => last = e.to_string(),
        }
    }
    Err(Error::InvalidResponse(format!(
        "cannot tell whether {address} has a registered PQC key: {last}"
    )))
}

/// Forgets cached registration answers (tests, network switches).
pub fn clear_pqc_status_cache() {
    *REGISTERED_CACHE.lock().expect("pqc status cache") = None;
}

/// The chain's refusal of a second registration (`pqc` 7) in a broadcast
/// response: not an error for a helper whose job is "make sure it is
/// registered".
fn is_already_registered(resp: &Value) -> bool {
    let tx = resp.get("tx_response").unwrap_or(resp);
    let log = tx
        .get("raw_log")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if log.contains("pqc account already registered") {
        return true;
    }
    tx.get("codespace").and_then(Value::as_str) == Some("pqc")
        && tx.get("code").and_then(Value::as_u64) == Some(7)
}

/// The decoded error for a non-zero CheckTx code in a REST broadcast response,
/// or `None` when the code is zero or absent. Only the broadcast answer is read:
/// in sync mode a failure inside the block is not known yet.
fn check_tx_error(resp: &Value) -> Option<crate::tx::QoreTxError> {
    let tx = resp.get("tx_response").unwrap_or(resp);
    let code = tx.get("code").and_then(Value::as_u64).unwrap_or(0);
    let codespace = tx.get("codespace").and_then(Value::as_str).unwrap_or("");
    let raw_log = tx.get("raw_log").and_then(Value::as_str).unwrap_or("");
    let mut err =
        crate::tx::decode_tx_error(u32::try_from(code).unwrap_or(u32::MAX), codespace, raw_log)?;
    err.tx_hash = extract_tx_hash(resp).unwrap_or_default();
    Some(err)
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
        let s = parse_pqc_status(&raw).unwrap();
        assert!(s.registered);
        assert_eq!(s.algorithm_id, Some(1));
        assert_eq!(s.pubkey, Some(vec![0xde, 0xad, 0xbe, 0xef]));
    }

    #[test]
    fn parse_status_camel_case_and_string_fields() {
        let raw = json!({ "isRegistered": "true", "algorithmId": "1" });
        let s = parse_pqc_status(&raw).unwrap();
        assert!(s.registered);
        assert_eq!(s.algorithm_id, Some(1));
        assert_eq!(s.pubkey, None);
    }

    #[test]
    fn parse_status_unregistered_and_unknown_shapes() {
        assert!(
            !parse_pqc_status(&json!({ "registered": false }))
                .unwrap()
                .registered
        );
        // No usable answer is an error, never "not registered".
        assert!(parse_pqc_status(&Value::Null).is_err());
        assert!(parse_pqc_status(&json!("nope")).is_err());
        assert!(parse_pqc_status(&json!({})).is_err());
    }

    #[test]
    fn pubkey_decodes_base64_and_array() {
        // "AQID" is base64 for [1,2,3]; it is not valid hex, so base64 wins.
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": "AQID" })).unwrap();
        assert_eq!(s.pubkey, Some(vec![1, 2, 3]));
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": [4, 5, 6] })).unwrap();
        assert_eq!(s.pubkey, Some(vec![4, 5, 6]));
    }

    #[test]
    fn pubkey_decodes_url_safe_base64_and_uppercase_hex_prefix() {
        // [0xfb, 0xff] is "+/8=" in standard base64 and "-_8=" URL-safe.
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": "-_8=" })).unwrap();
        assert_eq!(s.pubkey, Some(vec![0xfb, 0xff]));
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": "+/8" })).unwrap();
        assert_eq!(s.pubkey, Some(vec![0xfb, 0xff]));
        let s = parse_pqc_status(&json!({ "registered": true, "pubkey": "0XABCD" })).unwrap();
        assert_eq!(s.pubkey, Some(vec![0xab, 0xcd]));
    }

    #[test]
    fn registered_key_is_compared_from_hex_or_base64() {
        let mine = crate::pqc::pqc_keypair_from_seed(&[2u8; 32]).public_key;
        let other = crate::pqc::pqc_keypair_from_seed(&[3u8; 32]).public_key;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&other);
        let hex_other = format!("0x{}", hex::encode(&other));
        for raw in [b64, hex_other] {
            let s = parse_pqc_status(&json!({ "registered": true, "public_key": raw })).unwrap();
            assert_eq!(pqc_status_public_key(&s), Some(other.as_slice()));
            assert_eq!(is_registered_pqc_key(&s, &other), Some(true));
            assert_eq!(is_registered_pqc_key(&s, &mine), Some(false));
        }
        // No key to compare: unknown, not a mismatch.
        let keyless = PqcStatus {
            registered: true,
            ..PqcStatus::default()
        };
        assert_eq!(is_registered_pqc_key(&keyless, &mine), None);
        let empty = PqcStatus {
            registered: true,
            pubkey: Some(Vec::new()),
            ..PqcStatus::default()
        };
        assert_eq!(is_registered_pqc_key(&empty, &mine), None);
        assert_eq!(
            is_registered_pqc_key(&PqcStatus::default(), &mine),
            Some(false)
        );
    }

    #[test]
    fn key_mismatch_error_names_both_fingerprints() {
        let e = PqcKeyMismatchError::new("qor1abc", vec![1, 2, 3], vec![4, 5, 6]);
        assert_eq!(e.kind(), "pqc_key_mismatch");
        let msg = Error::from(e.clone()).to_string();
        assert!(msg.starts_with("qor1abc already has a different PQC key registered (registered "));
        assert!(msg.contains(&key_fingerprint(&[1, 2, 3])));
        assert!(msg.contains(&format!("this keypair {})", key_fingerprint(&[4, 5, 6]))));
        assert!(msg.ends_with(
            "Nothing was sent. Sign with the keypair that registered the account, or rotate its key with MsgRotatePQCKey."
        ));
        assert_eq!(key_fingerprint(&[1, 2, 3]), "aa79c890c9483a63");
    }

    #[test]
    fn already_registered_refusal_is_recognised() {
        assert!(is_already_registered(&json!({ "tx_response": {
            "code": 7, "codespace": "pqc", "raw_log": "PQC account already registered" } })));
        assert!(is_already_registered(
            &json!({ "tx_response": { "code": 7, "codespace": "pqc" } })
        ));
        assert!(!is_already_registered(
            &json!({ "tx_response": { "code": 7, "codespace": "bank" } })
        ));
        assert!(!is_already_registered(
            &json!({ "tx_response": { "code": 0 } })
        ));
    }

    #[test]
    fn extract_tx_hash_reads_nested_field() {
        assert_eq!(
            extract_tx_hash(&json!({ "tx_response": { "txhash": "ABC123" } })),
            Some("ABC123".to_string())
        );
        assert_eq!(
            extract_tx_hash(&json!({ "tx_response": { "txhash": "" } })),
            None
        );
        assert_eq!(extract_tx_hash(&json!({})), None);
    }
}
