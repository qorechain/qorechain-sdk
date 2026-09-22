//! Crate-wide error type.

use thiserror::Error;

/// Errors returned across the QoreChain SDK.
#[derive(Debug, Error)]
pub enum Error {
    /// The named network preset is unknown.
    #[error("unknown network: {0}")]
    UnknownNetwork(String),

    /// A required endpoint URL was not configured.
    #[error("endpoint \"{0}\" is not configured — pass it via create_client endpoints")]
    MissingEndpoint(String),

    /// A decimal/base amount or exponent was invalid.
    #[error("{0}")]
    Denom(String),

    /// A bech32 or hex address was invalid.
    #[error("{0}")]
    Address(String),

    /// The BIP-39 mnemonic failed word-list and/or checksum validation.
    #[error("invalid mnemonic")]
    InvalidMnemonic,

    /// HD derivation produced an invalid key (caller should try the next index).
    #[error("HD derivation error: {0}")]
    Derivation(String),

    /// A post-quantum (ML-DSA-87) operation failed.
    #[error("PQC error: {0}")]
    Pqc(String),

    /// An EVM authorisation window bound was violated client-side, or a window
    /// status could not be parsed. The message names the bound. See
    /// [`crate::evm_window`].
    #[error("evm window: {0}")]
    EvmWindow(String),

    /// A non-2xx HTTP response was received.
    #[error("HTTP {status} for {url}")]
    Http {
        /// HTTP status code.
        status: u16,
        /// Requested URL.
        url: String,
        /// Response body (may be empty).
        body: String,
    },

    /// A JSON-RPC response carried an error member.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// JSON-RPC error code.
        code: i64,
        /// JSON-RPC error message.
        message: String,
    },

    /// A network/transport error occurred.
    #[error("transport error: {0}")]
    Transport(String),

    /// A response body could not be parsed as expected JSON.
    #[error("invalid response: {0}")]
    InvalidResponse(String),

    /// A broadcast/confirmed transaction returned a non-zero ABCI result code.
    #[error(transparent)]
    Tx(#[from] crate::tx::QoreTxError),

    /// The post-quantum sign-bytes version (v1 / v2) could not be chosen or
    /// parsed. The message says what to pass instead (a REST URL, or an explicit
    /// version). See [`crate::signbytes`].
    #[error("sign-bytes: {0}")]
    SignBytes(String),

    /// An API was removed because it was unsafe. The message names the
    /// replacement and, where funds may be at risk, what the caller must do.
    #[error("{0}")]
    Removed(String),
}

/// Convenience result type used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Transport(e.to_string())
    }
}
