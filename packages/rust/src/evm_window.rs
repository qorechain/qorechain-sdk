//! The EVM authorisation window (chain v3.2.0, `x/pqc`).
//!
//! From v3.2.0 an EVM-lane transaction is admitted only from an account that
//!
//! 1. has a **registered post-quantum key**, and
//! 2. has an **open, unexhausted authorisation window**.
//!
//! The window is opened by an ordinary Cosmos-lane message
//! (`/qorechain.pqc.v1.MsgOpenEVMWindow`) which therefore carries the account's
//! hybrid (classical + ML-DSA-87) signature: the classical key alone can never
//! open a window. That is the whole point of the design — MetaMask and any other
//! EVM client keep working unmodified *inside* a window, and the post-quantum
//! key authorises the window itself.
//!
//! This module carries the client surface: the bounds the chain enforces in
//! `ValidateBasic` (so a caller fails fast instead of paying for a refused
//! transaction), the `evm_window` status query with exact-integer parsing, and a
//! classifier for the four refusals an EVM send can hit. The message composers
//! live with every other message, as [`crate::msg::pqc::open_evm_window`] and
//! [`crate::msg::pqc::close_evm_window`].
//!
//! Nothing here opens a window implicitly. A wallet is expected to show an
//! explicit authorisation step; a silent open would spend the user's funds on a
//! transaction they never saw.
//!
//! # Three traps
//!
//! **Ordering.** QoreChain unifies the identity, so the Cosmos sequence *is* the
//! EVM nonce, and opening a window **advances it** (measured on the testnet: 2
//! before, 3 after). The order is: open the window, **then** read the nonce,
//! **then** sign the EVM transaction. Signing first gives `nonce too low`.
//!
//! **`max_value` covers the fee.** The bound counts the transferred value
//! **plus the maximum fee** each admitted transaction could pay (gas limit × gas
//! fee cap), because the holder of the classical key sets the gas price and a
//! value-only bound would leave the account drainable through fees. Measured on
//! the testnet: a 1,000 uqor transfer with a 21,000 gas limit at 112.5 gwei
//! consumed 3,363 uqor of the window. Wei to uqor rounds **up**, so a series of
//! sub-uqor transfers cannot drain a window that never appears to move.
//!
//! **Do not print "about 24 hours".** The chain constant describes
//! [`MAX_EVM_WINDOW_BLOCKS`] as about 24 hours at 5s blocks, but no QoreChain
//! network runs at 5s: the testnet is at ~1.03 s (17280 blocks is about 5 hours)
//! and mainnet at ~3.1 s (about 15 hours). Say "up to 17280 blocks", or compute
//! the duration from the chain's recent block time.

use crate::error::{Error, Result};
use crate::query::RestClient;
use serde_json::Value;

/// The chain's `MaxEVMWindowBlocks`: the longest a window may stay open.
/// Counted in BLOCKS, never in wall-clock time — see the module docs.
pub const MAX_EVM_WINDOW_BLOCKS: u64 = 17_280;

/// The chain's `MaxEVMWindowTxs`: the most transactions a window may admit.
pub const MAX_EVM_WINDOW_TXS: u64 = 1_000;

/// The codespace every window refusal is reported under.
pub const EVM_WINDOW_CODESPACE: &str = "pqc";

/// `pqc` 26 — the account has no open EVM authorisation window.
pub const ERR_NO_EVM_WINDOW: u32 = 26;

/// `pqc` 27 — the window ran out of blocks, transactions or value.
pub const ERR_EVM_WINDOW_EXHAUSTED: u32 = 27;

/// `pqc` 28 — the window is invalid **or** the account has no registered
/// post-quantum key. The two are distinguished by the chain's message text,
/// which [`classify_evm_window_error`] inspects.
pub const ERR_INVALID_EVM_WINDOW: u32 = 28;

/// The gRPC query path of the window status query.
pub const EVM_WINDOW_QUERY_PATH: &str = "/qorechain.pqc.v1.Query/EVMWindow";

// --------------------------------------------------------------------------- //
// Client-side validation (mirrors the chain's ValidateBasic)
// --------------------------------------------------------------------------- //

/// The validated bounds of a window, as the chain stores them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmWindowParams {
    /// How long the window stays open, counted from the block that opens it.
    pub blocks: u64,
    /// How many EVM transactions the window admits.
    pub max_txs: u64,
    /// The total the window admits in uqor, value PLUS maximum fee, as an exact
    /// integer string (`cosmos.Int`).
    pub max_value: String,
}

/// Checks `blocks` against the chain's bound.
///
/// # Errors
///
/// [`Error::EvmWindow`] when `blocks` is not in `1..=17280`.
pub fn validate_evm_window_blocks(blocks: u64) -> Result<u64> {
    if blocks == 0 || blocks > MAX_EVM_WINDOW_BLOCKS {
        return Err(Error::EvmWindow(format!(
            "blocks must be in 1..={MAX_EVM_WINDOW_BLOCKS} (MaxEVMWindowBlocks), got {blocks}"
        )));
    }
    Ok(blocks)
}

/// Checks `max_txs` against the chain's bound.
///
/// Zero is refused explicitly by the chain: a window that admits nothing is a
/// mistake, not a policy.
///
/// # Errors
///
/// [`Error::EvmWindow`] when `max_txs` is not in `1..=1000`.
pub fn validate_evm_window_max_txs(max_txs: u64) -> Result<u64> {
    if max_txs == 0 || max_txs > MAX_EVM_WINDOW_TXS {
        return Err(Error::EvmWindow(format!(
            "max_txs must be in 1..={MAX_EVM_WINDOW_TXS} (MaxEVMWindowTxs), got {max_txs}"
        )));
    }
    Ok(max_txs)
}

/// Normalizes `max_value` to the integer uqor string the chain expects.
///
/// `max_value` is a `cosmos.Int`: an exact integer, never a float. It bounds the
/// transferred value **plus** the maximum fee (gas limit × gas fee cap).
///
/// # Errors
///
/// [`Error::EvmWindow`] when it is not a positive integer.
pub fn validate_evm_window_max_value(max_value: &str) -> Result<String> {
    let text = max_value.trim();
    let parsed: u128 = text.parse().map_err(|_| {
        if text.starts_with('-') {
            Error::EvmWindow(format!("max_value must be greater than 0 uqor, got {text}"))
        } else {
            Error::EvmWindow(format!(
                "max_value must be a positive integer string in uqor \
                 (cosmos.Int, no decimals), got {max_value:?}"
            ))
        }
    })?;
    if parsed == 0 {
        return Err(Error::EvmWindow(format!(
            "max_value must be greater than 0 uqor, got {parsed}"
        )));
    }
    Ok(parsed.to_string())
}

/// Validates all three bounds at once, mirroring the chain's `ValidateBasic`.
///
/// Every field is required: the chain refuses an omitted field rather than
/// defaulting it, so this helper takes no defaults either.
///
/// # Errors
///
/// [`Error::EvmWindow`] naming the bound that was violated.
pub fn validate_evm_window_params(
    blocks: u64,
    max_txs: u64,
    max_value: &str,
) -> Result<EvmWindowParams> {
    Ok(EvmWindowParams {
        blocks: validate_evm_window_blocks(blocks)?,
        max_txs: validate_evm_window_max_txs(max_txs)?,
        max_value: validate_evm_window_max_value(max_value)?,
    })
}

// --------------------------------------------------------------------------- //
// Status query
// --------------------------------------------------------------------------- //

/// The REST (LCD) path of the window status for `address`.
///
/// The route answers `200` with `found: false` when no window is stored, so it
/// is safe to poll.
pub fn evm_window_path(address: &str) -> String {
    format!("/qorechain/pqc/v1/evm_window/{address}")
}

/// A decoded `evm_window` status.
///
/// Every numeric field is an exact integer: the chain renders them as JSON
/// strings precisely because several are `cosmos.Int` values that do not fit a
/// float. The value fields are `u128`, so nothing is ever truncated at 2^53 and
/// nothing is ever parsed as a float.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EvmWindowStatus {
    /// Whether a window is stored at all. When `false`, every other field is
    /// zero.
    pub found: bool,
    /// Whether the stored window still admits at least one zero-value
    /// transaction at the current height. A stored window may be expired or
    /// exhausted, so `found` alone is not enough.
    pub live: bool,
    /// The height the window was opened at.
    pub opened_height: u64,
    /// The height the window expires at.
    pub expiry_height: u64,
    /// How many EVM transactions the window admits in total.
    pub max_txs: u64,
    /// How many it has admitted so far.
    pub used_txs: u64,
    /// The total uqor the window admits (value plus maximum fee).
    pub max_value: u128,
    /// The uqor consumed so far (value plus the fee actually charged).
    pub used_value: u128,
    /// Blocks left before expiry.
    pub remaining_blocks: u64,
    /// Transactions left.
    pub remaining_txs: u64,
    /// uqor left.
    pub remaining_value: u128,
}

/// Reads an exact integer from a JSON field that may be a string or a number.
/// A float would already have lost precision above 2^53, so it is refused rather
/// than silently truncated.
fn as_u128(payload: &Value, field: &str) -> Result<u128> {
    match &payload[field] {
        Value::Null => Ok(0),
        Value::String(s) if s.trim().is_empty() => Ok(0),
        Value::String(s) => s.trim().parse::<u128>().map_err(|_| {
            Error::EvmWindow(format!(
                "evm_window field {field:?} is not an integer: {s:?}"
            ))
        }),
        Value::Number(n) => n.as_u64().map(u128::from).ok_or_else(|| {
            Error::EvmWindow(format!("evm_window field {field:?} is not an integer: {n}"))
        }),
        other => Err(Error::EvmWindow(format!(
            "evm_window field {field:?} is not an integer: {other}"
        ))),
    }
}

/// Same as [`as_u128`], narrowed to the height/count fields the chain declares
/// as `uint64`.
fn as_u64(payload: &Value, field: &str) -> Result<u64> {
    let value = as_u128(payload, field)?;
    u64::try_from(value).map_err(|_| {
        Error::EvmWindow(format!(
            "evm_window field {field:?} does not fit a uint64: {value}"
        ))
    })
}

/// Parses an `evm_window` REST / gRPC-gateway payload into a typed status.
///
/// Handles both shapes the route returns: `{"found": false}` when no window is
/// stored, and the full live shape. Integers keep full precision.
///
/// # Errors
///
/// [`Error::EvmWindow`] when a numeric field is not an exact integer.
pub fn parse_evm_window(payload: &Value) -> Result<EvmWindowStatus> {
    let found = payload["found"].as_bool().unwrap_or(false);
    if !found {
        return Ok(EvmWindowStatus::default());
    }
    Ok(EvmWindowStatus {
        found: true,
        live: payload["live"].as_bool().unwrap_or(false),
        opened_height: as_u64(payload, "opened_height")?,
        expiry_height: as_u64(payload, "expiry_height")?,
        max_txs: as_u64(payload, "max_txs")?,
        used_txs: as_u64(payload, "used_txs")?,
        max_value: as_u128(payload, "max_value")?,
        used_value: as_u128(payload, "used_value")?,
        remaining_blocks: as_u64(payload, "remaining_blocks")?,
        remaining_txs: as_u64(payload, "remaining_txs")?,
        remaining_value: as_u128(payload, "remaining_value")?,
    })
}

/// Reads the EVM authorisation window status for `address` over REST.
///
/// # Errors
///
/// Transport / HTTP errors from the REST client, or [`Error::EvmWindow`] when
/// the payload cannot be parsed.
pub async fn get_evm_window(rest: &RestClient, address: &str) -> Result<EvmWindowStatus> {
    let body = rest.get(&evm_window_path(address), &[]).await?;
    parse_evm_window(&body)
}

// --------------------------------------------------------------------------- //
// Refusal classifier
// --------------------------------------------------------------------------- //

/// What an EVM-lane refusal turned out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvmWindowRefusal {
    /// No window is open. Remedy: open one.
    NoWindow,
    /// A window exists but has nothing left (blocks, transactions or value).
    WindowExhausted,
    /// The window does not cover this transaction.
    InvalidWindow,
    /// The account has no registered post-quantum key. This is its OWN state,
    /// separate from "no open window": no window can be opened until a key is
    /// registered.
    NoPqcKey,
}

impl EvmWindowRefusal {
    /// A short stable identifier, matching the other SDKs' kind strings.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoWindow => "no_window",
            Self::WindowExhausted => "window_exhausted",
            Self::InvalidWindow => "invalid_window",
            Self::NoPqcKey => "no_pqc_key",
        }
    }

    /// What the caller must do about it, phrased for a wallet to show a user.
    pub fn remedy(&self) -> &'static str {
        match self {
            Self::NoWindow => {
                "open an EVM authorisation window first (msg::pqc::open_evm_window, signed \
                 on the Cosmos lane with the account's post-quantum key), THEN read the \
                 nonce, THEN sign the EVM transaction — opening the window advances the nonce"
            }
            Self::WindowExhausted => {
                "the window ran out of blocks, transactions or value — open a new one \
                 (msg::pqc::open_evm_window); check the evm_window query to see which \
                 bound ran out"
            }
            Self::InvalidWindow => {
                "the open window does not cover this transaction — re-open it with bounds \
                 that cover the value PLUS the maximum fee (gas limit x gas fee cap)"
            }
            Self::NoPqcKey => {
                "register a post-quantum key first (msg::pqc::register_pqc_key_v2 / \
                 PqcDx::ensure_pqc_registered) — an account without one cannot open a \
                 window and cannot use the EVM lane"
            }
        }
    }
}

impl std::fmt::Display for EvmWindowRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// The chain's own texts. Over the EVM JSON-RPC lane the refusal arrives as a
// broadcast error carrying this text and NO codespace, so the text has to be
// matched as well as the code. Both spellings of "authorisation" are accepted.
const NO_PQC_KEY_TEXTS: &[&str] = &[
    "no registered post-quantum key",
    "no registered post quantum key",
];
const NO_WINDOW_TEXTS: &[&str] = &[
    "no open evm authorisation window",
    "no open evm authorization window",
];
const EXHAUSTED_TEXTS: &[&str] = &[
    "evm authorisation window is exhausted",
    "evm authorization window is exhausted",
    "evm authorisation window exhausted",
    "evm authorization window exhausted",
];
const INVALID_TEXTS: &[&str] = &[
    "invalid evm authorisation window",
    "invalid evm authorization window",
];

/// Classifies an EVM-lane refusal, or returns `None` if it is not one.
///
/// Matches on the `pqc` codespace codes 26/27/28 **and** on the chain's own
/// message text, because over EVM JSON-RPC the refusal arrives as a broadcast
/// error that carries the text but not the codespace.
///
/// `pqc` 28 covers two states the chain reports with one code: an invalid
/// window, and an account with no registered post-quantum key. They have
/// different remedies, so the text decides between them and a bare code 28 with
/// no text classifies as [`EvmWindowRefusal::InvalidWindow`].
///
/// A numeric code means nothing outside its codespace, so `code` is consulted
/// only when `codespace` is `pqc`.
pub fn classify_evm_window_error(
    code: Option<u32>,
    codespace: &str,
    message: &str,
) -> Option<EvmWindowRefusal> {
    let text = message.to_lowercase();
    if !text.is_empty() {
        if NO_PQC_KEY_TEXTS.iter().any(|t| text.contains(t)) {
            return Some(EvmWindowRefusal::NoPqcKey);
        }
        if NO_WINDOW_TEXTS.iter().any(|t| text.contains(t)) {
            return Some(EvmWindowRefusal::NoWindow);
        }
        if EXHAUSTED_TEXTS.iter().any(|t| text.contains(t)) {
            return Some(EvmWindowRefusal::WindowExhausted);
        }
        if INVALID_TEXTS.iter().any(|t| text.contains(t)) {
            return Some(EvmWindowRefusal::InvalidWindow);
        }
    }
    if codespace == EVM_WINDOW_CODESPACE {
        return match code {
            Some(ERR_NO_EVM_WINDOW) => Some(EvmWindowRefusal::NoWindow),
            Some(ERR_EVM_WINDOW_EXHAUSTED) => Some(EvmWindowRefusal::WindowExhausted),
            Some(ERR_INVALID_EVM_WINDOW) => Some(EvmWindowRefusal::InvalidWindow),
            _ => None,
        };
    }
    None
}

/// Classifies a [`crate::tx::QoreTxError`] as an EVM-lane refusal, or returns
/// `None`. The convenience wrapper a send path uses to turn the chain's refusal
/// into something a wallet can act on — it never opens a window, because the
/// authorisation step is always explicit.
pub fn classify_tx_error(err: &crate::tx::QoreTxError) -> Option<EvmWindowRefusal> {
    classify_evm_window_error(Some(err.code), &err.codespace, &err.raw_log)
}
