//! PQC key registration integrity (chain v3.2.3).
//!
//! From v3.2.3 the chain refuses a registration that protects nothing, and
//! accepts proof that the registrant holds the key's secret:
//!
//! - `key_type = "classical_only"` registers no post-quantum key, and the
//!   account could then never sign a transaction again;
//! - an empty public key;
//! - a degenerate ML-DSA-87 key, whose `t1` part (every byte after the 32-byte
//!   `rho`) is zero: anyone can forge signatures for it;
//! - `proof_of_possession` (optional now, to become mandatory): the key's own
//!   ML-DSA signature over
//!   `"qorechain-pqc-pop-v1|<chain-id>|<algorithm>|<account>|<hex(public key)>"`,
//!   lower-case hex, deterministic, empty context.
//!
//! Also from v3.2.3 an account that already has a key must send register /
//! migrate with the hybrid signature (send `MsgMigratePQCKey` through
//! [`crate::pqc_dx::PqcDx::build_hybrid`] with the CURRENT key), a rotation or
//! migration to a key the account used before is refused, and none of the
//! key-management messages may travel inside authz `MsgExec`.
//!
//! `proof_of_possession` is a new field: a node below v3.2.3 refuses the whole
//! transaction when it is set. Set it only once the network accepts it:
//! [`proof_of_possession_accepted`] reads the chain's protocol feature switch
//! [`PQC_POSSESSION_FLAG_FEATURE`] first and asks whether v3.2.3 is applied
//! ([`crate::upgrades::is_upgrade_applied`] with
//! [`crate::upgrades::CHAIN_UPGRADE_V3_2_3`]) only when the node does not
//! serve that switch.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::pqc::{pqc_sign, pqc_verify, ALGORITHM_DILITHIUM5};
use crate::protocol_features::{read_protocol_feature, ProtocolFeatureState};
use crate::query::RestClient;
use crate::{Error, Result};

/// The protocol feature switch under which the chain accepts
/// `MsgRegisterPQCKeyV2.proof_of_possession`.
pub const PQC_POSSESSION_FLAG_FEATURE: &str = "pqc-possession-flag";

/// How long a successful [`proof_of_possession_accepted`] answer is cached per
/// `(rest_url, chain_id)`. Errors are never cached.
pub const PROOF_OF_POSSESSION_CACHE_TTL: Duration = Duration::from_secs(60);

/// `(rest_url, chain_id)` to `(accepted, when)`.
type PopCache = HashMap<(String, String), (bool, Instant)>;

static POP_CACHE: Mutex<Option<PopCache>> = Mutex::new(None);

/// Whether to attach a proof of possession to `MsgRegisterPQCKeyV2`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ProofOfPossessionMode {
    /// Ask the network (see [`proof_of_possession_accepted`]). The default.
    #[default]
    Auto,
    /// Always sign and attach the proof. No network call.
    Attach,
    /// Never attach it. No network call.
    Skip,
}

/// Whether the network behind `rest_url` accepts
/// `MsgRegisterPQCKeyV2.proof_of_possession`.
///
/// 1. The protocol feature switch [`PQC_POSSESSION_FLAG_FEATURE`] decides when
///    the node lists it (on: attach, off: do not).
/// 2. When the node definitively does not serve it (HTTP 404 / 501, or a list
///    that is empty or lacks the switch), the answer is whether the network
///    has applied [`crate::upgrades::CHAIN_UPGRADE_V3_2_3`].
/// 3. When the node could not be asked, this is an error: never a fall back to
///    the plans and never a guess.
///
/// Successful answers are cached per `(rest_url, chain_id)` for
/// [`PROOF_OF_POSSESSION_CACHE_TTL`].
///
/// # Errors
///
/// [`Error::Pqc`] when the network could not be asked (transport error,
/// timeout, HTTP 429 or 5xx other than 501, unparsable answer), or the plan
/// query fails. Pass [`ProofOfPossessionMode::Attach`] or
/// [`ProofOfPossessionMode::Skip`] to decide without the network.
pub async fn proof_of_possession_accepted(rest_url: &str, chain_id: &str) -> Result<bool> {
    let base = rest_url.trim_end_matches('/');
    let key = (base.to_string(), chain_id.to_string());
    if let Some(map) = POP_CACHE.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        if let Some((accepted, at)) = map.get(&key) {
            if at.elapsed() < PROOF_OF_POSSESSION_CACHE_TTL {
                return Ok(*accepted);
            }
        }
    }
    let cannot_ask = |e: Error| {
        Error::Pqc(format!(
            "cannot ask {base} whether it accepts a PQC proof of possession ({e}); the SDK \
             does not guess, because a node that does not accept the field refuses the whole \
             registration: retry, or pass an explicit choice (ProofOfPossessionMode::Attach \
             or ProofOfPossessionMode::Skip)"
        ))
    };
    let rest = RestClient::new(base.to_string());
    let accepted = match read_protocol_feature(&rest, PQC_POSSESSION_FLAG_FEATURE)
        .await
        .map_err(cannot_ask)?
    {
        ProtocolFeatureState::Enabled => true,
        ProtocolFeatureState::Disabled => false,
        ProtocolFeatureState::NotServed => crate::upgrades::is_upgrade_applied(
            &rest,
            crate::upgrades::CHAIN_UPGRADE_V3_2_3,
            Some(base),
        )
        .await
        .map_err(cannot_ask)?,
    };
    POP_CACHE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(key, (accepted, Instant::now()));
    Ok(accepted)
}

/// Resolves `mode`: `Attach` is `true` and `Skip` is `false` with no network
/// call; `Auto` is [`proof_of_possession_accepted`].
///
/// # Errors
///
/// As [`proof_of_possession_accepted`].
pub async fn resolve_proof_of_possession(
    mode: ProofOfPossessionMode,
    rest_url: &str,
    chain_id: &str,
) -> Result<bool> {
    match mode {
        ProofOfPossessionMode::Attach => Ok(true),
        ProofOfPossessionMode::Skip => Ok(false),
        ProofOfPossessionMode::Auto => proof_of_possession_accepted(rest_url, chain_id).await,
    }
}

/// Forgets cached [`proof_of_possession_accepted`] answers (tests, network
/// switches).
pub fn clear_proof_of_possession_cache() {
    *POP_CACHE.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// Size of an ML-DSA-87 public key.
pub const ML_DSA_87_PUBLIC_KEY_LENGTH: usize = 2592;
/// The key type the chain refuses from v3.2.3.
pub const KEY_TYPE_CLASSICAL_ONLY: &str = "classical_only";
/// Domain of the proof-of-possession sign-bytes.
pub const PROOF_OF_POSSESSION_DOMAIN: &str = "qorechain-pqc-pop-v1";

const RHO_LENGTH: usize = 32;

/// Whether `public_key` is an ML-DSA-87 key nobody needs a secret for: right
/// length, every byte after `rho` zero. Keys of another length are not judged.
pub fn is_degenerate_pqc_public_key(public_key: &[u8]) -> bool {
    public_key.len() == ML_DSA_87_PUBLIC_KEY_LENGTH
        && public_key[RHO_LENGTH..].iter().all(|b| *b == 0)
}

/// Refuses a registration the chain refuses from v3.2.3. Not network-gated:
/// such a registration protects nothing, or locks the account, on any network.
///
/// # Errors
///
/// [`Error::Pqc`] naming the reason.
pub fn validate_registered_pqc_key(key_type: &str, public_key: &[u8]) -> Result<()> {
    if key_type == KEY_TYPE_CLASSICAL_ONLY {
        return Err(Error::Pqc(
            "key_type \"classical_only\" registers no post-quantum key; the account would be \
             unable to sign any transaction afterwards"
                .into(),
        ));
    }
    if public_key.is_empty() {
        return Err(Error::Pqc("a post-quantum public key is required".into()));
    }
    if is_degenerate_pqc_public_key(public_key) {
        return Err(Error::Pqc(
            "the key's t1 part is all zero, so anyone can forge its signatures".into(),
        ));
    }
    Ok(())
}

/// The bytes the key being registered signs to prove its owner holds the
/// secret. They name the chain, the algorithm, the account and the key.
///
/// # Errors
///
/// [`Error::Pqc`] when `chain_id` or `account` is empty.
pub fn proof_of_possession_sign_bytes(
    chain_id: &str,
    algorithm_id: u32,
    account: &str,
    public_key: &[u8],
) -> Result<Vec<u8>> {
    if chain_id.is_empty() || account.is_empty() {
        return Err(Error::Pqc(
            "proof of possession: chain id and account are required".into(),
        ));
    }
    Ok(format!(
        "{PROOF_OF_POSSESSION_DOMAIN}|{chain_id}|{algorithm_id}|{account}|{}",
        hex::encode(public_key)
    )
    .into_bytes())
}

/// Signs the proof of possession with the key being registered (deterministic
/// ML-DSA-87). Set the result as `MsgRegisterPqcKeyV2::proof_of_possession`,
/// only on a network that accepts it (see [`proof_of_possession_accepted`]).
///
/// # Errors
///
/// As [`proof_of_possession_sign_bytes`] and [`pqc_sign`].
pub fn sign_proof_of_possession(
    chain_id: &str,
    account: &str,
    public_key: &[u8],
    secret_key: &[u8],
) -> Result<Vec<u8>> {
    let bytes =
        proof_of_possession_sign_bytes(chain_id, ALGORITHM_DILITHIUM5, account, public_key)?;
    pqc_sign(secret_key, &bytes)
}

/// Verifies a proof of possession locally, as the chain will.
pub fn verify_proof_of_possession(
    chain_id: &str,
    account: &str,
    public_key: &[u8],
    proof: &[u8],
) -> bool {
    match proof_of_possession_sign_bytes(chain_id, ALGORITHM_DILITHIUM5, account, public_key) {
        Ok(bytes) => pqc_verify(public_key, &bytes, proof),
        Err(_) => false,
    }
}
