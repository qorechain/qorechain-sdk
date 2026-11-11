//! Abstract-account reads added in chain v3.2.5: the spending rules stored for
//! an account and the keys linked to it. The composers are in
//! [`crate::msg::abstractaccount`].
//!
//! Before v3.2.5 the account view only counted the rules, so an owner could not
//! read back what `MsgUpdateSpendingRules` saved. A network below v3.2.5 has no
//! such routes (an HTTP 404 / 501 error).

use serde_json::Value;

use crate::error::{Error, Result};
use crate::proto::qorechain::abstractaccount::v1::{DenomLimit, SpendingRule};
use crate::query::RestClient;

/// The REST path of an account's stored spending rules.
pub fn spending_rules_path(address: &str) -> String {
    format!("/qorechain/abstractaccount/v1/accounts/{address}/spending_rules")
}

/// The REST path of an account's linked keys.
pub fn authenticators_path(address: &str) -> String {
    format!("/qorechain/abstractaccount/v1/accounts/{address}/authenticators")
}

/// The rule a linked key carries itself.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthenticatorRule {
    /// The key's scheme (e.g. `secp256k1`, `ed25519`).
    pub scheme: String,
    /// The key, hex encoded.
    pub pubkey_hex: String,
    /// The key's own rule.
    pub rule: SpendingRule,
}

/// The stored spending rules of an account.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SpendingRules {
    /// The account-wide rules in stored order; the first enabled one bounds
    /// every linked key without a rule of its own.
    pub rules: Vec<SpendingRule>,
    /// The per-key rules.
    pub authenticator_rules: Vec<AuthenticatorRule>,
}

/// A linked key, revoked ones included.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuthenticatorView {
    /// The key's scheme.
    pub scheme: String,
    /// The key, hex encoded.
    pub pubkey_hex: String,
    /// What the key may do.
    pub permissions: Vec<String>,
    /// Expiry, unix seconds.
    pub expiry_unix: i64,
    /// The owner's label.
    pub label: String,
    /// When it was linked, unix seconds.
    pub created_at_unix: i64,
    /// Whether it was revoked.
    pub revoked: bool,
    /// Whether the key carries a rule of its own (see [`fetch_spending_rules`]).
    pub has_spend_rule: bool,
}

fn int(v: &Value, what: &str) -> Result<i64> {
    match v {
        Value::Null => Ok(0),
        Value::String(s) if s.is_empty() => Ok(0),
        Value::String(s) => s
            .trim()
            .parse()
            .map_err(|_| Error::InvalidResponse(format!("{what} is not an integer: {s:?}"))),
        Value::Number(n) => n
            .as_i64()
            .ok_or_else(|| Error::InvalidResponse(format!("{what} is not an integer: {n}"))),
        other => Err(Error::InvalidResponse(format!(
            "{what} is not an integer: {other}"
        ))),
    }
}

fn str_of(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_rule(v: &Value) -> Result<SpendingRule> {
    let denom_limits = v["denom_limits"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|d| DenomLimit {
                    denom: str_of(&d["denom"]),
                    per_tx_limit: str_of(&d["per_tx_limit"]),
                    daily_limit: str_of(&d["daily_limit"]),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SpendingRule {
        id: str_of(&v["id"]),
        daily_limit: int(&v["daily_limit"], "daily_limit")?,
        per_tx_limit: int(&v["per_tx_limit"], "per_tx_limit")?,
        allowed_denoms: strings(&v["allowed_denoms"]),
        enabled: v["enabled"].as_bool().unwrap_or(false),
        allowed_evm_calls: strings(&v["allowed_evm_calls"]),
        denom_limits,
    })
}

/// Parses a `.../spending_rules` body.
///
/// # Errors
///
/// [`Error::InvalidResponse`] on a malformed body.
pub fn parse_spending_rules(b: &Value) -> Result<SpendingRules> {
    let rules = b["rules"]
        .as_array()
        .map(|a| a.iter().map(parse_rule).collect::<Result<Vec<_>>>())
        .transpose()?
        .unwrap_or_default();
    let authenticator_rules = b["authenticator_rules"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|r| {
                    Ok(AuthenticatorRule {
                        scheme: str_of(&r["scheme"]),
                        pubkey_hex: str_of(&r["pubkey_hex"]),
                        rule: parse_rule(&r["rule"])?,
                    })
                })
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?
        .unwrap_or_default();
    Ok(SpendingRules {
        rules,
        authenticator_rules,
    })
}

/// Parses a `.../authenticators` body.
///
/// # Errors
///
/// [`Error::InvalidResponse`] on a malformed body.
pub fn parse_authenticators(b: &Value) -> Result<Vec<AuthenticatorView>> {
    b["authenticators"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|v| {
                    Ok(AuthenticatorView {
                        scheme: str_of(&v["scheme"]),
                        pubkey_hex: str_of(&v["pubkey_hex"]),
                        permissions: strings(&v["permissions"]),
                        expiry_unix: int(&v["expiry_unix"], "expiry_unix")?,
                        label: str_of(&v["label"]),
                        created_at_unix: int(&v["created_at_unix"], "created_at_unix")?,
                        revoked: v["revoked"].as_bool().unwrap_or(false),
                        has_spend_rule: v["has_spend_rule"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

/// Reads the spending rules stored for `address` (chain v3.2.5).
///
/// # Errors
///
/// Transport / HTTP errors (the chain answers code 5 for an address that is
/// not an abstract account), or [`Error::InvalidResponse`].
pub async fn fetch_spending_rules(rest: &RestClient, address: &str) -> Result<SpendingRules> {
    parse_spending_rules(&rest.get(&spending_rules_path(address), &[]).await?)
}

/// Reads the keys linked to `address`, revoked ones included (chain v3.2.5).
///
/// # Errors
///
/// As [`fetch_spending_rules`].
pub async fn fetch_authenticators(
    rest: &RestClient,
    address: &str,
) -> Result<Vec<AuthenticatorView>> {
    parse_authenticators(&rest.get(&authenticators_path(address), &[]).await?)
}

// ---- execute-lane results (chain v3.2.8) ----

/// The event a failed but authorised `MsgExecuteEVM` / `MsgExecuteCosmos`
/// emits from chain v3.2.8 (attributes `account`, `lane`, `nonce`, `reason`).
pub const EXECUTION_FAILED_EVENT: &str = "abstractaccount_execution_failed";

/// `MsgExecuteEVM` response type URL.
pub const EXECUTE_EVM_RESPONSE: &str = "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse";
/// `MsgExecuteCosmos` response type URL.
pub const EXECUTE_COSMOS_RESPONSE: &str = "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse";

/// The lane of an execute message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionLane {
    /// `MsgExecuteEVM`.
    Evm,
    /// `MsgExecuteCosmos`.
    Cosmos,
}

impl ExecutionLane {
    fn matches(self, lane: &str) -> bool {
        let lane = lane.to_ascii_lowercase();
        match self {
            ExecutionLane::Evm => lane.contains("evm"),
            ExecutionLane::Cosmos => lane.contains("cosmos") || lane.contains("native"),
        }
    }
}

/// The outcome of one `MsgExecuteEVM` / `MsgExecuteCosmos` in a delivered
/// transaction (see [`execution_results`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionResult {
    /// The position of the message among the transaction's message responses.
    pub msg_index: usize,
    /// Which lane it ran on.
    pub lane: ExecutionLane,
    /// Whether the execution succeeded.
    pub success: bool,
    /// The EVM return data (empty on the Cosmos lane).
    pub ret: Vec<u8>,
    /// EVM gas used (0 on the Cosmos lane).
    pub gas_used: u64,
    /// The EVM error text (empty on success and on the Cosmos lane).
    pub vm_error: String,
    /// The `reason` of the matching [`EXECUTION_FAILED_EVENT`], when one was
    /// emitted.
    pub reason: Option<String>,
}

/// `(type_url, value)` of each message response.
type MsgResponses = Vec<(String, Vec<u8>)>;

fn msg_responses_from_json(tx: &Value) -> Result<Option<MsgResponses>> {
    use base64::Engine as _;
    let root = tx.get("tx_response").unwrap_or(tx);
    if let Some(list) = root.get("msg_responses").and_then(Value::as_array) {
        let mut out = Vec::with_capacity(list.len());
        for entry in list {
            let type_url = entry
                .get("type_url")
                .or_else(|| entry.get("@type"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let value = entry.get("value").and_then(Value::as_str).unwrap_or("");
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|e| Error::InvalidResponse(format!("msg_responses value: {e}")))?;
            out.push((type_url, bytes));
        }
        return Ok(Some(out));
    }
    // Fall back to `data`: the hex (or base64) TxMsgData.
    let Some(data) = root
        .get("data")
        .and_then(Value::as_str)
        .filter(|d| !d.is_empty())
    else {
        return Ok(None);
    };
    let bytes = hex::decode(data)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(data))
        .map_err(|e| Error::InvalidResponse(format!("tx data is neither hex nor base64: {e}")))?;
    use prost::Message as _;
    let decoded = cosmrs::proto::cosmos::base::abci::v1beta1::TxMsgData::decode(bytes.as_slice())
        .map_err(|e| Error::InvalidResponse(format!("decode TxMsgData: {e}")))?;
    Ok(Some(
        decoded
            .msg_responses
            .into_iter()
            .map(|a| (a.type_url, a.value))
            .collect(),
    ))
}

fn event_attr(ev: &Value, key: &str) -> Option<String> {
    ev.get("attributes")?.as_array()?.iter().find_map(|a| {
        (a.get("key")?.as_str()? == key)
            .then(|| a["value"].as_str().unwrap_or_default().to_string())
    })
}

fn failure_events(tx: &Value) -> Vec<(String, String)> {
    let root = tx.get("tx_response").unwrap_or(tx);
    let mut events: Vec<&Value> = root
        .get("events")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    if events.is_empty() {
        if let Some(logs) = root.get("logs").and_then(Value::as_array) {
            for log in logs {
                if let Some(evs) = log.get("events").and_then(Value::as_array) {
                    events.extend(evs.iter());
                }
            }
        }
    }
    events
        .into_iter()
        .filter(|e| e.get("type").and_then(Value::as_str) == Some(EXECUTION_FAILED_EVENT))
        .map(|e| {
            (
                event_attr(e, "lane").unwrap_or_default(),
                event_attr(e, "reason").unwrap_or_default(),
            )
        })
        .collect()
}

/// Reads the outcome of every `MsgExecuteEVM` / `MsgExecuteCosmos` in a
/// delivered transaction: the REST tx JSON (`/cosmos/tx/v1beta1/txs/{hash}`,
/// a block-mode broadcast answer, or [`crate::tx::TxResult::raw`]).
///
/// From chain v3.2.8 an authorised execution that fails returns
/// `success = false` inside a transaction with code 0 and emits
/// [`EXECUTION_FAILED_EVENT`]; the key's nonce is consumed, so the same
/// signature cannot be relayed again. The responses are read from
/// `msg_responses` (or the `data` field), and each failed result takes the
/// `reason` of the failure event of its lane, in order.
///
/// Returns an empty list when the answer carries no responses (a `sync`
/// broadcast answers before execution; wait for the transaction first).
///
/// # Errors
///
/// [`Error::InvalidResponse`] when a response does not decode.
pub fn execution_results(tx: &Value) -> Result<Vec<ExecutionResult>> {
    use crate::proto::qorechain::abstractaccount::v1 as pb;
    use prost::Message as _;
    let Some(responses) = msg_responses_from_json(tx)? else {
        return Ok(Vec::new());
    };
    let mut events = failure_events(tx);
    let mut out = Vec::new();
    for (msg_index, (type_url, bytes)) in responses.iter().enumerate() {
        let mut result = match type_url.as_str() {
            EXECUTE_EVM_RESPONSE => {
                let r = pb::MsgExecuteEvmResponse::decode(bytes.as_slice()).map_err(|e| {
                    Error::InvalidResponse(format!("decode MsgExecuteEVMResponse: {e}"))
                })?;
                ExecutionResult {
                    msg_index,
                    lane: ExecutionLane::Evm,
                    success: r.success,
                    ret: r.ret,
                    gas_used: r.gas_used,
                    vm_error: r.vm_error,
                    reason: None,
                }
            }
            EXECUTE_COSMOS_RESPONSE => {
                let r = pb::MsgExecuteCosmosResponse::decode(bytes.as_slice()).map_err(|e| {
                    Error::InvalidResponse(format!("decode MsgExecuteCosmosResponse: {e}"))
                })?;
                ExecutionResult {
                    msg_index,
                    lane: ExecutionLane::Cosmos,
                    success: r.success,
                    ret: Vec::new(),
                    gas_used: 0,
                    vm_error: String::new(),
                    reason: None,
                }
            }
            _ => continue,
        };
        if !result.success {
            let pos = events
                .iter()
                .position(|(lane, _)| lane.is_empty() || result.lane.matches(lane));
            if let Some(pos) = pos {
                result.reason = Some(events.remove(pos).1);
            }
        }
        out.push(result);
    }
    Ok(out)
}

/// As [`execution_results`], but returns [`Error::ExecutionFailed`] when any
/// execution failed even though the transaction code is 0, so a relayer does
/// not report a failed execution as success.
///
/// # Errors
///
/// [`Error::ExecutionFailed`] naming the first failed message and its reason,
/// or the errors of [`execution_results`].
pub fn require_executions_succeeded(tx: &Value) -> Result<Vec<ExecutionResult>> {
    let results = execution_results(tx)?;
    if let Some(f) = results.iter().find(|r| !r.success) {
        let why = f
            .reason
            .clone()
            .filter(|r| !r.is_empty())
            .or_else(|| (!f.vm_error.is_empty()).then(|| f.vm_error.clone()))
            .unwrap_or_else(|| "no reason given".into());
        return Err(Error::ExecutionFailed(format!(
            "message {} ({:?} lane) was authorised but failed: {why}; its nonce is consumed, so \
             sign a new execution with the next nonce",
            f.msg_index, f.lane
        )));
    }
    Ok(results)
}
