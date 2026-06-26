import httpx
import pytest
import respx

from qorsdk import (
    AsyncJsonRpcClient,
    AsyncQorClient,
    AsyncRestClient,
    JsonRpcClient,
    JsonRpcError,
    QorClient,
    QoreHttpError,
    RestClient,
)
from qorsdk.qor import QOR_METHODS

BASE = "http://localhost:1317"
RPC = "http://localhost:8545"

ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu"

# (method_name, args, expected_path, expected_params)
REST_CASES = [
    ("get_all_balances", (ADDR,), f"/cosmos/bank/v1beta1/balances/{ADDR}", {}),
    ("get_ai_stats", (), "/qorechain/ai/v1/stats", {}),
    ("get_fee_estimate", ("fast",), "/qorechain/ai/v1/fee-estimate", {"urgency": "fast"}),
    ("get_bridge_chains", (), "/qorechain/bridge/v1/chains", {}),
    ("get_pqc_account", (ADDR,), f"/qorechain/pqc/v1/accounts/{ADDR}", {}),
    (
        "get_reputation",
        ("qorvaloper1abc",),
        "/qorechain/reputation/v1/validators/qorvaloper1abc",
        {},
    ),
    ("get_burn_stats", (), "/qorechain/burn/v1/stats", {}),
    ("get_xqore_position", (ADDR,), f"/qorechain/xqore/v1/position/{ADDR}", {}),
    ("get_inflation_rate", (), "/qorechain/inflation/v1/rate", {}),
]


@pytest.mark.parametrize("method,args,path,params", REST_CASES)
@respx.mock
def test_rest_method_hits_exact_path(method, args, path, params):
    route = respx.get(f"{BASE}{path}").mock(return_value=httpx.Response(200, json={"ok": True}))
    client = RestClient(BASE)
    result = getattr(client, method)(*args)
    client.close()
    assert result == {"ok": True}
    assert route.called
    request = route.calls.last.request
    assert request.url.path == path
    for k, v in params.items():
        assert request.url.params.get(k) == v


@respx.mock
def test_rest_generic_get_with_params():
    respx.get(f"{BASE}/custom/route").mock(return_value=httpx.Response(200, json={"v": 1}))
    client = RestClient(BASE)
    assert client.get("/custom/route", {"a": "b", "skip": None}) == {"v": 1}
    request = respx.calls.last.request
    assert request.url.params.get("a") == "b"
    assert "skip" not in request.url.params
    client.close()


@respx.mock
def test_rest_raises_on_non_2xx():
    respx.get(f"{BASE}/qorechain/burn/v1/stats").mock(return_value=httpx.Response(500, text="boom"))
    client = RestClient(BASE)
    with pytest.raises(QoreHttpError) as exc:
        client.get_burn_stats()
    assert exc.value.status == 500
    client.close()


@respx.mock
@pytest.mark.asyncio
async def test_async_rest_method():
    respx.get(f"{BASE}/qorechain/ai/v1/stats").mock(
        return_value=httpx.Response(200, json={"async": True})
    )
    async with AsyncRestClient(BASE) as client:
        assert await client.get_ai_stats() == {"async": True}


# --- qor_ JSON-RPC namespace ---

# (method_name, args, expected_wire_method, expected_params)
QOR_CASES = [
    ("get_pqc_key_status", (ADDR,), "qor_getPQCKeyStatus", [ADDR]),
    ("get_hybrid_signature_mode", (), "qor_getHybridSignatureMode", []),
    ("get_ai_stats", (), "qor_getAIStats", []),
    ("get_cross_vm_message", ("m1",), "qor_getCrossVMMessage", ["m1"]),
    ("get_reputation_score", ("v1",), "qor_getReputationScore", ["v1"]),
    ("get_layer_info", ("l1",), "qor_getLayerInfo", ["l1"]),
    ("get_bridge_status", ("c1",), "qor_getBridgeStatus", ["c1"]),
    ("get_rl_agent_status", (), "qor_getRLAgentStatus", []),
    ("get_rl_observation", (), "qor_getRLObservation", []),
    ("get_rl_reward", (), "qor_getRLReward", []),
    ("get_pool_classification", ("v1",), "qor_getPoolClassification", ["v1"]),
    ("get_burn_stats", (), "qor_getBurnStats", []),
    ("get_xqore_position", (ADDR,), "qor_getXQOREPosition", [ADDR]),
    ("get_inflation_rate", (), "qor_getInflationRate", []),
    ("get_tokenomics_overview", (), "qor_getTokenomicsOverview", []),
    ("get_rollup_status", ("r1",), "qor_getRollupStatus", ["r1"]),
    ("list_rollups", (), "qor_listRollups", []),
    ("get_settlement_batch", ("r1", 3), "qor_getSettlementBatch", ["r1", 3]),
    ("suggest_rollup_profile", ("defi",), "qor_suggestRollupProfile", ["defi"]),
    ("get_da_blob_status", ("r1", 5), "qor_getDABlobStatus", ["r1", 5]),
    ("get_btc_staking_position", (ADDR,), "qor_getBTCStakingPosition", [ADDR]),
    ("get_abstract_account", (ADDR,), "qor_getAbstractAccount", [ADDR]),
    ("get_fair_block_status", (), "qor_getFairBlockStatus", []),
    ("get_gas_abstraction_config", (), "qor_getGasAbstractionConfig", []),
    ("get_lane_configuration", (), "qor_getLaneConfiguration", []),
]


def test_qor_cases_cover_all_25_methods():
    assert len(QOR_CASES) == 25
    assert {c[0] for c in QOR_CASES} == set(QOR_METHODS)
    assert {c[2] for c in QOR_CASES} == set(QOR_METHODS.values())


@pytest.mark.parametrize("method,args,wire,params", QOR_CASES)
@respx.mock
def test_qor_method_sends_exact_wire_name(method, args, wire, params):
    route = respx.post(RPC).mock(
        return_value=httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"ok": 1}})
    )
    client = QorClient(RPC)
    result = getattr(client, method)(*args)
    client.close()
    assert result == {"ok": 1}
    body = route.calls.last.request.read()
    import json

    payload = json.loads(body)
    assert payload["method"] == wire
    assert payload["params"] == params
    assert payload["jsonrpc"] == "2.0"


@respx.mock
def test_jsonrpc_error_mapping():
    respx.post(RPC).mock(
        return_value=httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "not found"}},
        )
    )
    client = JsonRpcClient(RPC)
    with pytest.raises(JsonRpcError) as exc:
        client.call("qor_doesNotExist", [])
    assert exc.value.code == -32601
    assert "not found" in str(exc.value)
    client.close()


@respx.mock
def test_jsonrpc_auto_increment_ids():
    respx.post(RPC).mock(
        return_value=httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "x"})
    )
    import json

    client = JsonRpcClient(RPC)
    client.call("a")
    client.call("b")
    ids = [json.loads(c.request.read())["id"] for c in respx.calls]
    assert ids == [1, 2]
    client.close()


@respx.mock
@pytest.mark.asyncio
async def test_async_qor_and_jsonrpc():
    import json

    route = respx.post(RPC).mock(
        return_value=httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"ok": 2}})
    )
    async with AsyncQorClient(RPC) as client:
        assert await client.get_tokenomics_overview() == {"ok": 2}
    payload = json.loads(route.calls.last.request.read())
    assert payload["method"] == "qor_getTokenomicsOverview"

    # Generic async JSON-RPC client too.
    async with AsyncJsonRpcClient(RPC) as raw:
        assert await raw.call("qor_getBurnStats") == {"ok": 2}
