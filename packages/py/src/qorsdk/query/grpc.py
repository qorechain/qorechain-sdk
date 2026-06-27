"""Typed gRPC query clients for the QoreChain modules with a query service.

Each module that defines a ``Query`` service (crossvm, lightnode, pqc, qca,
reputation, rlconsensus, svm, multilayer, rdk, bridge) gets a typed client whose
methods take the generated ``Query*Request`` and return the decoded
``Query*Response`` protobuf message — fully typed, no hand-rolled paths.

The transport is a gRPC channel (cosmpy bundles ``grpcio``). Service stubs are
not generated; instead each call uses the channel's generic ``unary_unary`` with
the canonical method path ``/qorechain.<module>.v1.Query/<Method>`` and the
generated request/response (de)serializers. Point the client at the network's
``grpc`` endpoint (host:port). Use :func:`connect_query_clients` to open one
channel shared across every module client.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import grpc

from ..proto.qorechain.bridge.v1 import query_pb2 as bridge_q
from ..proto.qorechain.crossvm.v1 import query_pb2 as crossvm_q
from ..proto.qorechain.lightnode.v1 import query_pb2 as lightnode_q
from ..proto.qorechain.multilayer.v1 import query_pb2 as multilayer_q
from ..proto.qorechain.pqc.v1 import query_pb2 as pqc_q
from ..proto.qorechain.qca.v1 import query_pb2 as qca_q
from ..proto.qorechain.rdk.v1 import query_pb2 as rdk_q
from ..proto.qorechain.reputation.v1 import query_pb2 as reputation_q
from ..proto.qorechain.rlconsensus.v1 import query_pb2 as rlconsensus_q
from ..proto.qorechain.svm.v1 import query_pb2 as svm_q


def _grpc_target(grpc_url: str) -> str:
    """Normalize a ``grpc`` endpoint into a ``host:port`` channel target."""
    for prefix in ("grpc://", "http://", "https://", "tcp://"):
        if grpc_url.startswith(prefix):
            return grpc_url[len(prefix) :].rstrip("/")
    return grpc_url.rstrip("/")


def _unary(
    channel: grpc.Channel,
    service: str,
    method: str,
    req_cls: Callable[..., Any],
    res_cls: Callable[..., Any],
) -> Callable[[Any], Any]:
    """Build a typed unary caller bound to a proto ``service``/``method``."""

    def deserialize(data: bytes) -> Any:
        message = res_cls()
        message.ParseFromString(data)
        return message

    callable_ = channel.unary_unary(
        f"/{service}/{method}",
        request_serializer=lambda r: r.SerializeToString(),
        response_deserializer=deserialize,
    )

    def call(request: Any) -> Any:
        return callable_(request)

    return call


class CrossVmQueryClient:
    """Typed query client for ``x/crossvm``."""

    _SERVICE = "qorechain.crossvm.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._params = _unary(
            channel, self._SERVICE, "Params",
            crossvm_q.QueryParamsRequest, crossvm_q.QueryParamsResponse,
        )
        self._pending = _unary(
            channel, self._SERVICE, "PendingMessages",
            crossvm_q.QueryPendingMessagesRequest,
            crossvm_q.QueryPendingMessagesResponse,
        )
        self._message = _unary(
            channel, self._SERVICE, "Message",
            crossvm_q.QueryMessageRequest, crossvm_q.QueryMessageResponse,
        )

    def params(self) -> Any:
        return self._params(crossvm_q.QueryParamsRequest())

    def pending_messages(self) -> Any:
        return self._pending(crossvm_q.QueryPendingMessagesRequest())

    def message(self, message_id: str) -> Any:
        return self._message(crossvm_q.QueryMessageRequest(id=message_id))


class LightnodeQueryClient:
    """Typed query client for ``x/lightnode``."""

    _SERVICE = "qorechain.lightnode.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._light_node = _unary(
            channel, self._SERVICE, "LightNode",
            lightnode_q.QueryLightNodeRequest, lightnode_q.QueryLightNodeResponse,
        )
        self._light_nodes = _unary(
            channel, self._SERVICE, "LightNodes",
            lightnode_q.QueryLightNodesRequest, lightnode_q.QueryLightNodesResponse,
        )
        self._params = _unary(
            channel, self._SERVICE, "Params",
            lightnode_q.QueryParamsRequest, lightnode_q.QueryParamsResponse,
        )
        self._rewards = _unary(
            channel, self._SERVICE, "Rewards",
            lightnode_q.QueryRewardsRequest, lightnode_q.QueryRewardsResponse,
        )
        self._stats = _unary(
            channel, self._SERVICE, "Stats",
            lightnode_q.QueryStatsRequest, lightnode_q.QueryStatsResponse,
        )

    def light_node(self, address: str) -> Any:
        return self._light_node(lightnode_q.QueryLightNodeRequest(address=address))

    def light_nodes(self) -> Any:
        return self._light_nodes(lightnode_q.QueryLightNodesRequest())

    def params(self) -> Any:
        return self._params(lightnode_q.QueryParamsRequest())

    def rewards(self, address: str) -> Any:
        return self._rewards(lightnode_q.QueryRewardsRequest(address=address))

    def stats(self) -> Any:
        return self._stats(lightnode_q.QueryStatsRequest())


class PqcQueryClient:
    """Typed query client for ``x/pqc``."""

    _SERVICE = "qorechain.pqc.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._account = _unary(
            channel, self._SERVICE, "Account",
            pqc_q.QueryAccountRequest, pqc_q.QueryAccountResponse,
        )

    def account(self, address: str) -> Any:
        return self._account(pqc_q.QueryAccountRequest(address=address))


class QcaQueryClient:
    """Typed query client for ``x/qca``."""

    _SERVICE = "qorechain.qca.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._config = _unary(
            channel, self._SERVICE, "Config",
            qca_q.QueryConfigRequest, qca_q.QueryConfigResponse,
        )

    def config(self) -> Any:
        return self._config(qca_q.QueryConfigRequest())


class ReputationQueryClient:
    """Typed query client for ``x/reputation``."""

    _SERVICE = "qorechain.reputation.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._params = _unary(
            channel, self._SERVICE, "Params",
            reputation_q.QueryParamsRequest, reputation_q.QueryParamsResponse,
        )

    def params(self) -> Any:
        return self._params(reputation_q.QueryParamsRequest())


class RlconsensusQueryClient:
    """Typed query client for ``x/rlconsensus``."""

    _SERVICE = "qorechain.rlconsensus.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._agent_status = _unary(
            channel, self._SERVICE, "AgentStatus",
            rlconsensus_q.QueryAgentStatusRequest,
            rlconsensus_q.QueryAgentStatusResponse,
        )
        self._params = _unary(
            channel, self._SERVICE, "Params",
            rlconsensus_q.QueryParamsRequest, rlconsensus_q.QueryParamsResponse,
        )
        self._observation = _unary(
            channel, self._SERVICE, "Observation",
            rlconsensus_q.QueryObservationRequest,
            rlconsensus_q.QueryObservationResponse,
        )
        self._reward = _unary(
            channel, self._SERVICE, "Reward",
            rlconsensus_q.QueryRewardRequest, rlconsensus_q.QueryRewardResponse,
        )
        self._policy = _unary(
            channel, self._SERVICE, "Policy",
            rlconsensus_q.QueryPolicyRequest, rlconsensus_q.QueryPolicyResponse,
        )

    def agent_status(self) -> Any:
        return self._agent_status(rlconsensus_q.QueryAgentStatusRequest())

    def params(self) -> Any:
        return self._params(rlconsensus_q.QueryParamsRequest())

    def observation(self) -> Any:
        return self._observation(rlconsensus_q.QueryObservationRequest())

    def reward(self) -> Any:
        return self._reward(rlconsensus_q.QueryRewardRequest())

    def policy(self) -> Any:
        return self._policy(rlconsensus_q.QueryPolicyRequest())


class SvmQueryClient:
    """Typed query client for ``x/svm``."""

    _SERVICE = "qorechain.svm.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._slot = _unary(
            channel, self._SERVICE, "Slot",
            svm_q.QuerySlotRequest, svm_q.QuerySlotResponse,
        )
        self._account = _unary(
            channel, self._SERVICE, "Account",
            svm_q.QueryAccountRequest, svm_q.QueryAccountResponse,
        )
        self._program = _unary(
            channel, self._SERVICE, "Program",
            svm_q.QueryProgramRequest, svm_q.QueryProgramResponse,
        )

    def slot(self) -> Any:
        return self._slot(svm_q.QuerySlotRequest())

    def account(self, address: str) -> Any:
        return self._account(svm_q.QueryAccountRequest(address=address))

    def program(self, address: str) -> Any:
        return self._program(svm_q.QueryProgramRequest(address=address))


class MultilayerQueryClient:
    """Typed query client for ``x/multilayer``."""

    _SERVICE = "qorechain.multilayer.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._params = _unary(
            channel, self._SERVICE, "Params",
            multilayer_q.QueryParamsRequest, multilayer_q.QueryParamsResponse,
        )
        self._layer = _unary(
            channel, self._SERVICE, "Layer",
            multilayer_q.QueryLayerRequest, multilayer_q.QueryLayerResponse,
        )
        self._layers = _unary(
            channel, self._SERVICE, "Layers",
            multilayer_q.QueryLayersRequest, multilayer_q.QueryLayersResponse,
        )
        self._routing_stats = _unary(
            channel, self._SERVICE, "RoutingStats",
            multilayer_q.QueryRoutingStatsRequest,
            multilayer_q.QueryRoutingStatsView,
        )

    def params(self) -> Any:
        return self._params(multilayer_q.QueryParamsRequest())

    def layer(self, layer_id: str) -> Any:
        return self._layer(multilayer_q.QueryLayerRequest(layer_id=layer_id))

    def layers(self) -> Any:
        return self._layers(multilayer_q.QueryLayersRequest())

    def routing_stats(self) -> Any:
        return self._routing_stats(multilayer_q.QueryRoutingStatsRequest())


class RdkQueryClient:
    """Typed query client for ``x/rdk`` (rollup development kit)."""

    _SERVICE = "qorechain.rdk.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._params = _unary(
            channel, self._SERVICE, "Params",
            rdk_q.QueryParamsRequest, rdk_q.QueryParamsResponse,
        )
        self._rollup = _unary(
            channel, self._SERVICE, "Rollup",
            rdk_q.QueryRollupRequest, rdk_q.QueryRollupResponse,
        )
        self._rollups = _unary(
            channel, self._SERVICE, "Rollups",
            rdk_q.QueryRollupsRequest, rdk_q.QueryRollupsResponse,
        )
        self._batch = _unary(
            channel, self._SERVICE, "Batch",
            rdk_q.QueryBatchRequest, rdk_q.QueryBatchResponse,
        )
        self._latest_batch = _unary(
            channel, self._SERVICE, "LatestBatch",
            rdk_q.QueryLatestBatchRequest, rdk_q.QueryLatestBatchResponse,
        )

    def params(self) -> Any:
        return self._params(rdk_q.QueryParamsRequest())

    def rollup(self, rollup_id: str) -> Any:
        return self._rollup(rdk_q.QueryRollupRequest(rollup_id=rollup_id))

    def rollups(self) -> Any:
        return self._rollups(rdk_q.QueryRollupsRequest())

    def batch(self, rollup_id: str, batch_index: int) -> Any:
        return self._batch(
            rdk_q.QueryBatchRequest(rollup_id=rollup_id, batch_index=batch_index)
        )

    def latest_batch(self, rollup_id: str) -> Any:
        return self._latest_batch(rdk_q.QueryLatestBatchRequest(rollup_id=rollup_id))


class BridgeQueryClient:
    """Typed query client for ``x/bridge``."""

    _SERVICE = "qorechain.bridge.v1.Query"

    def __init__(self, channel: grpc.Channel) -> None:
        self._config = _unary(
            channel, self._SERVICE, "Config",
            bridge_q.QueryConfigRequest, bridge_q.QueryConfigResponse,
        )
        self._chain_config = _unary(
            channel, self._SERVICE, "ChainConfig",
            bridge_q.QueryChainConfigRequest, bridge_q.QueryChainConfigResponse,
        )
        self._chain_configs = _unary(
            channel, self._SERVICE, "ChainConfigs",
            bridge_q.QueryChainConfigsRequest, bridge_q.QueryChainConfigsResponse,
        )
        self._validator = _unary(
            channel, self._SERVICE, "Validator",
            bridge_q.QueryValidatorRequest, bridge_q.QueryValidatorResponse,
        )
        self._validators = _unary(
            channel, self._SERVICE, "Validators",
            bridge_q.QueryValidatorsRequest, bridge_q.QueryValidatorsResponse,
        )
        self._operation = _unary(
            channel, self._SERVICE, "Operation",
            bridge_q.QueryOperationRequest, bridge_q.QueryOperationResponse,
        )
        self._operations = _unary(
            channel, self._SERVICE, "Operations",
            bridge_q.QueryOperationsRequest, bridge_q.QueryOperationsResponse,
        )

    def config(self) -> Any:
        return self._config(bridge_q.QueryConfigRequest())

    def chain_config(self, chain_id: str) -> Any:
        return self._chain_config(bridge_q.QueryChainConfigRequest(chain_id=chain_id))

    def chain_configs(self) -> Any:
        return self._chain_configs(bridge_q.QueryChainConfigsRequest())

    def validator(self, address: str) -> Any:
        return self._validator(bridge_q.QueryValidatorRequest(address=address))

    def validators(self) -> Any:
        return self._validators(bridge_q.QueryValidatorsRequest())

    def operation(self, operation_id: str) -> Any:
        return self._operation(bridge_q.QueryOperationRequest(id=operation_id))

    def operations(self) -> Any:
        return self._operations(bridge_q.QueryOperationsRequest())


class QueryClients:
    """A bundle of every module query client over one shared gRPC channel.

    Construct via :func:`connect_query_clients`. Close the underlying channel
    with :meth:`close` (or use as a context manager).
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._channel = channel
        self.crossvm = CrossVmQueryClient(channel)
        self.lightnode = LightnodeQueryClient(channel)
        self.pqc = PqcQueryClient(channel)
        self.qca = QcaQueryClient(channel)
        self.reputation = ReputationQueryClient(channel)
        self.rlconsensus = RlconsensusQueryClient(channel)
        self.svm = SvmQueryClient(channel)
        self.multilayer = MultilayerQueryClient(channel)
        self.rdk = RdkQueryClient(channel)
        self.bridge = BridgeQueryClient(channel)

    def close(self) -> None:
        self._channel.close()

    def __enter__(self) -> QueryClients:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def connect_query_clients(
    grpc_url: str, *, channel: grpc.Channel | None = None
) -> QueryClients:
    """Open a gRPC channel and return a :class:`QueryClients` bundle.

    :param grpc_url: The network's ``grpc`` endpoint (``host:port``; a
        ``grpc://``/``http://`` scheme is stripped). Uses an insecure channel.
    :param channel: An existing channel to wrap instead of opening one (e.g. a
        secure channel, or a fake in tests).
    """
    chan = channel if channel is not None else grpc.insecure_channel(_grpc_target(grpc_url))
    return QueryClients(chan)
