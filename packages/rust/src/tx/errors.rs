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
    Some(QoreTxError {
        code,
        codespace: codespace.to_string(),
        reason: reason_for(code, codespace).to_string(),
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

/// The per-module codespace tables (Cosmos + QoreChain). Only the commonly
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
