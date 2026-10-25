//! Transaction error decoding: map an ABCI `(code, codespace, raw_log)` triple
//! to a typed [`QoreTxError`] with a human-readable reason, mirroring the
//! TS / Go SDKs.

use std::fmt;

/// A decoded transaction error: a non-zero ABCI result code from `CheckTx` or
/// `DeliverTx`, mapped (where possible) to a human-readable reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QoreTxError {
    /// The non-zero ABCI result code.
    pub code: u32,
    /// The module that produced the error (e.g. `"sdk"`, `"bank"`, `"amm"`). An
    /// empty codespace means the root SDK codespace.
    pub codespace: String,
    /// The mapped human-readable description, or a generic fallback when the
    /// `(codespace, code)` pair is not recognized.
    pub reason: String,
    /// The chain's `raw_log` string for the failed tx (may be empty).
    pub raw_log: String,
    /// The failed tx hash, when known.
    pub tx_hash: String,
}

impl fmt::Display for QoreTxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let cs = if self.codespace.is_empty() {
            "sdk"
        } else {
            &self.codespace
        };
        write!(f, "tx failed: code {} ({}/{})", self.code, cs, self.reason)?;
        if !self.tx_hash.is_empty() {
            write!(f, " tx {}", self.tx_hash)?;
        }
        if !self.raw_log.is_empty() {
            write!(f, ": {}", self.raw_log)?;
        }
        Ok(())
    }
}

impl std::error::Error for QoreTxError {}

/// The `reason` of a refusal from the per-sender transaction rate limit. Wait
/// and retry.
pub const RATE_LIMITED_REASON: &str = "rate limited";

/// The `reason` when the account has no registered PQC key (pqc 8, or pqc 20
/// from a keyless account): register the key first.
pub const PQC_KEY_REQUIRED_REASON: &str = "PQC key required: register the account's PQC key first";
/// The `reason` when a keyed account sent no hybrid extension (pqc 20): sign
/// the transaction hybrid.
pub const HYBRID_SIGNATURE_REQUIRED_REASON: &str =
    "hybrid signature required: the account has a PQC key";

/// Tells pqc 8 / pqc 20 apart. pqc 8 is always an account without a PQC key
/// (classical fallback disabled). pqc 20 is either a keyless account or a keyed
/// account that sent no hybrid extension; only the text tells them apart.
fn pqc_key_requirement(codespace: &str, code: u32, raw_log: &str) -> Option<&'static str> {
    if codespace != "pqc" || (code != 8 && code != 20) {
        return None;
    }
    let lower = raw_log.to_ascii_lowercase();
    if lower.contains("has a registered pqc key and must include") {
        return Some(HYBRID_SIGNATURE_REQUIRED_REASON);
    }
    if code == 8
        || lower.contains("has no registered pqc key")
        || lower.contains("has no pqc key")
        || lower.contains("must include a pqc hybrid signature extension")
    {
        return Some(PQC_KEY_REQUIRED_REASON);
    }
    None
}

/// Recognises the per-sender rate limit (both lanes' ante handler): codespace
/// `ai`, code 3, text "sender <addr> has sent <n> transactions in the last 30
/// blocks, at the configured limit of <limit> per minute". Code 3 also carries
/// other AI-engine rejections, so the text decides; a transport that drops the
/// codespace (EVM JSON-RPC) is matched on the text alone.
fn is_rate_limit_log(codespace: &str, code: u32, raw_log: &str) -> bool {
    let lower = raw_log.to_ascii_lowercase();
    if !lower.contains("transactions in the last") || !lower.contains("per minute") {
        return false;
    }
    codespace.is_empty() || (codespace == "ai" && code == 3)
}

/// Maps an ABCI `(code, codespace, raw_log)` triple to a [`QoreTxError`].
///
/// A zero `code` returns `None` (success). The codespace selects the code table:
/// the empty / `"sdk"` codespace uses the root SDK table; a module codespace
/// uses its per-module table, with a generic fallback when the specific code is
/// unmapped.
pub fn decode_tx_error(code: u32, codespace: &str, raw_log: &str) -> Option<QoreTxError> {
    if code == 0 {
        return None;
    }
    let reason = if let Some(r) = pqc_key_requirement(codespace, code, raw_log) {
        r.to_string()
    } else if is_rate_limit_log(codespace, code, raw_log) {
        RATE_LIMITED_REASON.to_string()
    } else {
        reason_for(code, codespace).to_string()
    };
    Some(QoreTxError {
        code,
        codespace: codespace.to_string(),
        reason,
        raw_log: raw_log.to_string(),
        tx_hash: String::new(),
    })
}

/// The canonical descriptions for the root (`"sdk"`) codespace ABCI codes.
fn sdk_reason(code: u32) -> Option<&'static str> {
    Some(match code {
        1 => "internal error",
        2 => "tx parse error",
        3 => "invalid sequence",
        4 => "unauthorized",
        5 => "insufficient funds",
        6 => "unknown request",
        7 => "invalid address",
        8 => "invalid pubkey",
        9 => "unknown address",
        10 => "invalid coins",
        11 => "out of gas",
        12 => "memo too large",
        13 => "insufficient fee",
        14 => "maximum number of signatures exceeded",
        15 => "no signatures supplied",
        16 => "failed to marshal JSON bytes",
        17 => "failed to unmarshal JSON bytes",
        18 => "invalid request",
        19 => "tx already in mempool",
        20 => "mempool is full",
        21 => "tx too large",
        22 => "key not found",
        23 => "invalid account password",
        24 => "invalid signature",
        25 => "no concrete type registered",
        26 => "unpacking protobuf message failed",
        27 => "invalid gas adjustment",
        28 => "invalid height",
        29 => "invalid version",
        30 => "invalid chain id",
        31 => "invalid type",
        32 => "tx timeout height",
        33 => "unknown extension options",
        35 => "invalid gas limit",
        _ => return None,
    })
}

/// The per-module codespace tables (Native + QoreChain). Only the commonly
/// surfaced codes are enumerated; unmapped codes fall back to a generic message.
fn module_reason(codespace: &str, code: u32) -> Option<&'static str> {
    let reason = match (codespace, code) {
        ("bank", 2) => "no inputs to send transaction",
        ("bank", 3) => "no outputs to send transaction",
        ("bank", 4) => "sum inputs != sum outputs",
        ("bank", 5) => "send transactions are disabled",
        ("staking", 2) => "validator does not exist",
        ("staking", 3) => "validator already exist for this operator address",
        ("staking", 13) => "too many shares to undelegate",
        ("staking", 15) => "insufficient delegation shares",
        ("distribution", 2) => "no delegation distribution info",
        ("distribution", 3) => "no validator distribution info",
        ("distribution", 6) => "set withdraw address disabled",
        ("gov", 2) => "unknown proposal",
        ("gov", 3) => "inactive proposal",
        ("gov", 4) => "already active proposal",
        ("gov", 5) => "invalid proposal content",
        ("authz", 2) => "authorization not found",
        ("authz", 3) => "invalid expiration time",
        ("feegrant", 2) => "fee limit exceeded",
        ("feegrant", 3) => "fee allowance already exists",
        ("feegrant", 4) => "fee allowance expired",
        // abstractaccount authenticator-lane errors (v3.1.84 / v3.1.85). The
        // relayer-authorized MsgExecuteEVM / MsgExecuteCosmos fail-closed on these.
        ("abstractaccount", 5) => "spending limit exceeded",
        ("abstractaccount", 6) => "session key expired",
        ("abstractaccount", 10) => "authenticator not permitted for this action",
        // The nonce is not the linked key's authenticator sequence (a per-key
        // counter, not the account's EVM nonce).
        ("abstractaccount", 11) => "authenticator signature replay binding mismatch",
        // pqc hybrid-signature verification (surfaced on a MsgRotatePQCKey whose
        // dual signatures or hybrid cosignature do not verify).
        ("pqc", 21) => "hybrid PQC signature verification failed",
        // v3.2.0 EVM authorisation window. Code 28 covers two states with
        // different remedies (invalid window vs. no registered post-quantum
        // key); crate::evm_window::classify_evm_window_error reads the message
        // text to tell them apart.
        ("pqc", 26) => {
            "no open EVM authorisation window — open one with MsgOpenEVMWindow on the \
             Cosmos lane, THEN read the nonce, THEN sign the EVM transaction"
        }
        ("pqc", 27) => {
            "EVM authorisation window exhausted — it ran out of blocks, transactions or \
             value; open a new one with MsgOpenEVMWindow"
        }
        ("pqc", 28) => {
            "invalid EVM authorisation window, or the account has no registered \
             post-quantum key — check the log text to tell the two apart"
        }
        // v3.2.2 EIP-7702 delegation consent (crate::evm_delegation).
        ("pqc", 60) => {
            "no post-quantum consent for this EIP-7702 delegation — broadcast \
             MsgAuthorizeEVMDelegation for exactly this delegate first"
        }
        // v3.2.3 registration integrity and key maintenance (crate::key_integrity).
        ("pqc", 230) => {
            "the registration carries no usable post-quantum key (classical_only, empty, \
             or a degenerate key) — register a real ML-DSA-87 key"
        }
        ("pqc", 231) => "PQC proof of possession does not verify",
        ("pqc", 232) => {
            "this account used that PQC key before — rotate or migrate to a key it has never had"
        }
        ("pqc", 233) => "no active PQC signature algorithm would remain",
        ("pqc", 234) => {
            "an account with a registered PQC key must send key registration or migration \
             with the hybrid signature (PqcDx::build_hybrid with the current key)"
        }
        // v3.2.4 staking tiers (crate::stakingtier; the kinds are in
        // crate::stakingtier::stakingtier_error_kind).
        ("stakingtier", 2) => "invalid staking-tier parameters",
        ("stakingtier", 3) => "staking tiers are not active on this network yet",
        ("stakingtier", 4) => "staking tiers are switched off by governance",
        ("stakingtier", 5) => "this lock term is not offered (see the module parameters)",
        ("stakingtier", 6) => "invalid lock amount (below the minimum, or not positive)",
        ("stakingtier", 7) => {
            "not enough unlocked delegation to this validator to lock that amount"
        }
        ("stakingtier", 8) => "lock not found",
        ("stakingtier", 9) => "the lock belongs to another delegator",
        ("stakingtier", 10) => "the lock has already expired; nothing to unlock early",
        ("stakingtier", 11) => "too many open locks for this delegator",
        ("stakingtier", 12) => "no bonus to claim",
        ("stakingtier", 13) => {
            "this stake is locked; undelegating or redelegating it waits for the lock to end"
        }
        ("pqc", 61) => {
            "invalid EIP-7702 delegation request — check the delegate address and the \
             blocks bound, and that the account has a registered PQC key"
        }
        _ => return None,
    };
    Some(reason)
}

/// The QoreChain custom-module codespaces recognized by the decoder. A code that
/// is not specifically mapped still resolves to `"unknown <codespace> error"`
/// rather than the root `"unknown error"`.
const QORE_CODESPACES: &[&str] = &[
    "pqc",
    "amm",
    "bridge",
    "rdk",
    "multilayer",
    "svm",
    "lightnode",
    "license",
    "abstractaccount",
    "crossvm",
    "rlconsensus",
    "stakingtier",
];

const KNOWN_MODULE_CODESPACES: &[&str] = &[
    "bank",
    "staking",
    "distribution",
    "gov",
    "authz",
    "feegrant",
];

fn reason_for(code: u32, codespace: &str) -> String {
    if codespace.is_empty() || codespace == "sdk" {
        return sdk_reason(code).unwrap_or("unknown error").to_string();
    }
    if let Some(reason) = module_reason(codespace, code) {
        return reason.to_string();
    }
    if KNOWN_MODULE_CODESPACES.contains(&codespace) || QORE_CODESPACES.contains(&codespace) {
        return format!("unknown {codespace} error");
    }
    format!("unknown {codespace} error")
}
