import httpx
import pytest
import respx

from qorsdk import EndpointNotConfiguredError, create_client, require_endpoint
from qorsdk.networks import LOCALNET_ENDPOINTS, PUBLIC_ENDPOINTS

TESTNET = PUBLIC_ENDPOINTS["testnet"]
MAINNET = PUBLIC_ENDPOINTS["mainnet"]


def test_testnet_default():
    client = create_client()
    assert client.network.name == "testnet"
    assert client.network.chain_id == "qorechain-diana"
    assert client.rest.base_url == TESTNET["rest"]
    assert client.qor.url == TESTNET["evm_rpc"]
    client.close()


def test_localnet_keeps_the_localhost_endpoints():
    client = create_client(network="localnet")
    assert client.rest.base_url == LOCALNET_ENDPOINTS["rest"] == "http://localhost:1317"
    assert client.qor.url == LOCALNET_ENDPOINTS["evm_rpc"] == "http://localhost:8545"
    assert client.network.endpoints.svm_rpc == "http://localhost:8899"
    client.close()


def test_unset_endpoint_raises_instead_of_falling_back_to_localhost():
    client = create_client(network="mainnet")
    assert client.network.endpoints.evm_ws is None
    not_set = "evm_ws is not configured for the mainnet preset"
    with pytest.raises(EndpointNotConfiguredError, match=not_set):
        require_endpoint(client.network, "evm_ws")
    with pytest.raises(ValueError, match="pass endpoints.svm_rpc"):
        require_endpoint(client.network, "svm_rpc")
    client.close()
    overridden = create_client(network="mainnet", endpoints={"grpc": "http://my-node:9090"})
    assert require_endpoint(overridden.network, "grpc") == "http://my-node:9090"
    overridden.close()


def test_endpoint_override_applied():
    client = create_client(endpoints={"rest": "https://rest.example.com", "evm_rpc": "https://rpc.example.com"})
    assert client.rest.base_url == "https://rest.example.com"
    assert client.qor.url == "https://rpc.example.com"
    # Non-overridden endpoints keep their defaults.
    assert client.network.endpoints.rpc == TESTNET["rpc"]
    client.close()


def test_mainnet_default():
    client = create_client(network="mainnet")
    assert client.network.name == "mainnet"
    assert client.network.chain_id == "qorechain-vladi"
    assert client.rest.base_url == MAINNET["rest"]
    assert client.qor.url == MAINNET["evm_rpc"]
    client.close()


def test_mainnet_with_endpoints():
    client = create_client(
        network="mainnet",
        endpoints={"rest": "https://rest.example.com", "evm_rpc": "https://evm.example.com"},
        chain_id="qorechain-1",
    )
    assert client.network.name == "mainnet"
    assert client.network.chain_id == "qorechain-1"
    assert client.rest.base_url == "https://rest.example.com"
    client.close()


def test_unknown_endpoint_key_rejected():
    with pytest.raises(ValueError, match="unknown endpoint keys"):
        create_client(endpoints={"bogus": "x"})


@respx.mock
def test_fees_estimate_uses_oracle():
    respx.get(f"{TESTNET['rest']}/qorechain/ai/v1/fee-estimate").mock(
        return_value=httpx.Response(200, json={"suggested_fee_uqor": "12345"})
    )
    client = create_client()
    fee = client.fees.estimate("fast")
    assert fee == {"amount": [{"denom": "uqor", "amount": "12345"}], "gas": "200000"}
    client.close()


@respx.mock
def test_fees_estimate_static_fallback_on_error():
    respx.get(f"{TESTNET['rest']}/qorechain/ai/v1/fee-estimate").mock(
        return_value=httpx.Response(503)
    )
    client = create_client()
    fee = client.fees.estimate()
    # ceil(200000 * 0.15) = 30000
    assert fee == {"amount": [{"denom": "uqor", "amount": "30000"}], "gas": "200000"}
    client.close()
