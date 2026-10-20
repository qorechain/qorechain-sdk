//! Async REST (LCD) and JSON-RPC read clients for QoreChain.
//!
//! [`RestClient`] wraps the standard QoreChain Native bank endpoint plus QoreChain's
//! custom module read routes under `/qorechain/<module>/v1/...`.
//! [`JsonRpcClient`] is a generic JSON-RPC 2.0 transport, and [`QorClient`]
//! layers the typed `qor_*` namespace on top of it. All HTTP is performed
//! through a shared `reqwest::Client` so tests can target a local mock server
//! without real network access.

mod jsonrpc;
mod qor;
mod rest;
mod typed;

pub use jsonrpc::JsonRpcClient;
pub use qor::{QorClient, QOR_METHODS};
pub use rest::RestClient;
pub use typed::TypedQueryClient;

/// Default `User-Agent` sent with every request.
pub(crate) const DEFAULT_USER_AGENT: &str = "qorechain-rust-sdk";

/// Whole-request timeout of the HTTP client the SDK creates itself.
pub(crate) const DEFAULT_HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Connect timeout of the HTTP client the SDK creates itself.
pub(crate) const DEFAULT_HTTP_CONNECT_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(10);

/// The HTTP client the SDK uses when the caller supplies none: a stalled
/// connection fails after [`DEFAULT_HTTP_TIMEOUT`] instead of hanging. A client
/// passed in by the caller (`with_client`, `http_client`) is used as given.
pub(crate) fn default_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(DEFAULT_HTTP_TIMEOUT)
        .connect_timeout(DEFAULT_HTTP_CONNECT_TIMEOUT)
        .build()
        .expect("the default HTTP client builds")
}
