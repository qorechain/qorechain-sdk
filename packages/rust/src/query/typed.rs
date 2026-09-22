//! Typed query clients for the QoreChain modules that expose a gRPC `Query`
//! service (bridge, crossvm, lightnode, multilayer, pqc, qca, rdk, reputation,
//! rlconsensus, svm).
//!
//! Rather than pull in a gRPC transport, the queries ride the chain RPC's
//! `abci_query` method (the same JSON-RPC transport as [`JsonRpcClient`]): the
//! ABCI path is the gRPC method name (`/qorechain.<module>.v1.Query/<Method>`),
//! the request is the prost-encoded query message (hex), and the response value
//! is the base64-encoded prost-encoded response message. Each method below
//! returns the strongly typed prost response decoded from that value, so callers
//! get real typed results without a gRPC dependency.

use crate::error::{Error, Result};
use crate::proto::qorechain;
use crate::query::JsonRpcClient;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use prost::Message;
use serde_json::json;

/// A typed query client over the chain RPC `abci_query` transport.
#[derive(Debug, Clone)]
pub struct TypedQueryClient {
    rpc: JsonRpcClient,
}

impl TypedQueryClient {
    /// Creates a typed query client targeting the chain RPC URL.
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            rpc: JsonRpcClient::new(rpc_url),
        }
    }

    /// Wraps an existing [`JsonRpcClient`].
    pub fn with_rpc(rpc: JsonRpcClient) -> Self {
        Self { rpc }
    }

    /// Performs a typed ABCI gRPC query: encodes `req`, calls `abci_query` for
    /// the gRPC `path`, and decodes the response value into `Resp`.
    async fn grpc_query<Req: Message, Resp: Message + Default>(
        &self,
        path: &str,
        req: &Req,
    ) -> Result<Resp> {
        let data_hex = hex::encode(req.encode_to_vec());
        let params = json!({
            "path": path,
            "data": data_hex,
            "prove": false,
        });
        let result = self.rpc.call("abci_query", params).await?;
        let response = &result["response"];
        // A non-zero ABCI code indicates a query error.
        if let Some(code) = response["code"].as_u64() {
            if code != 0 {
                let log = response["log"].as_str().unwrap_or("query failed");
                return Err(Error::InvalidResponse(format!(
                    "abci_query {path} failed (code {code}): {log}"
                )));
            }
        }
        let value_b64 = response["value"].as_str().unwrap_or("");
        let bytes = if value_b64.is_empty() {
            Vec::new()
        } else {
            BASE64
                .decode(value_b64)
                .map_err(|e| Error::InvalidResponse(format!("decode abci value: {e}")))?
        };
        Resp::decode(bytes.as_slice())
            .map_err(|e| Error::InvalidResponse(format!("decode {path} response: {e}")))
    }

    // --- pqc ---

    /// Queries `qorechain.pqc.v1.Query/Account`.
    pub async fn pqc_account(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::pqc::v1::QueryAccountResponse> {
        self.grpc_query(
            "/qorechain.pqc.v1.Query/Account",
            &qorechain::pqc::v1::QueryAccountRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.pqc.v1.Query/EVMWindow` (chain v3.2.0): the EVM
    /// authorisation window status for an address. A stored window may still be
    /// expired or exhausted, so read `live` as well as `found`.
    pub async fn pqc_evm_window(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::pqc::v1::QueryEvmWindowResponse> {
        self.grpc_query(
            crate::evm_window::EVM_WINDOW_QUERY_PATH,
            &qorechain::pqc::v1::QueryEvmWindowRequest {
                address: address.into(),
            },
        )
        .await
    }

    // --- crossvm ---

    /// Queries `qorechain.crossvm.v1.Query/Params`.
    pub async fn crossvm_params(&self) -> Result<qorechain::crossvm::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.crossvm.v1.Query/Params",
            &qorechain::crossvm::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.crossvm.v1.Query/PendingMessages`.
    pub async fn crossvm_pending_messages(
        &self,
    ) -> Result<qorechain::crossvm::v1::QueryPendingMessagesResponse> {
        self.grpc_query(
            "/qorechain.crossvm.v1.Query/PendingMessages",
            &qorechain::crossvm::v1::QueryPendingMessagesRequest {},
        )
        .await
    }

    /// Queries `qorechain.crossvm.v1.Query/Message`.
    pub async fn crossvm_message(
        &self,
        id: impl Into<String>,
    ) -> Result<qorechain::crossvm::v1::QueryMessageResponse> {
        self.grpc_query(
            "/qorechain.crossvm.v1.Query/Message",
            &qorechain::crossvm::v1::QueryMessageRequest { id: id.into() },
        )
        .await
    }

    // --- lightnode ---

    /// Queries `qorechain.lightnode.v1.Query/LightNode`.
    pub async fn lightnode(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::lightnode::v1::QueryLightNodeResponse> {
        self.grpc_query(
            "/qorechain.lightnode.v1.Query/LightNode",
            &qorechain::lightnode::v1::QueryLightNodeRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.lightnode.v1.Query/LightNodes`.
    pub async fn lightnodes(&self) -> Result<qorechain::lightnode::v1::QueryLightNodesResponse> {
        self.grpc_query(
            "/qorechain.lightnode.v1.Query/LightNodes",
            &qorechain::lightnode::v1::QueryLightNodesRequest {},
        )
        .await
    }

    /// Queries `qorechain.lightnode.v1.Query/Params`.
    pub async fn lightnode_params(&self) -> Result<qorechain::lightnode::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.lightnode.v1.Query/Params",
            &qorechain::lightnode::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.lightnode.v1.Query/Rewards`.
    pub async fn lightnode_rewards(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::lightnode::v1::QueryRewardsResponse> {
        self.grpc_query(
            "/qorechain.lightnode.v1.Query/Rewards",
            &qorechain::lightnode::v1::QueryRewardsRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.lightnode.v1.Query/Stats`.
    pub async fn lightnode_stats(&self) -> Result<qorechain::lightnode::v1::QueryStatsResponse> {
        self.grpc_query(
            "/qorechain.lightnode.v1.Query/Stats",
            &qorechain::lightnode::v1::QueryStatsRequest {},
        )
        .await
    }

    // --- svm ---

    /// Queries `qorechain.svm.v1.Query/Slot`.
    pub async fn svm_slot(&self) -> Result<qorechain::svm::v1::QuerySlotResponse> {
        self.grpc_query(
            "/qorechain.svm.v1.Query/Slot",
            &qorechain::svm::v1::QuerySlotRequest {},
        )
        .await
    }

    /// Queries `qorechain.svm.v1.Query/Account`.
    pub async fn svm_account(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::svm::v1::QueryAccountResponse> {
        self.grpc_query(
            "/qorechain.svm.v1.Query/Account",
            &qorechain::svm::v1::QueryAccountRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.svm.v1.Query/Program`.
    pub async fn svm_program(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::svm::v1::QueryProgramResponse> {
        self.grpc_query(
            "/qorechain.svm.v1.Query/Program",
            &qorechain::svm::v1::QueryProgramRequest {
                address: address.into(),
            },
        )
        .await
    }

    // --- reputation ---

    /// Queries `qorechain.reputation.v1.Query/Params`.
    pub async fn reputation_params(
        &self,
    ) -> Result<qorechain::reputation::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.reputation.v1.Query/Params",
            &qorechain::reputation::v1::QueryParamsRequest {},
        )
        .await
    }

    // --- qca ---

    /// Queries `qorechain.qca.v1.Query/Config`.
    pub async fn qca_config(&self) -> Result<qorechain::qca::v1::QueryConfigResponse> {
        self.grpc_query(
            "/qorechain.qca.v1.Query/Config",
            &qorechain::qca::v1::QueryConfigRequest {},
        )
        .await
    }

    // --- rlconsensus ---

    /// Queries `qorechain.rlconsensus.v1.Query/AgentStatus`.
    pub async fn rlconsensus_agent_status(
        &self,
    ) -> Result<qorechain::rlconsensus::v1::QueryAgentStatusResponse> {
        self.grpc_query(
            "/qorechain.rlconsensus.v1.Query/AgentStatus",
            &qorechain::rlconsensus::v1::QueryAgentStatusRequest {},
        )
        .await
    }

    /// Queries `qorechain.rlconsensus.v1.Query/Params`.
    pub async fn rlconsensus_params(
        &self,
    ) -> Result<qorechain::rlconsensus::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.rlconsensus.v1.Query/Params",
            &qorechain::rlconsensus::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.rlconsensus.v1.Query/Observation`.
    pub async fn rlconsensus_observation(
        &self,
    ) -> Result<qorechain::rlconsensus::v1::QueryObservationResponse> {
        self.grpc_query(
            "/qorechain.rlconsensus.v1.Query/Observation",
            &qorechain::rlconsensus::v1::QueryObservationRequest {},
        )
        .await
    }

    /// Queries `qorechain.rlconsensus.v1.Query/Reward`.
    pub async fn rlconsensus_reward(
        &self,
    ) -> Result<qorechain::rlconsensus::v1::QueryRewardResponse> {
        self.grpc_query(
            "/qorechain.rlconsensus.v1.Query/Reward",
            &qorechain::rlconsensus::v1::QueryRewardRequest {},
        )
        .await
    }

    /// Queries `qorechain.rlconsensus.v1.Query/Policy`.
    pub async fn rlconsensus_policy(
        &self,
    ) -> Result<qorechain::rlconsensus::v1::QueryPolicyResponse> {
        self.grpc_query(
            "/qorechain.rlconsensus.v1.Query/Policy",
            &qorechain::rlconsensus::v1::QueryPolicyRequest {},
        )
        .await
    }

    // --- multilayer ---

    /// Queries `qorechain.multilayer.v1.Query/Params`.
    pub async fn multilayer_params(
        &self,
    ) -> Result<qorechain::multilayer::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/Params",
            &qorechain::multilayer::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.multilayer.v1.Query/Layer`.
    pub async fn multilayer_layer(
        &self,
        layer_id: impl Into<String>,
    ) -> Result<qorechain::multilayer::v1::QueryLayerResponse> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/Layer",
            &qorechain::multilayer::v1::QueryLayerRequest {
                layer_id: layer_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.multilayer.v1.Query/Layers`.
    pub async fn multilayer_layers(
        &self,
    ) -> Result<qorechain::multilayer::v1::QueryLayersResponse> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/Layers",
            &qorechain::multilayer::v1::QueryLayersRequest {},
        )
        .await
    }

    /// Queries `qorechain.multilayer.v1.Query/Anchor` — the latest state anchor
    /// for a layer.
    pub async fn multilayer_anchor(
        &self,
        layer_id: impl Into<String>,
    ) -> Result<qorechain::multilayer::v1::QueryAnchorResponse> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/Anchor",
            &qorechain::multilayer::v1::QueryAnchorRequest {
                layer_id: layer_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.multilayer.v1.Query/Anchors` — all state anchors for a
    /// layer (newest first).
    pub async fn multilayer_anchors(
        &self,
        layer_id: impl Into<String>,
    ) -> Result<qorechain::multilayer::v1::QueryAnchorsResponse> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/Anchors",
            &qorechain::multilayer::v1::QueryAnchorsRequest {
                layer_id: layer_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.multilayer.v1.Query/RoutingStats`.
    pub async fn multilayer_routing_stats(
        &self,
    ) -> Result<qorechain::multilayer::v1::QueryRoutingStatsView> {
        self.grpc_query(
            "/qorechain.multilayer.v1.Query/RoutingStats",
            &qorechain::multilayer::v1::QueryRoutingStatsRequest {},
        )
        .await
    }

    // --- amm ---

    /// Queries `qorechain.amm.v1.Query/Params`.
    pub async fn amm_params(&self) -> Result<qorechain::amm::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/Params",
            &qorechain::amm::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/Pool`.
    pub async fn amm_pool(&self, pool_id: u64) -> Result<qorechain::amm::v1::QueryPoolResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/Pool",
            &qorechain::amm::v1::QueryPoolRequest { pool_id },
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/Pools`.
    pub async fn amm_pools(&self) -> Result<qorechain::amm::v1::QueryPoolsResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/Pools",
            &qorechain::amm::v1::QueryPoolsRequest {},
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/PoolByDenoms`.
    pub async fn amm_pool_by_denoms(
        &self,
        denom_a: impl Into<String>,
        denom_b: impl Into<String>,
    ) -> Result<qorechain::amm::v1::QueryPoolByDenomsResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/PoolByDenoms",
            &qorechain::amm::v1::QueryPoolByDenomsRequest {
                denom_a: denom_a.into(),
                denom_b: denom_b.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/LPBalance`.
    pub async fn amm_lp_balance(
        &self,
        pool_id: u64,
        address: impl Into<String>,
    ) -> Result<qorechain::amm::v1::QueryLpBalanceResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/LPBalance",
            &qorechain::amm::v1::QueryLpBalanceRequest {
                pool_id,
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/QuoteExactIn`.
    pub async fn amm_quote_exact_in(
        &self,
        pool_id: u64,
        denom_in: impl Into<String>,
        amount_in: impl Into<String>,
    ) -> Result<qorechain::amm::v1::QueryQuoteExactInResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/QuoteExactIn",
            &qorechain::amm::v1::QueryQuoteExactInRequest {
                pool_id,
                denom_in: denom_in.into(),
                amount_in: amount_in.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.amm.v1.Query/QuoteExactOut`.
    pub async fn amm_quote_exact_out(
        &self,
        pool_id: u64,
        denom_out: impl Into<String>,
        amount_out: impl Into<String>,
    ) -> Result<qorechain::amm::v1::QueryQuoteExactOutResponse> {
        self.grpc_query(
            "/qorechain.amm.v1.Query/QuoteExactOut",
            &qorechain::amm::v1::QueryQuoteExactOutRequest {
                pool_id,
                denom_out: denom_out.into(),
                amount_out: amount_out.into(),
            },
        )
        .await
    }

    // --- license ---

    /// Queries `qorechain.license.v1.Query/Check`.
    pub async fn license_check(
        &self,
        grantee: impl Into<String>,
        feature_id: impl Into<String>,
    ) -> Result<qorechain::license::v1::QueryCheckResponse> {
        self.grpc_query(
            "/qorechain.license.v1.Query/Check",
            &qorechain::license::v1::QueryCheckRequest {
                grantee: grantee.into(),
                feature_id: feature_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.license.v1.Query/Holders`.
    pub async fn license_holders(
        &self,
        feature_id: impl Into<String>,
    ) -> Result<qorechain::license::v1::QueryHoldersResponse> {
        self.grpc_query(
            "/qorechain.license.v1.Query/Holders",
            &qorechain::license::v1::QueryHoldersRequest {
                feature_id: feature_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.license.v1.Query/List`.
    pub async fn license_list(
        &self,
        grantee: impl Into<String>,
    ) -> Result<qorechain::license::v1::QueryListResponse> {
        self.grpc_query(
            "/qorechain.license.v1.Query/List",
            &qorechain::license::v1::QueryListRequest {
                grantee: grantee.into(),
            },
        )
        .await
    }

    // --- abstractaccount ---

    /// Queries `qorechain.abstractaccount.v1.Query/Config`.
    pub async fn abstractaccount_config(
        &self,
    ) -> Result<qorechain::abstractaccount::v1::QueryConfigResponse> {
        self.grpc_query(
            "/qorechain.abstractaccount.v1.Query/Config",
            &qorechain::abstractaccount::v1::QueryConfigRequest {},
        )
        .await
    }

    /// Queries `qorechain.abstractaccount.v1.Query/Account`.
    pub async fn abstractaccount_account(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::abstractaccount::v1::QueryAccountResponse> {
        self.grpc_query(
            "/qorechain.abstractaccount.v1.Query/Account",
            &qorechain::abstractaccount::v1::QueryAccountRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.abstractaccount.v1.Query/Accounts`.
    pub async fn abstractaccount_accounts(
        &self,
    ) -> Result<qorechain::abstractaccount::v1::QueryAccountsResponse> {
        self.grpc_query(
            "/qorechain.abstractaccount.v1.Query/Accounts",
            &qorechain::abstractaccount::v1::QueryAccountsRequest {},
        )
        .await
    }

    /// Queries `qorechain.abstractaccount.v1.Query/PermissionSchema` — the
    /// canonical authenticator permission taxonomy (v3.1.85), so clients validate
    /// scopes without hardcoding strings and detect drift via `schema_version`.
    pub async fn abstractaccount_permission_schema(
        &self,
    ) -> Result<qorechain::abstractaccount::v1::QueryPermissionSchemaResponse> {
        self.grpc_query(
            "/qorechain.abstractaccount.v1.Query/PermissionSchema",
            &qorechain::abstractaccount::v1::QueryPermissionSchemaRequest {},
        )
        .await
    }

    // --- rdk ---

    /// Queries `qorechain.rdk.v1.Query/Params`.
    pub async fn rdk_params(&self) -> Result<qorechain::rdk::v1::QueryParamsResponse> {
        self.grpc_query(
            "/qorechain.rdk.v1.Query/Params",
            &qorechain::rdk::v1::QueryParamsRequest {},
        )
        .await
    }

    /// Queries `qorechain.rdk.v1.Query/Rollup`.
    pub async fn rdk_rollup(
        &self,
        rollup_id: impl Into<String>,
    ) -> Result<qorechain::rdk::v1::QueryRollupResponse> {
        self.grpc_query(
            "/qorechain.rdk.v1.Query/Rollup",
            &qorechain::rdk::v1::QueryRollupRequest {
                rollup_id: rollup_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.rdk.v1.Query/Rollups`.
    pub async fn rdk_rollups(&self) -> Result<qorechain::rdk::v1::QueryRollupsResponse> {
        self.grpc_query(
            "/qorechain.rdk.v1.Query/Rollups",
            &qorechain::rdk::v1::QueryRollupsRequest {},
        )
        .await
    }

    /// Queries `qorechain.rdk.v1.Query/Batch`.
    pub async fn rdk_batch(
        &self,
        rollup_id: impl Into<String>,
        batch_index: u64,
    ) -> Result<qorechain::rdk::v1::QueryBatchResponse> {
        self.grpc_query(
            "/qorechain.rdk.v1.Query/Batch",
            &qorechain::rdk::v1::QueryBatchRequest {
                rollup_id: rollup_id.into(),
                batch_index,
            },
        )
        .await
    }

    /// Queries `qorechain.rdk.v1.Query/LatestBatch`.
    pub async fn rdk_latest_batch(
        &self,
        rollup_id: impl Into<String>,
    ) -> Result<qorechain::rdk::v1::QueryLatestBatchResponse> {
        self.grpc_query(
            "/qorechain.rdk.v1.Query/LatestBatch",
            &qorechain::rdk::v1::QueryLatestBatchRequest {
                rollup_id: rollup_id.into(),
            },
        )
        .await
    }

    // --- bridge ---

    /// Queries `qorechain.bridge.v1.Query/Config`.
    pub async fn bridge_config(&self) -> Result<qorechain::bridge::v1::QueryConfigResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/Config",
            &qorechain::bridge::v1::QueryConfigRequest {},
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/ChainConfig`.
    pub async fn bridge_chain_config(
        &self,
        chain_id: impl Into<String>,
    ) -> Result<qorechain::bridge::v1::QueryChainConfigResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/ChainConfig",
            &qorechain::bridge::v1::QueryChainConfigRequest {
                chain_id: chain_id.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/ChainConfigs`.
    pub async fn bridge_chain_configs(
        &self,
    ) -> Result<qorechain::bridge::v1::QueryChainConfigsResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/ChainConfigs",
            &qorechain::bridge::v1::QueryChainConfigsRequest {},
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/Validator`.
    pub async fn bridge_validator(
        &self,
        address: impl Into<String>,
    ) -> Result<qorechain::bridge::v1::QueryValidatorResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/Validator",
            &qorechain::bridge::v1::QueryValidatorRequest {
                address: address.into(),
            },
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/Validators`.
    pub async fn bridge_validators(
        &self,
    ) -> Result<qorechain::bridge::v1::QueryValidatorsResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/Validators",
            &qorechain::bridge::v1::QueryValidatorsRequest {},
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/Operation`.
    pub async fn bridge_operation(
        &self,
        id: impl Into<String>,
    ) -> Result<qorechain::bridge::v1::QueryOperationResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/Operation",
            &qorechain::bridge::v1::QueryOperationRequest { id: id.into() },
        )
        .await
    }

    /// Queries `qorechain.bridge.v1.Query/Operations`.
    pub async fn bridge_operations(
        &self,
    ) -> Result<qorechain::bridge::v1::QueryOperationsResponse> {
        self.grpc_query(
            "/qorechain.bridge.v1.Query/Operations",
            &qorechain::bridge::v1::QueryOperationsRequest {},
        )
        .await
    }
}
