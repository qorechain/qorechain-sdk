//! Which chain releases a network has applied.
//!
//! A release adds message fields, and a node below it does not know them: the
//! transaction decoder refuses a message carrying an unknown field, so setting
//! one of a release's new OPTIONAL fields before the upgrade gets the whole
//! transaction refused. Set such fields only after the network has applied the
//! release. Each release switches its features on at its plan height, which
//! the upgrade module reports. Plan names are the same on every network. From
//! v3.2.4 the switches can also be read by name with
//! [`crate::protocol_features`].

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::query::RestClient;
use crate::{Error, Result};

/// EIP-7702 delegation consent, the measured EVM spending policy, the
/// `ecdsa_pubkey` check on PQC registration and the new bridge, multilayer and
/// RDK messages.
pub const CHAIN_UPGRADE_V3_2_2: &str = "v3.2.2";

/// PQC registration integrity and `proof_of_possession`, hybrid-only key
/// maintenance for keyed accounts, the EVM window scope (`native_only`,
/// `allowed_targets`), the abstract-account v2 digest and `MsgUpdateAuthority`.
pub const CHAIN_UPGRADE_V3_2_3: &str = "v3.2.3";

/// Staking tiers, the authenticator nonce and protocol-feature queries,
/// `possession_proven`, and the bridge validator's proof of possession.
pub const CHAIN_UPGRADE_V3_2_4: &str = "v3.2.4";

/// How long a "not applied yet" answer is trusted. An applied plan stays
/// applied and is cached for the life of the process.
const NOT_APPLIED_TTL: Duration = Duration::from_secs(60);

static CACHE: Mutex<Option<HashMap<String, (u64, Instant)>>> = Mutex::new(None);

/// The REST path of the `applied_plan` query.
pub fn applied_plan_path(plan: &str) -> String {
    format!("/cosmos/upgrade/v1beta1/applied_plan/{plan}")
}

/// The applied height in an `applied_plan` payload; `0` = not applied. Mainnet
/// answers `{"height":"0"}` for a plan it has not applied, so the number is
/// parsed, never tested for presence.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when the height is not an integer.
pub fn parse_applied_height(payload: &serde_json::Value) -> Result<u64> {
    match &payload["height"] {
        serde_json::Value::Null => Ok(0),
        serde_json::Value::String(s) if s.trim().is_empty() => Ok(0),
        serde_json::Value::String(s) => s.trim().parse::<u64>().map_err(|_| {
            Error::InvalidResponse(format!("applied_plan height is not an integer: {s:?}"))
        }),
        serde_json::Value::Number(n) => n.as_u64().ok_or_else(|| {
            Error::InvalidResponse(format!("applied_plan height is not an integer: {n}"))
        }),
        other => Err(Error::InvalidResponse(format!(
            "applied_plan height is not an integer: {other}"
        ))),
    }
}

/// The height at which `plan` was applied on the network behind `rest`, or `0`.
///
/// `cache_key` identifies the network (its REST URL) for the cache; `None`
/// asks the node every time.
///
/// # Errors
///
/// When the node cannot be asked. Never read that as "not applied": the guess
/// sends the wrong wire format to the network.
pub async fn upgrade_applied_height(
    rest: &RestClient,
    plan: &str,
    cache_key: Option<&str>,
) -> Result<u64> {
    let key = cache_key.map(|k| format!("{k}|{plan}"));
    if let Some(k) = &key {
        if let Some(map) = CACHE.lock().expect("upgrade cache").as_ref() {
            if let Some((h, at)) = map.get(k) {
                if *h > 0 || at.elapsed() < NOT_APPLIED_TTL {
                    return Ok(*h);
                }
            }
        }
    }
    let height = parse_applied_height(&rest.get(&applied_plan_path(plan), &[]).await?)?;
    if let Some(k) = key {
        CACHE
            .lock()
            .expect("upgrade cache")
            .get_or_insert_with(HashMap::new)
            .insert(k, (height, Instant::now()));
    }
    Ok(height)
}

/// Whether the network has applied `plan`.
///
/// # Errors
///
/// When the node cannot be asked.
pub async fn is_upgrade_applied(
    rest: &RestClient,
    plan: &str,
    cache_key: Option<&str>,
) -> Result<bool> {
    Ok(upgrade_applied_height(rest, plan, cache_key).await? > 0)
}

/// Refuses to set `what` (a release's new fields) on a network below `plan`.
///
/// # Errors
///
/// [`Error::Pqc`] when the network has not applied `plan`, or the transport
/// error.
pub async fn require_upgrade_applied(
    rest: &RestClient,
    plan: &str,
    what: &str,
    cache_key: Option<&str>,
) -> Result<()> {
    if is_upgrade_applied(rest, plan, cache_key).await? {
        return Ok(());
    }
    Err(Error::Pqc(format!(
        "{what} needs chain {plan}, which this network has not applied yet; a node below {plan} \
         refuses the whole transaction when the field is set, so leave it unset until the upgrade"
    )))
}

/// Forgets cached answers (tests, network switches).
pub fn clear_upgrade_cache() {
    *CACHE.lock().expect("upgrade cache") = None;
}
