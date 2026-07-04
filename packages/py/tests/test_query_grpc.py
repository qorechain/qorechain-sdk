"""Tests for the typed gRPC query clients (mocked channel).

A fake channel captures the method path and (de)serializers each typed call
binds, and round-trips a response through the real generated types — so the
service/method routing and typing are exercised without opening a socket.
"""

from __future__ import annotations

from qorsdk import connect_query_clients
from qorsdk.proto.qorechain.bridge.v1 import query_pb2 as bridge_q
from qorsdk.proto.qorechain.crossvm.v1 import query_pb2 as crossvm_q
from qorsdk.proto.qorechain.lightnode.v1 import query_pb2 as lightnode_q
from qorsdk.proto.qorechain.multilayer.v1 import query_pb2 as multilayer_q
from qorsdk.proto.qorechain.rdk.v1 import query_pb2 as rdk_q
from qorsdk.proto.qorechain.svm.v1 import query_pb2 as svm_q


class FakeMultiCallable:
    def __init__(self, method, response_bytes):
        self.method = method
        self._response_bytes = response_bytes
        self.last_request = None

    def __call__(self, request):
        self.last_request = request
        return self._deserialize(self._response_bytes)


class FakeChannel:
    """Records ``unary_unary`` registrations and replays canned responses."""

    def __init__(self, responses: dict[str, bytes]):
        self._responses = responses
        self.registered: list[str] = []
        self.calls: dict[str, FakeMultiCallable] = {}

    def unary_unary(self, method, request_serializer, response_deserializer):
        self.registered.append(method)
        mc = FakeMultiCallable(method, self._responses.get(method, b""))
        mc._deserialize = response_deserializer
        self.calls[method] = mc
        return mc

    def close(self):  # pragma: no cover - trivial
        pass


def test_query_clients_register_all_module_methods():
    channel = FakeChannel({})
    clients = connect_query_clients("localhost:9090", channel=channel)
    # Every service is bound under its canonical /service/Method path.
    assert "/qorechain.crossvm.v1.Query/Message" in channel.registered
    assert "/qorechain.lightnode.v1.Query/LightNode" in channel.registered
    assert "/qorechain.pqc.v1.Query/Account" in channel.registered
    assert "/qorechain.qca.v1.Query/Config" in channel.registered
    assert "/qorechain.reputation.v1.Query/Params" in channel.registered
    assert "/qorechain.rlconsensus.v1.Query/AgentStatus" in channel.registered
    assert "/qorechain.svm.v1.Query/Slot" in channel.registered
    assert "/qorechain.multilayer.v1.Query/RoutingStats" in channel.registered
    assert "/qorechain.rdk.v1.Query/LatestBatch" in channel.registered
    assert "/qorechain.bridge.v1.Query/ChainConfigs" in channel.registered
    assert hasattr(clients, "crossvm")
    assert hasattr(clients, "multilayer")
    assert hasattr(clients, "rdk")
    assert hasattr(clients, "bridge")


def test_crossvm_message_call_routes_and_decodes():
    response = crossvm_q.QueryMessageResponse()
    response.message.id = "msg-123"
    channel = FakeChannel(
        {"/qorechain.crossvm.v1.Query/Message": response.SerializeToString()}
    )
    clients = connect_query_clients("grpc://localhost:9090", channel=channel)
    out = clients.crossvm.message("msg-123")
    # The typed request carried the id, and the response decoded to the type.
    mc = channel.calls["/qorechain.crossvm.v1.Query/Message"]
    assert isinstance(mc.last_request, crossvm_q.QueryMessageRequest)
    assert mc.last_request.id == "msg-123"
    assert isinstance(out, crossvm_q.QueryMessageResponse)
    assert out.message.id == "msg-123"


def test_lightnode_light_node_passes_address():
    channel = FakeChannel(
        {
            "/qorechain.lightnode.v1.Query/LightNode": (
                lightnode_q.QueryLightNodeResponse().SerializeToString()
            )
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)
    clients.lightnode.light_node("qor1abc")
    mc = channel.calls["/qorechain.lightnode.v1.Query/LightNode"]
    assert mc.last_request.address == "qor1abc"


def test_svm_account_typed_round_trip():
    channel = FakeChannel(
        {
            "/qorechain.svm.v1.Query/Account": (
                svm_q.QueryAccountResponse().SerializeToString()
            )
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)
    out = clients.svm.account("So11111111111111111111111111111111111111112")
    mc = channel.calls["/qorechain.svm.v1.Query/Account"]
    assert mc.last_request.address == "So11111111111111111111111111111111111111112"
    assert isinstance(out, svm_q.QueryAccountResponse)


def test_multilayer_layer_passes_id_and_routing_stats_decodes():
    layer_resp = multilayer_q.QueryLayerResponse()
    layer_resp.layer.layer_id = "l-1"
    stats_resp = multilayer_q.QueryRoutingStatsView()
    stats_resp.stats.total_routed = 42
    channel = FakeChannel(
        {
            "/qorechain.multilayer.v1.Query/Layer": layer_resp.SerializeToString(),
            "/qorechain.multilayer.v1.Query/RoutingStats": (
                stats_resp.SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)

    out = clients.multilayer.layer("l-1")
    mc = channel.calls["/qorechain.multilayer.v1.Query/Layer"]
    assert isinstance(mc.last_request, multilayer_q.QueryLayerRequest)
    assert mc.last_request.layer_id == "l-1"
    assert isinstance(out, multilayer_q.QueryLayerResponse)
    assert out.layer.layer_id == "l-1"

    stats = clients.multilayer.routing_stats()
    assert isinstance(stats, multilayer_q.QueryRoutingStatsView)
    assert stats.stats.total_routed == 42


def test_rdk_batch_and_latest_batch_typed_round_trip():
    batch_resp = rdk_q.QueryBatchResponse()
    batch_resp.batch.rollup_id = "r-1"
    batch_resp.batch.batch_index = 7
    channel = FakeChannel(
        {
            "/qorechain.rdk.v1.Query/Batch": batch_resp.SerializeToString(),
            "/qorechain.rdk.v1.Query/LatestBatch": (
                rdk_q.QueryLatestBatchResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)

    out = clients.rdk.batch("r-1", 7)
    mc = channel.calls["/qorechain.rdk.v1.Query/Batch"]
    assert isinstance(mc.last_request, rdk_q.QueryBatchRequest)
    assert mc.last_request.rollup_id == "r-1"
    assert mc.last_request.batch_index == 7
    assert isinstance(out, rdk_q.QueryBatchResponse)
    assert out.batch.batch_index == 7

    clients.rdk.latest_batch("r-1")
    mc_latest = channel.calls["/qorechain.rdk.v1.Query/LatestBatch"]
    assert mc_latest.last_request.rollup_id == "r-1"


def test_bridge_chain_config_and_operation_route():
    channel = FakeChannel(
        {
            "/qorechain.bridge.v1.Query/ChainConfig": (
                bridge_q.QueryChainConfigResponse().SerializeToString()
            ),
            "/qorechain.bridge.v1.Query/Operation": (
                bridge_q.QueryOperationResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)

    clients.bridge.chain_config("eth-mainnet")
    mc = channel.calls["/qorechain.bridge.v1.Query/ChainConfig"]
    assert isinstance(mc.last_request, bridge_q.QueryChainConfigRequest)
    assert mc.last_request.chain_id == "eth-mainnet"

    clients.bridge.operation("op-1")
    mc_op = channel.calls["/qorechain.bridge.v1.Query/Operation"]
    assert mc_op.last_request.id == "op-1"


def test_multilayer_anchor_and_anchors_route():
    from qorsdk.proto.qorechain.multilayer.v1 import query_pb2 as ml_q

    channel = FakeChannel(
        {
            "/qorechain.multilayer.v1.Query/Anchor": (
                ml_q.QueryAnchorResponse().SerializeToString()
            ),
            "/qorechain.multilayer.v1.Query/Anchors": (
                ml_q.QueryAnchorsResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)

    clients.multilayer.anchor("l-9")
    mc = channel.calls["/qorechain.multilayer.v1.Query/Anchor"]
    assert isinstance(mc.last_request, ml_q.QueryAnchorRequest)
    assert mc.last_request.layer_id == "l-9"

    out = clients.multilayer.anchors("l-9")
    mc2 = channel.calls["/qorechain.multilayer.v1.Query/Anchors"]
    assert mc2.last_request.layer_id == "l-9"
    assert isinstance(out, ml_q.QueryAnchorsResponse)


def test_amm_query_client_routes_and_types():
    from qorsdk.proto.qorechain.amm.v1 import query_pb2 as amm_q

    channel = FakeChannel(
        {
            "/qorechain.amm.v1.Query/Pool": amm_q.QueryPoolResponse().SerializeToString(),
            "/qorechain.amm.v1.Query/QuoteExactIn": (
                amm_q.QueryQuoteExactInResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)

    clients.amm.pool(5)
    mc = channel.calls["/qorechain.amm.v1.Query/Pool"]
    assert isinstance(mc.last_request, amm_q.QueryPoolRequest)
    assert mc.last_request.pool_id == 5

    out = clients.amm.quote_exact_in(5, "uqor", "1000")
    mcq = channel.calls["/qorechain.amm.v1.Query/QuoteExactIn"]
    assert mcq.last_request.pool_id == 5
    assert mcq.last_request.denom_in == "uqor"
    assert mcq.last_request.amount_in == "1000"
    assert isinstance(out, amm_q.QueryQuoteExactInResponse)


def test_license_query_client_routes():
    from qorsdk.proto.qorechain.license.v1 import query_pb2 as lic_q

    channel = FakeChannel(
        {
            "/qorechain.license.v1.Query/Check": (
                lic_q.QueryCheckResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)
    clients.license.check("qor1grantee", "feature-x")
    mc = channel.calls["/qorechain.license.v1.Query/Check"]
    assert isinstance(mc.last_request, lic_q.QueryCheckRequest)
    assert mc.last_request.grantee == "qor1grantee"
    assert mc.last_request.feature_id == "feature-x"


def test_abstractaccount_query_client_routes():
    from qorsdk.proto.qorechain.abstractaccount.v1 import query_pb2 as aa_q

    channel = FakeChannel(
        {
            "/qorechain.abstractaccount.v1.Query/Account": (
                aa_q.QueryAccountResponse().SerializeToString()
            ),
        }
    )
    clients = connect_query_clients("localhost:9090", channel=channel)
    out = clients.abstractaccount.account("qor1acct")
    mc = channel.calls["/qorechain.abstractaccount.v1.Query/Account"]
    assert isinstance(mc.last_request, aa_q.QueryAccountRequest)
    assert mc.last_request.address == "qor1acct"
    assert isinstance(out, aa_q.QueryAccountResponse)
