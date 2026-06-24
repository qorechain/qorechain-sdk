import httpx
import pytest
import respx

from qorechain import create_client


def test_testnet_default():
    client = create_client()
    assert client.network.name == "testnet"
    assert client.network.chain_id == "qorechain-diana"
    assert client.rest.base_url == "http://localhost:1317"
    assert client.qor.url == "http://localhost:8545"
    client.close()


def test_endpoint_override_applied():
    client = create_client(endpoints={"rest": "https://rest.example.com", "evm_rpc": "https://rpc.example.com"})
    assert client.rest.base_url == "https://rest.example.com"
    assert client.qor.url == "https://rpc.example.com"
    # Non-overridden endpoints keep their defaults.
    assert client.network.endpoints.rpc == "http://localhost:26657"
    client.close()


def test_mainnet_default():
    client = create_client(network="mainnet")
    assert client.network.name == "mainnet"
    assert client.network.chain_id == "qorechain-vladi"
    assert client.rest.base_url == "http://localhost:1317"
    assert client.qor.url == "http://localhost:8545"
    client.close()


def test_mainnet_with_endpoints():
    client = create_client(
        network="mainnet",
        endpoints={"rest": "https://rest.qore.network", "evm_rpc": "https://evm.qore.network"},
        chain_id="qorechain-1",
    )
    assert client.network.name == "mainnet"
    assert client.network.chain_id == "qorechain-1"
    assert client.rest.base_url == "https://rest.qore.network"
    client.close()


def test_unknown_endpoint_key_rejected():
    with pytest.raises(ValueError, match="unknown endpoint keys"):
        create_client(endpoints={"bogus": "x"})


@respx.mock
def test_fees_estimate_uses_oracle():
    respx.get("http://localhost:1317/qorechain/ai/v1/fee-estimate").mock(
        return_value=httpx.Response(200, json={"suggested_fee_uqor": "12345"})
    )
    client = create_client()
    fee = client.fees.estimate("fast")
    assert fee == {"amount": [{"denom": "uqor", "amount": "12345"}], "gas": "200000"}
    client.close()


@respx.mock
def test_fees_estimate_static_fallback_on_error():
    respx.get("http://localhost:1317/qorechain/ai/v1/fee-estimate").mock(
        return_value=httpx.Response(503)
    )
    client = create_client()
    fee = client.fees.estimate()
    # ceil(200000 * 0.025) = 5000
    assert fee == {"amount": [{"denom": "uqor", "amount": "5000"}], "gas": "200000"}
    client.close()
