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
}

/// Convenience result type used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Transport(e.to_string())
    }
}
