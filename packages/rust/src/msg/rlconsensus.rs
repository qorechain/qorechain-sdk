//! `qorechain.rlconsensus.v1` message composers.

use crate::msg::to_any;
use crate::proto::qorechain::rlconsensus::v1 as pb;
use cosmrs::Any;

/// `/qorechain.rlconsensus.v1.MsgSetAgentMode` type URL.
pub const SET_AGENT_MODE: &str = "/qorechain.rlconsensus.v1.MsgSetAgentMode";
/// `/qorechain.rlconsensus.v1.MsgResumeAgent` type URL.
pub const RESUME_AGENT: &str = "/qorechain.rlconsensus.v1.MsgResumeAgent";
/// `/qorechain.rlconsensus.v1.MsgUpdatePolicy` type URL.
pub const UPDATE_POLICY: &str = "/qorechain.rlconsensus.v1.MsgUpdatePolicy";
/// `/qorechain.rlconsensus.v1.MsgUpdateRewardWeights` type URL.
pub const UPDATE_REWARD_WEIGHTS: &str = "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights";

/// Builds `MsgSetAgentMode`. `mode` is the numeric `AgentMode`
/// (shadow/conservative/autonomous/paused).
pub fn set_agent_mode(authority: impl Into<String>, mode: u32) -> pb::MsgSetAgentMode {
    pb::MsgSetAgentMode {
        authority: authority.into(),
        mode,
    }
}

/// Builds `MsgSetAgentMode` packed into an `Any`.
pub fn set_agent_mode_any(authority: impl Into<String>, mode: u32) -> Any {
    to_any(&set_agent_mode(authority, mode), SET_AGENT_MODE)
}

/// Builds `MsgResumeAgent`.
pub fn resume_agent(authority: impl Into<String>) -> pb::MsgResumeAgent {
    pb::MsgResumeAgent {
        authority: authority.into(),
    }
}

/// Builds `MsgResumeAgent` packed into an `Any`.
pub fn resume_agent_any(authority: impl Into<String>) -> Any {
    to_any(&resume_agent(authority), RESUME_AGENT)
}

/// Builds `MsgUpdatePolicy`. `weights_json` is the JSON-encoded policy weights.
pub fn update_policy(
    authority: impl Into<String>,
    weights_json: impl Into<String>,
) -> pb::MsgUpdatePolicy {
    pb::MsgUpdatePolicy {
        authority: authority.into(),
        weights_json: weights_json.into(),
    }
}

/// Builds `MsgUpdatePolicy` packed into an `Any`.
pub fn update_policy_any(authority: impl Into<String>, weights_json: impl Into<String>) -> Any {
    to_any(&update_policy(authority, weights_json), UPDATE_POLICY)
}

/// Builds `MsgUpdateRewardWeights`.
pub fn update_reward_weights(
    authority: impl Into<String>,
    throughput: impl Into<String>,
    finality: impl Into<String>,
    decentralization: impl Into<String>,
    mev: impl Into<String>,
    failed_txs: impl Into<String>,
) -> pb::MsgUpdateRewardWeights {
    pb::MsgUpdateRewardWeights {
        authority: authority.into(),
        throughput: throughput.into(),
        finality: finality.into(),
        decentralization: decentralization.into(),
        mev: mev.into(),
        failed_txs: failed_txs.into(),
    }
}

/// Builds `MsgUpdateRewardWeights` packed into an `Any`.
pub fn update_reward_weights_any(
    authority: impl Into<String>,
    throughput: impl Into<String>,
    finality: impl Into<String>,
    decentralization: impl Into<String>,
    mev: impl Into<String>,
    failed_txs: impl Into<String>,
) -> Any {
    to_any(
        &update_reward_weights(
            authority,
            throughput,
            finality,
            decentralization,
            mev,
            failed_txs,
        ),
        UPDATE_REWARD_WEIGHTS,
    )
}
