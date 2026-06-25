//! `qorechain.lightnode.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::lightnode::v1 as pb;
use cosmrs::Any;

/// `/qorechain.lightnode.v1.MsgRegisterLightNode` type URL.
pub const REGISTER_LIGHT_NODE: &str = "/qorechain.lightnode.v1.MsgRegisterLightNode";
/// `/qorechain.lightnode.v1.MsgHeartbeat` type URL.
pub const HEARTBEAT: &str = "/qorechain.lightnode.v1.MsgHeartbeat";
/// `/qorechain.lightnode.v1.MsgDeregisterLightNode` type URL.
pub const DEREGISTER_LIGHT_NODE: &str = "/qorechain.lightnode.v1.MsgDeregisterLightNode";
/// `/qorechain.lightnode.v1.MsgClaimLightNodeRewards` type URL.
pub const CLAIM_LIGHT_NODE_REWARDS: &str = "/qorechain.lightnode.v1.MsgClaimLightNodeRewards";

/// Builds `MsgRegisterLightNode`.
pub fn register_light_node(
    operator: impl Into<String>,
    node_type: impl Into<String>,
    version: impl Into<String>,
    capabilities: Vec<String>,
) -> pb::MsgRegisterLightNode {
    pb::MsgRegisterLightNode {
        operator: operator.into(),
        node_type: node_type.into(),
        version: version.into(),
        capabilities,
    }
}

/// Builds `MsgRegisterLightNode` packed into an `Any`.
pub fn register_light_node_any(
    operator: impl Into<String>,
    node_type: impl Into<String>,
    version: impl Into<String>,
    capabilities: Vec<String>,
) -> Any {
    to_any(
        &register_light_node(operator, node_type, version, capabilities),
        REGISTER_LIGHT_NODE,
    )
}

/// Builds `MsgHeartbeat`.
pub fn heartbeat(operator: impl Into<String>) -> pb::MsgHeartbeat {
    pb::MsgHeartbeat {
        operator: operator.into(),
    }
}

/// Builds `MsgHeartbeat` packed into an `Any`.
pub fn heartbeat_any(operator: impl Into<String>) -> Any {
    to_any(&heartbeat(operator), HEARTBEAT)
}

/// Builds `MsgDeregisterLightNode`.
pub fn deregister_light_node(operator: impl Into<String>) -> pb::MsgDeregisterLightNode {
    pb::MsgDeregisterLightNode {
        operator: operator.into(),
    }
}

/// Builds `MsgDeregisterLightNode` packed into an `Any`.
pub fn deregister_light_node_any(operator: impl Into<String>) -> Any {
    to_any(&deregister_light_node(operator), DEREGISTER_LIGHT_NODE)
}

/// Builds `MsgClaimLightNodeRewards`.
pub fn claim_light_node_rewards(operator: impl Into<String>) -> pb::MsgClaimLightNodeRewards {
    pb::MsgClaimLightNodeRewards {
        operator: operator.into(),
    }
}

/// Builds `MsgClaimLightNodeRewards` packed into an `Any`.
pub fn claim_light_node_rewards_any(operator: impl Into<String>) -> Any {
    to_any(
        &claim_light_node_rewards(operator),
        CLAIM_LIGHT_NODE_REWARDS,
    )
}
