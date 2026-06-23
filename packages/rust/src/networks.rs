//! Built-in network presets for the QoreChain Rust SDK.
//!
//! The `testnet` preset is fully populated and live; its endpoints default to
//! localhost ports so the SDK works out of the box against a locally running
//! node, and callers can override them with real hostnames. The `mainnet`
//! preset is a placeholder: mainnet is not yet live, so it carries no chain ID
//! and no endpoints, and [`get_network`] returns an error if asked for it.

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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    /// Cosmos REST (LCD) endpoint.
    pub rest: String,
    /// Cosmos gRPC endpoint.
    pub grpc: String,
    /// Consensus RPC endpoint.
    pub rpc: String,
    /// EVM JSON-RPC endpoint.
    pub evm_rpc: String,
    /// EVM WebSocket endpoint.
    pub evm_ws: String,
    /// SVM JSON-RPC endpoint.
    pub svm_rpc: String,
}

/// A fully described network preset. `endpoints` is `None` for networks that
/// are not yet live (e.g. mainnet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkConfig {
    /// Preset name.
    pub name: String,
    /// Whether the network is live.
    pub live: bool,
    /// Chain ID; `None` for not-yet-live networks.
    pub chain_id: Option<String>,
    /// bech32 prefixes.
    pub bech32: Bech32Prefixes,
    /// Staking coin metadata.
    pub coin: CoinInfo,
    /// Service endpoints; `None` for not-yet-live networks.
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

/// Returns the built-in network presets in stable order: `[testnet, mainnet]`.
pub fn networks() -> Vec<NetworkConfig> {
    vec![
        NetworkConfig {
            name: "testnet".into(),
            live: true,
            chain_id: Some("qorechain-diana".into()),
            bech32: bech32_prefixes(),
            coin: coin_info(),
            endpoints: Some(Endpoints {
                rest: "http://localhost:1317".into(),
                grpc: "http://localhost:9090".into(),
                rpc: "http://localhost:26657".into(),
                evm_rpc: "http://localhost:8545".into(),
                evm_ws: "ws://localhost:8546".into(),
                svm_rpc: "http://localhost:8899".into(),
            }),
        },
        NetworkConfig {
            name: "mainnet".into(),
            live: false,
            chain_id: None,
            bech32: bech32_prefixes(),
            coin: coin_info(),
            endpoints: None,
        },
    ]
}

/// Resolves a network preset by name.
///
/// Returns an error if the named network is unknown or not yet live (e.g.
/// mainnet); for not-yet-live networks the caller should pass custom endpoints.
pub fn get_network(name: &str) -> Result<NetworkConfig> {
    let config = networks()
        .into_iter()
        .find(|n| n.name == name)
        .ok_or_else(|| Error::UnknownNetwork(name.to_string()))?;
    if !config.live {
        return Err(Error::NetworkNotLive(name.to_string()));
    }
    Ok(config)
}

/// Lists the known network preset names without any liveness check.
pub fn list_networks() -> Vec<String> {
    vec!["testnet".into(), "mainnet".into()]
}
