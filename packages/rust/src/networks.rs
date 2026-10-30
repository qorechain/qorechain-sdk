//! Built-in network presets for the QoreChain Rust SDK.
//!
//! - `mainnet` (`qorechain-vladi`, EVM chain id 9801) and `testnet`
//!   (`qorechain-diana`, EVM chain id 9800) default to the public endpoints.
//!   The public testnet endpoints have a per-IP rate limit at the edge; for
//!   production, run your own node (or use a provider's) and pass its URLs.
//! - `localnet` (`qorechain-devnet`) points at a node on this machine (REST
//!   `:1317`, gRPC `:9090`, RPC `:26657`, EVM `:8545` / `:8546`, SVM `:8899`):
//!   the localhost values the `mainnet` / `testnet` presets had before 0.12.0.
//!
//! Neither public network serves gRPC, mainnet has no public EVM WebSocket, and
//! no SVM endpoint is preset because SVM transactions are not open on either
//! network: those endpoints are `None`, and code that needs one returns
//! [`Error::EndpointNotConfigured`] instead of guessing (see
//! [`NetworkConfig::endpoint`]). Explicit overrides (`ClientBuilder::rest`,
//! `::grpc`, ...) replace any preset value.
//!
//! `https://download.qore.host/<net>/latest.json` is a release manifest
//! (version, peers, state sync), not an endpoint.

use crate::error::{Error, Result};

/// bech32 human-readable prefixes used across QoreChain address types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bech32Prefixes {
    /// Account address prefix (e.g. `qor`).
    pub account: String,
    /// Validator operator address prefix (e.g. `qorvaloper`).
    pub validator: String,
    /// Validator consensus address prefix (e.g. `qorvalcons`).
    pub consensus: String,
}

/// Display and base denomination metadata for the network's staking coin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoinInfo {
    /// Display denom (e.g. `QOR`).
    pub display: String,
    /// Base denom (e.g. `uqor`).
    pub base: String,
    /// Decimal exponent (1 display = 10^exponent base).
    pub exponent: u32,
}

/// Service endpoints for talking to a network across its supported VMs.
///
/// `grpc`, `evm_ws` and `svm_rpc` are optional: a preset leaves one `None`
/// when the network serves no public endpoint of that kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// Native REST (LCD) endpoint.
    pub rest: String,
    /// Native gRPC endpoint (`None` on the public presets).
    pub grpc: Option<String>,
    /// Consensus RPC endpoint.
    pub rpc: String,
    /// EVM JSON-RPC endpoint.
    pub evm_rpc: String,
    /// EVM WebSocket endpoint (`None` on the mainnet preset).
    pub evm_ws: Option<String>,
    /// SVM JSON-RPC endpoint (`None` on the public presets: SVM transactions
    /// are not open).
    pub svm_rpc: Option<String>,
}

/// A fully described network preset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkConfig {
    /// Preset name.
    pub name: String,
    /// Whether the network is live.
    pub live: bool,
    /// Chain ID.
    pub chain_id: Option<String>,
    /// bech32 prefixes.
    pub bech32: Bech32Prefixes,
    /// Staking coin metadata.
    pub coin: CoinInfo,
    /// Service endpoints.
    pub endpoints: Option<Endpoints>,
}

fn bech32_prefixes() -> Bech32Prefixes {
    Bech32Prefixes {
        account: "qor".into(),
        validator: "qorvaloper".into(),
        consensus: "qorvalcons".into(),
    }
}

fn coin_info() -> CoinInfo {
    CoinInfo {
        display: "QOR".into(),
        base: "uqor".into(),
        exponent: 6,
    }
}

/// One preset row: name, chain id, REST, gRPC, RPC, EVM JSON-RPC, EVM
/// WebSocket, SVM JSON-RPC, EVM chain id.
type PresetRow = (
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
    &'static str,
    &'static str,
    Option<&'static str>,
    Option<&'static str>,
    u64,
);

/// THE preset table: every built-in hostname lives here and nowhere else.
#[rustfmt::skip]
const PRESETS: [PresetRow; 3] = [
    ("testnet", "qorechain-diana",
     "https://api-testnet.qore.host", None, "https://rpc-testnet.qore.host",
     "https://evm-testnet.qore.host", Some("wss://evm-ws-testnet.qore.host"), None, 9800),
    ("mainnet", "qorechain-vladi",
     "https://api.qore.host", None, "https://rpc.qore.host",
     "https://evm.qore.host", None, None, 9801),
    ("localnet", "qorechain-devnet",
     "http://localhost:1317", Some("http://localhost:9090"), "http://localhost:26657",
     "http://localhost:8545", Some("ws://localhost:8546"), Some("http://localhost:8899"), 9800),
];

/// The EVM chain id (EIP-155) of a preset: 9801 mainnet, 9800 testnet. The
/// `localnet` value is the testnet one; a local chain may use another.
pub fn evm_chain_id(name: &str) -> Option<u64> {
    PRESETS.iter().find(|p| p.0 == name).map(|p| p.8)
}

/// Returns the built-in network presets in stable order:
/// `[testnet, mainnet, localnet]`.
pub fn networks() -> Vec<NetworkConfig> {
    PRESETS
        .iter()
        .map(
            |&(name, chain_id, rest, grpc, rpc, evm_rpc, evm_ws, svm_rpc, _)| NetworkConfig {
                name: name.into(),
                live: true,
                chain_id: Some(chain_id.into()),
                bech32: bech32_prefixes(),
                coin: coin_info(),
                endpoints: Some(Endpoints {
                    rest: rest.into(),
                    grpc: grpc.map(Into::into),
                    rpc: rpc.into(),
                    evm_rpc: evm_rpc.into(),
                    evm_ws: evm_ws.map(Into::into),
                    svm_rpc: svm_rpc.map(Into::into),
                }),
            },
        )
        .collect()
}

impl NetworkConfig {
    /// The URL of endpoint `key` (`rest`, `grpc`, `rpc`, `evm_rpc`, `evm_ws`,
    /// `svm_rpc`).
    ///
    /// # Errors
    ///
    /// [`Error::EndpointNotConfigured`] naming the endpoint and the preset when it is
    /// not configured (for example `evm_ws` on mainnet, `grpc` and `svm_rpc` on
    /// the public presets), instead of falling back to localhost;
    /// [`Error::InvalidInput`] for an unknown key.
    pub fn endpoint(&self, key: &str) -> Result<String> {
        let eps = self.endpoints.as_ref();
        let value = match key {
            "rest" => eps.map(|e| e.rest.clone()),
            "rpc" => eps.map(|e| e.rpc.clone()),
            "evm_rpc" => eps.map(|e| e.evm_rpc.clone()),
            "grpc" => eps.and_then(|e| e.grpc.clone()),
            "evm_ws" => eps.and_then(|e| e.evm_ws.clone()),
            "svm_rpc" => eps.and_then(|e| e.svm_rpc.clone()),
            other => return Err(Error::InvalidInput(format!("unknown endpoint {other:?}"))),
        };
        match value {
            Some(v) if !v.is_empty() => Ok(v),
            _ => Err(Error::EndpointNotConfigured {
                endpoint: key.to_string(),
                network: self.name.clone(),
            }),
        }
    }
}

/// Resolves a network preset by name.
///
/// Returns an error if the named network is unknown.
pub fn get_network(name: &str) -> Result<NetworkConfig> {
    networks()
        .into_iter()
        .find(|n| n.name == name)
        .ok_or_else(|| Error::UnknownNetwork(name.to_string()))
}

/// Lists the known network preset names without any liveness check.
pub fn list_networks() -> Vec<String> {
    PRESETS.iter().map(|p| p.0.to_string()).collect()
}
