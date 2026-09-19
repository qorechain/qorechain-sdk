//! Per-network post-quantum sign-bytes: the v1 / v2 forms, the rule that picks
//! one for a chain, and a cached resolver that asks the node.
//!
//! Chain release `v3.1.98` changed three payloads an ML-DSA key signs:
//!
//! | payload | v1 (legacy) | v2 |
//! |---|---|---|
//! | hybrid tx | `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` | `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖ chainID ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A` |
//! | key migration | ASCII `qorechain-key-migration:chain=…:from=…:to=…:account=…:height=…` | `"qorechain-key-migration-v2" ‖ BE64(len chainID) ‖ chainID ‖ BE64(len account) ‖ account ‖ BE32(from) ‖ BE32(to) ‖ BE64(height) ‖ BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub` |
//! | bridge attestation | ASCII `chain\|eventType\|operationID\|txHash\|amount\|asset` | `"qorechain-bridge-attestation-v2"` then `BE64(len f) ‖ f` for `f` in `[chainID, chain, eventType, operationID, txHash, amount, asset]` |
//!
//! All lengths are big-endian, strings are UTF-8, nothing is terminated. `B0`
//! is the `TxBody` WITHOUT the PQC extension; `A` is the `AuthInfo` bytes.
//!
//! A network verifies exactly ONE form. The networks that existed before v2
//! (`qorechain-vladi`, `qorechain-diana`) keep verifying v1 until the
//! [`SIGN_BYTES_V2_UPGRADE`] plan is applied on them; any other chain verifies
//! v2 from its first block. Today the testnet has applied the upgrade (v2) and
//! the mainnet has not (v1). [`sign_bytes_version_for`] is the client-side
//! mirror of the chain's switch, and [`SignBytesResolver`] asks a node's REST
//! endpoint (`/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`) for the height it
//! needs, caching the answer briefly because a network can upgrade while a
//! wallet is open.
//!
//! The resolver never guesses: a legacy chain with no REST URL, or a failed
//! query, is an error that asks for a REST URL or an explicit
//! [`SignBytesMode::V1`] / [`SignBytesMode::V2`].

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::{Error, Result};
use crate::query::RestClient;

/// Domain tag that opens the v2 hybrid-tx sign-bytes.
pub const HYBRID_SIGN_BYTES_DOMAIN: &str = "qorechain-pqc-hybrid-v2";

/// Domain tag that opens the v2 key-migration sign-bytes.
pub const MIGRATION_SIGN_BYTES_DOMAIN: &str = "qorechain-key-migration-v2";

/// Domain tag that opens the v2 bridge-attestation sign-bytes.
pub const BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN: &str = "qorechain-bridge-attestation-v2";

/// The upgrade plan whose application switches a legacy chain from v1 to v2.
pub const SIGN_BYTES_V2_UPGRADE: &str = "v3.1.98";

/// The chains that were running before v2 existed; they switch to v2 only once
/// [`SIGN_BYTES_V2_UPGRADE`] is applied on them.
pub const LEGACY_SIGN_BYTES_CHAINS: &[&str] = &["qorechain-vladi", "qorechain-diana"];

/// How long a resolved version is cached per `(rest_url, chain_id)` by default.
pub const DEFAULT_SIGN_BYTES_CACHE_TTL: Duration = Duration::from_secs(60);

/// The codespace of the chain's PQC module.
pub const PQC_CODESPACE: &str = "pqc";

/// The PQC module's error code for a hybrid signature that does not verify.
pub const PQC_HYBRID_VERIFY_FAILED_CODE: u32 = 21;

/// The chain's message for [`PQC_HYBRID_VERIFY_FAILED_CODE`].
pub const PQC_HYBRID_VERIFY_FAILED_MESSAGE: &str = "hybrid PQC signature verification failed";

/// A concrete sign-bytes form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignBytesVersion {
    /// The legacy form (no domain tag, no chain id).
    V1,
    /// The domain-tagged, chain-bound form introduced by `v3.1.98`.
    V2,
}

impl SignBytesVersion {
    /// The version number (`1` or `2`), as the chain's CLI reports it.
    pub fn number(self) -> u8 {
        match self {
            SignBytesVersion::V1 => 1,
            SignBytesVersion::V2 => 2,
        }
    }

    /// The option spelling (`"v1"` / `"v2"`).
    pub fn as_str(self) -> &'static str {
        match self {
            SignBytesVersion::V1 => "v1",
            SignBytesVersion::V2 => "v2",
        }
    }
}

impl fmt::Display for SignBytesVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for SignBytesVersion {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "v1" => Ok(SignBytesVersion::V1),
            "v2" => Ok(SignBytesVersion::V2),
            other => Err(Error::SignBytes(format!(
                "sign-bytes version must be v1 or v2, got {other:?}"
            ))),
        }
    }
}

/// The caller's choice of sign-bytes: a fixed version, or `Auto` (ask the chain).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SignBytesMode {
    /// Resolve per network (see [`SignBytesResolver::resolve`]). The default.
    #[default]
    Auto,
    /// Always sign v1. No network call.
    V1,
    /// Always sign v2. No network call.
    V2,
}

impl SignBytesMode {
    /// The fixed version this mode names, or `None` for `Auto`.
    pub fn fixed(self) -> Option<SignBytesVersion> {
        match self {
            SignBytesMode::Auto => None,
            SignBytesMode::V1 => Some(SignBytesVersion::V1),
            SignBytesMode::V2 => Some(SignBytesVersion::V2),
        }
    }
}

impl From<SignBytesVersion> for SignBytesMode {
    fn from(v: SignBytesVersion) -> Self {
        match v {
            SignBytesVersion::V1 => SignBytesMode::V1,
            SignBytesVersion::V2 => SignBytesMode::V2,
        }
    }
}

impl fmt::Display for SignBytesMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SignBytesMode::Auto => "auto",
            SignBytesMode::V1 => "v1",
            SignBytesMode::V2 => "v2",
        })
    }
}

impl FromStr for SignBytesMode {
    type Err = Error;

    /// Parses `"auto"`, `"v1"` or `"v2"` (the empty string means `"auto"`, as in
    /// the chain CLI's `--sign-bytes` flag).
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "" | "auto" => Ok(SignBytesMode::Auto),
            "v1" => Ok(SignBytesMode::V1),
            "v2" => Ok(SignBytesMode::V2),
            other => Err(Error::SignBytes(format!(
                "sign-bytes mode must be auto, v1 or v2, got {other:?}"
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// Version selection
// ---------------------------------------------------------------------------

/// Whether `chain_id` is one of the [`LEGACY_SIGN_BYTES_CHAINS`].
pub fn is_legacy_sign_bytes_chain(chain_id: &str) -> bool {
    LEGACY_SIGN_BYTES_CHAINS.contains(&chain_id)
}

/// The form a client must sign for `chain_id`, given the height at which
/// [`SIGN_BYTES_V2_UPGRADE`] was applied there (`0` when it has not been).
///
/// Mirrors the chain's `SignBytesVersionFor`: v2 when the upgrade is applied or
/// the chain is not a legacy chain, v1 otherwise.
pub fn sign_bytes_version_for(chain_id: &str, v2_applied_height: i64) -> SignBytesVersion {
    if v2_applied_height > 0 || !is_legacy_sign_bytes_chain(chain_id) {
        SignBytesVersion::V2
    } else {
        SignBytesVersion::V1
    }
}

/// The version a synchronous (network-free) builder uses: `version` when given;
/// otherwise v2 for a non-legacy chain. A legacy chain with no version is an
/// error — the builder cannot know whether the upgrade is applied, and it never
/// silently falls back to v1.
pub fn require_sign_bytes_version(
    chain_id: &str,
    version: Option<SignBytesVersion>,
) -> Result<SignBytesVersion> {
    match version {
        Some(v) => Ok(v),
        None if !is_legacy_sign_bytes_chain(chain_id) => Ok(SignBytesVersion::V2),
        None => Err(Error::SignBytes(format!(
            "chain {chain_id:?} verifies hybrid sign-bytes v1 until upgrade \
             {SIGN_BYTES_V2_UPGRADE} is applied and v2 after it, so the version cannot be \
             chosen offline: pass an explicit sign-bytes version (v1 or v2), or resolve one \
             with SignBytesResolver / an async sign-and-broadcast path given a REST URL"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Hybrid tx sign-bytes
// ---------------------------------------------------------------------------

/// v1 hybrid sign-bytes: `BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A`.
pub fn hybrid_sign_bytes_v1(body_without_pqc_ext: &[u8], auth_info: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + body_without_pqc_ext.len() + auth_info.len());
    push_be32_prefixed(&mut out, body_without_pqc_ext);
    push_be32_prefixed(&mut out, auth_info);
    out
}

/// v2 hybrid sign-bytes: `"qorechain-pqc-hybrid-v2" ‖ BE64(len chainID) ‖
/// chainID ‖ BE32(len B0) ‖ B0 ‖ BE32(len A) ‖ A`.
pub fn hybrid_sign_bytes_v2(
    chain_id: &str,
    body_without_pqc_ext: &[u8],
    auth_info: &[u8],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        HYBRID_SIGN_BYTES_DOMAIN.len()
            + 8
            + chain_id.len()
            + 8
            + body_without_pqc_ext.len()
            + auth_info.len(),
    );
    out.extend_from_slice(HYBRID_SIGN_BYTES_DOMAIN.as_bytes());
    push_be64_prefixed(&mut out, chain_id.as_bytes());
    push_be32_prefixed(&mut out, body_without_pqc_ext);
    push_be32_prefixed(&mut out, auth_info);
    out
}

/// The hybrid sign-bytes in the given form (`chain_id` is ignored by v1).
pub fn hybrid_sign_bytes(
    version: SignBytesVersion,
    chain_id: &str,
    body_without_pqc_ext: &[u8],
    auth_info: &[u8],
) -> Vec<u8> {
    match version {
        SignBytesVersion::V1 => hybrid_sign_bytes_v1(body_without_pqc_ext, auth_info),
        SignBytesVersion::V2 => hybrid_sign_bytes_v2(chain_id, body_without_pqc_ext, auth_info),
    }
}

// ---------------------------------------------------------------------------
// Key-migration sign-bytes
// ---------------------------------------------------------------------------

/// The fields both keys sign in an algorithm migration (`MsgMigratePQCKey`).
#[derive(Debug, Clone, Copy)]
pub struct MigrationSignFields<'a> {
    /// The chain id.
    pub chain_id: &'a str,
    /// The bech32 account being migrated.
    pub account: &'a str,
    /// The algorithm id migrated from.
    pub from_algorithm_id: u32,
    /// The algorithm id migrated to.
    pub to_algorithm_id: u32,
    /// The execution height (learned from the chain; stops later replay).
    pub execution_height: i64,
    /// The old public key (bound by v2 only).
    pub old_public_key: &'a [u8],
    /// The new public key (bound by v2 only).
    pub new_public_key: &'a [u8],
}

/// v1 (legacy) migration sign-bytes: the ASCII string
/// `qorechain-key-migration:chain=<chain>:from=<from>:to=<to>:account=<account>:height=<height>`.
/// The public keys are NOT bound by this form.
pub fn migration_sign_bytes_v1(f: &MigrationSignFields<'_>) -> Vec<u8> {
    format!(
        "qorechain-key-migration:chain={}:from={}:to={}:account={}:height={}",
        f.chain_id, f.from_algorithm_id, f.to_algorithm_id, f.account, f.execution_height
    )
    .into_bytes()
}

/// v2 migration sign-bytes: `"qorechain-key-migration-v2" ‖ BE64(len chainID) ‖
/// chainID ‖ BE64(len account) ‖ account ‖ BE32(from) ‖ BE32(to) ‖ BE64(height) ‖
/// BE32(len oldPub) ‖ oldPub ‖ BE32(len newPub) ‖ newPub`.
pub fn migration_sign_bytes_v2(f: &MigrationSignFields<'_>) -> Vec<u8> {
    let mut out = Vec::with_capacity(
        MIGRATION_SIGN_BYTES_DOMAIN.len()
            + 8
            + f.chain_id.len()
            + 8
            + f.account.len()
            + 16
            + 8
            + f.old_public_key.len()
            + f.new_public_key.len(),
    );
    out.extend_from_slice(MIGRATION_SIGN_BYTES_DOMAIN.as_bytes());
    push_be64_prefixed(&mut out, f.chain_id.as_bytes());
    push_be64_prefixed(&mut out, f.account.as_bytes());
    out.extend_from_slice(&f.from_algorithm_id.to_be_bytes());
    out.extend_from_slice(&f.to_algorithm_id.to_be_bytes());
    // The chain encodes the int64 height as uint64 (two's complement).
    out.extend_from_slice(&(f.execution_height as u64).to_be_bytes());
    push_be32_prefixed(&mut out, f.old_public_key);
    push_be32_prefixed(&mut out, f.new_public_key);
    out
}

/// The migration sign-bytes in the given form.
pub fn migration_sign_bytes(version: SignBytesVersion, f: &MigrationSignFields<'_>) -> Vec<u8> {
    match version {
        SignBytesVersion::V1 => migration_sign_bytes_v1(f),
        SignBytesVersion::V2 => migration_sign_bytes_v2(f),
    }
}

// ---------------------------------------------------------------------------
// Bridge-attestation sign-bytes
// ---------------------------------------------------------------------------

/// The operation fields a bridge validator attests (`MsgBridgeAttestation`).
#[derive(Debug, Clone, Copy)]
pub struct BridgeAttestationSignFields<'a> {
    /// The external chain name (e.g. `"ethereum"`).
    pub chain: &'a str,
    /// The event type (e.g. `"deposit"`).
    pub event_type: &'a str,
    /// The bridge operation id.
    pub operation_id: &'a str,
    /// The external tx hash.
    pub tx_hash: &'a str,
    /// The amount, as the chain's integer string (e.g. `"1000000"`).
    pub amount: &'a str,
    /// The asset denom.
    pub asset: &'a str,
}

/// v1 (legacy) attestation sign-bytes: the pipe-joined ASCII
/// `chain|eventType|operationID|txHash|amount|asset` (no chain id bound).
pub fn bridge_attestation_sign_bytes_v1(f: &BridgeAttestationSignFields<'_>) -> Vec<u8> {
    format!(
        "{}|{}|{}|{}|{}|{}",
        f.chain, f.event_type, f.operation_id, f.tx_hash, f.amount, f.asset
    )
    .into_bytes()
}

/// v2 attestation sign-bytes: `"qorechain-bridge-attestation-v2"` then
/// `BE64(len f) ‖ f` for each of `[chainID, chain, eventType, operationID,
/// txHash, amount, asset]`.
pub fn bridge_attestation_sign_bytes_v2(
    chain_id: &str,
    f: &BridgeAttestationSignFields<'_>,
) -> Vec<u8> {
    let fields = [
        chain_id,
        f.chain,
        f.event_type,
        f.operation_id,
        f.tx_hash,
        f.amount,
        f.asset,
    ];
    let mut out = Vec::with_capacity(
        BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN.len()
            + fields.iter().map(|s| 8 + s.len()).sum::<usize>(),
    );
    out.extend_from_slice(BRIDGE_ATTESTATION_SIGN_BYTES_DOMAIN.as_bytes());
    for field in fields {
        push_be64_prefixed(&mut out, field.as_bytes());
    }
    out
}

/// The attestation sign-bytes in the given form (`chain_id` is ignored by v1).
pub fn bridge_attestation_sign_bytes(
    version: SignBytesVersion,
    chain_id: &str,
    f: &BridgeAttestationSignFields<'_>,
) -> Vec<u8> {
    match version {
        SignBytesVersion::V1 => bridge_attestation_sign_bytes_v1(f),
        SignBytesVersion::V2 => bridge_attestation_sign_bytes_v2(chain_id, f),
    }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/// Resolves [`SignBytesMode::Auto`] to a concrete version per network, caching
/// each answer per `(rest_url, chain_id)` for a TTL (default
/// [`DEFAULT_SIGN_BYTES_CACHE_TTL`]).
///
/// For a non-legacy chain the answer is v2 with no network call. For a legacy
/// chain it asks `GET {rest_url}/cosmos/upgrade/v1beta1/applied_plan/v3.1.98`
/// (`{"height":"<n>"}`; a missing height means `0`) and applies
/// [`sign_bytes_version_for`].
#[derive(Debug)]
pub struct SignBytesResolver {
    http: reqwest::Client,
    ttl: Duration,
    cache: Mutex<HashMap<(String, String), (SignBytesVersion, Instant)>>,
}

impl Default for SignBytesResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl SignBytesResolver {
    /// A resolver with a fresh HTTP client and the default TTL.
    pub fn new() -> Self {
        Self::with_client(reqwest::Client::new())
    }

    /// A resolver using the supplied HTTP client and the default TTL.
    pub fn with_client(http: reqwest::Client) -> Self {
        Self {
            http,
            ttl: DEFAULT_SIGN_BYTES_CACHE_TTL,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Sets the cache TTL (`Duration::ZERO` disables caching).
    pub fn with_ttl(mut self, ttl: Duration) -> Self {
        self.ttl = ttl;
        self
    }

    /// The configured cache TTL.
    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    /// Resolves `mode` for `chain_id`.
    ///
    /// - `V1` / `V2` → returned as-is, no network.
    /// - `Auto` on a non-legacy chain → v2, no network.
    /// - `Auto` on a legacy chain → the cached answer for `(rest_url, chain_id)`
    ///   when fresh, else the node is asked. No `rest_url`, or a failed query, is
    ///   an error (never a guess).
    pub async fn resolve(
        &self,
        mode: SignBytesMode,
        chain_id: &str,
        rest_url: Option<&str>,
    ) -> Result<SignBytesVersion> {
        if let Some(v) = mode.fixed() {
            return Ok(v);
        }
        if !is_legacy_sign_bytes_chain(chain_id) {
            return Ok(SignBytesVersion::V2);
        }
        let rest_url = require_rest_url(chain_id, rest_url)?;
        if let Some(v) = self.cached(rest_url, chain_id) {
            return Ok(v);
        }
        self.fetch_and_store(chain_id, rest_url).await
    }

    /// Re-asks the node for `chain_id`, bypassing (and then refreshing) the
    /// cache. A non-legacy chain still resolves to v2 without a network call.
    pub async fn force_refresh(
        &self,
        chain_id: &str,
        rest_url: Option<&str>,
    ) -> Result<SignBytesVersion> {
        if !is_legacy_sign_bytes_chain(chain_id) {
            return Ok(SignBytesVersion::V2);
        }
        let rest_url = require_rest_url(chain_id, rest_url)?;
        self.invalidate(rest_url, chain_id);
        self.fetch_and_store(chain_id, rest_url).await
    }

    /// Drops the cached answer for `(rest_url, chain_id)`.
    pub fn invalidate(&self, rest_url: &str, chain_id: &str) {
        self.lock_cache().remove(&cache_key(rest_url, chain_id));
    }

    /// Drops every cached answer.
    pub fn clear_cache(&self) {
        self.lock_cache().clear();
    }

    /// Asks `rest_url` for the height at which [`SIGN_BYTES_V2_UPGRADE`] was
    /// applied (`0` when it has not been, or when the node answers `{}`).
    pub async fn fetch_v2_applied_height(&self, rest_url: &str) -> Result<i64> {
        let rest = RestClient::with_client(rest_url, self.http.clone());
        let path = format!("/cosmos/upgrade/v1beta1/applied_plan/{SIGN_BYTES_V2_UPGRADE}");
        let body = rest.get(&path, &[]).await.map_err(|e| {
            Error::SignBytes(format!(
                "cannot ask {rest_url} whether upgrade {SIGN_BYTES_V2_UPGRADE} is applied ({e}); \
                 pass an explicit sign-bytes version (v1 or v2)"
            ))
        })?;
        parse_applied_height(&body)
    }

    async fn fetch_and_store(&self, chain_id: &str, rest_url: &str) -> Result<SignBytesVersion> {
        let height = self.fetch_v2_applied_height(rest_url).await?;
        let v = sign_bytes_version_for(chain_id, height);
        if !self.ttl.is_zero() {
            self.lock_cache()
                .insert(cache_key(rest_url, chain_id), (v, Instant::now()));
        }
        Ok(v)
    }

    fn cached(&self, rest_url: &str, chain_id: &str) -> Option<SignBytesVersion> {
        let key = cache_key(rest_url, chain_id);
        let mut cache = self.lock_cache();
        match cache.get(&key) {
            Some((v, at)) if at.elapsed() < self.ttl => Some(*v),
            Some(_) => {
                cache.remove(&key);
                None
            }
            None => None,
        }
    }

    fn lock_cache(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<(String, String), (SignBytesVersion, Instant)>> {
        // A poisoned lock only means another thread panicked mid-insert; the map
        // itself is still a valid cache.
        self.cache.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// The process-wide resolver used by the high-level sign-and-broadcast paths.
pub fn default_sign_bytes_resolver() -> &'static SignBytesResolver {
    static RESOLVER: OnceLock<SignBytesResolver> = OnceLock::new();
    RESOLVER.get_or_init(SignBytesResolver::new)
}

/// Resolves `mode` with [`default_sign_bytes_resolver`].
pub async fn resolve_sign_bytes_version(
    mode: SignBytesMode,
    chain_id: &str,
    rest_url: Option<&str>,
) -> Result<SignBytesVersion> {
    default_sign_bytes_resolver()
        .resolve(mode, chain_id, rest_url)
        .await
}

/// Clears the cache of [`default_sign_bytes_resolver`].
pub fn clear_sign_bytes_cache() {
    default_sign_bytes_resolver().clear_cache();
}

/// Parses the `applied_plan` response: `{"height":"<n>"}` (string or number);
/// a missing / null height is `0`.
pub fn parse_applied_height(body: &Value) -> Result<i64> {
    match body.get("height") {
        None | Some(Value::Null) => Ok(0),
        Some(Value::String(s)) if s.is_empty() => Ok(0),
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map_err(|_| Error::SignBytes(format!("applied_plan height is not an integer: {s:?}"))),
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| Error::SignBytes(format!("applied_plan height is not an integer: {n}"))),
        Some(other) => Err(Error::SignBytes(format!(
            "applied_plan height has an unexpected type: {other}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Rejection detection + one-shot retry
// ---------------------------------------------------------------------------

/// Whether an ABCI `(codespace, code, log)` is the chain refusing a hybrid PQC
/// signature — `pqc` code 21, or a log carrying the chain's message for it.
/// Code 21 from any other codespace is NOT this case.
pub fn is_hybrid_sign_bytes_rejection(codespace: &str, code: u32, log: &str) -> bool {
    (codespace == PQC_CODESPACE && code == PQC_HYBRID_VERIFY_FAILED_CODE)
        || log.contains(PQC_HYBRID_VERIFY_FAILED_MESSAGE)
}

/// [`is_hybrid_sign_bytes_rejection`] over a REST broadcast response (the
/// `tx_response` object, or a top-level `{code, codespace, raw_log|message}`).
pub fn is_hybrid_sign_bytes_rejection_response(resp: &Value) -> bool {
    [resp.get("tx_response"), Some(resp)]
        .into_iter()
        .flatten()
        .any(|obj| {
            let code = obj
                .get("code")
                .and_then(Value::as_u64)
                .and_then(|c| u32::try_from(c).ok())
                .unwrap_or(0);
            let codespace = obj.get("codespace").and_then(Value::as_str).unwrap_or("");
            let log = ["raw_log", "log", "message"]
                .iter()
                .filter_map(|k| obj.get(*k).and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            is_hybrid_sign_bytes_rejection(codespace, code, &log)
        })
}

/// [`is_hybrid_sign_bytes_rejection`] over an SDK [`Error`].
pub fn is_hybrid_sign_bytes_rejection_error(err: &Error) -> bool {
    match err {
        Error::Tx(e) => is_hybrid_sign_bytes_rejection(
            &e.codespace,
            e.code,
            &format!("{}\n{}", e.raw_log, e.reason),
        ),
        Error::Http { body, .. } => match serde_json::from_str::<Value>(body) {
            Ok(v) => is_hybrid_sign_bytes_rejection_response(&v),
            Err(_) => body.contains(PQC_HYBRID_VERIFY_FAILED_MESSAGE),
        },
        Error::JsonRpc { message, .. } => message.contains(PQC_HYBRID_VERIFY_FAILED_MESSAGE),
        _ => false,
    }
}

/// The outcome of a hybrid sign-and-broadcast.
#[derive(Debug, Clone)]
pub struct HybridBroadcast {
    /// The broadcast response JSON of the last attempt.
    pub response: Value,
    /// The sign-bytes version the last attempt was signed with.
    pub sign_bytes_version: SignBytesVersion,
    /// Whether the first attempt was refused with `pqc` code 21 and re-signed.
    pub retried: bool,
}

/// Resolves the version, builds with `build`, sends with `send`, and — only when
/// `mode` is [`SignBytesMode::Auto`] and the send is refused as a hybrid PQC
/// signature failure (see [`is_hybrid_sign_bytes_rejection`]) — force-refreshes
/// the version, rebuilds and sends exactly once more. The second attempt's
/// outcome is returned as-is.
///
/// `build` returns the tx bytes for a given version; `send` broadcasts them
/// (e.g. [`crate::tx::broadcast`]). This is the transport-agnostic core of the
/// high-level hybrid send paths.
pub async fn broadcast_with_sign_bytes_retry<B, S, Fut>(
    resolver: &SignBytesResolver,
    mode: SignBytesMode,
    chain_id: &str,
    rest_url: Option<&str>,
    mut build: B,
    mut send: S,
) -> Result<HybridBroadcast>
where
    B: FnMut(SignBytesVersion) -> Result<Vec<u8>>,
    S: FnMut(Vec<u8>) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let version = resolver.resolve(mode, chain_id, rest_url).await?;
    let first = send(build(version)?).await;
    let refused = match &first {
        Ok(resp) => is_hybrid_sign_bytes_rejection_response(resp),
        Err(e) => is_hybrid_sign_bytes_rejection_error(e),
    };
    if mode != SignBytesMode::Auto || !refused {
        return first.map(|response| HybridBroadcast {
            response,
            sign_bytes_version: version,
            retried: false,
        });
    }
    let version = resolver.force_refresh(chain_id, rest_url).await?;
    let response = send(build(version)?).await?;
    Ok(HybridBroadcast {
        response,
        sign_bytes_version: version,
        retried: true,
    })
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

fn push_be32_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn push_be64_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn cache_key(rest_url: &str, chain_id: &str) -> (String, String) {
    (
        rest_url.trim_end_matches('/').to_string(),
        chain_id.to_string(),
    )
}

fn require_rest_url<'a>(chain_id: &str, rest_url: Option<&'a str>) -> Result<&'a str> {
    match rest_url {
        Some(u) if !u.trim().is_empty() => Ok(u),
        _ => Err(Error::SignBytes(format!(
            "chain {chain_id:?} verifies hybrid sign-bytes v1 until upgrade \
             {SIGN_BYTES_V2_UPGRADE} is applied and v2 after it; to choose, the SDK must ask \
             a node — pass a REST URL, or an explicit sign-bytes version (v1 or v2)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mode_and_version_parse() {
        assert_eq!(
            "auto".parse::<SignBytesMode>().unwrap(),
            SignBytesMode::Auto
        );
        assert_eq!("".parse::<SignBytesMode>().unwrap(), SignBytesMode::Auto);
        assert_eq!("v1".parse::<SignBytesMode>().unwrap(), SignBytesMode::V1);
        assert_eq!("v2".parse::<SignBytesMode>().unwrap(), SignBytesMode::V2);
        assert!("v3".parse::<SignBytesMode>().is_err());
        assert_eq!(
            "v2".parse::<SignBytesVersion>().unwrap(),
            SignBytesVersion::V2
        );
        assert!("auto".parse::<SignBytesVersion>().is_err());
        assert_eq!(SignBytesMode::default(), SignBytesMode::Auto);
        assert_eq!(SignBytesVersion::V1.number(), 1);
        assert_eq!(SignBytesVersion::V2.to_string(), "v2");
    }

    #[test]
    fn applied_height_parsing() {
        assert_eq!(
            parse_applied_height(&json!({"height": "5746000"})).unwrap(),
            5_746_000
        );
        assert_eq!(parse_applied_height(&json!({"height": "0"})).unwrap(), 0);
        assert_eq!(parse_applied_height(&json!({})).unwrap(), 0);
        assert_eq!(parse_applied_height(&json!({"height": 12})).unwrap(), 12);
        assert!(parse_applied_height(&json!({"height": "abc"})).is_err());
    }

    #[test]
    fn require_version_fails_loudly_on_legacy_chain() {
        assert_eq!(
            require_sign_bytes_version("qorechain-new", None).unwrap(),
            SignBytesVersion::V2
        );
        assert_eq!(
            require_sign_bytes_version("qorechain-vladi", Some(SignBytesVersion::V1)).unwrap(),
            SignBytesVersion::V1
        );
        let err = require_sign_bytes_version("qorechain-vladi", None).unwrap_err();
        assert!(matches!(err, Error::SignBytes(_)), "{err:?}");
    }
}
