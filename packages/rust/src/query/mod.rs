//! Async REST (LCD) and JSON-RPC read clients for QoreChain.
//!
//! [`RestClient`] wraps the standard Cosmos SDK bank endpoint plus QoreChain's
//! custom module read routes under `/qorechain/<module>/v1/...`.
//! [`JsonRpcClient`] is a generic JSON-RPC 2.0 transport, and [`QorClient`]
//! layers the typed `qor_*` namespace on top of it. All HTTP is performed
//! through a shared `reqwest::Client` so tests can target a local mock server
//! without real network access.

mod jsonrpc;
mod qor;
mod rest;

pub use jsonrpc::JsonRpcClient;
pub use qor::{QorClient, QOR_METHODS};
pub use rest::RestClient;

/// Default `User-Agent` sent with every request.
pub(crate) const DEFAULT_USER_AGENT: &str = "qorechain-rust-sdk";
