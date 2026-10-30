import pytest

from qorsdk import NETWORKS, get_network, list_networks
from qorsdk.networks import EVM_CHAIN_IDS, LOCALNET_ENDPOINTS, PUBLIC_ENDPOINTS


def test_testnet_preset():
    net = get_network("testnet")
    assert net.live is True
    assert net.chain_id == "qorechain-diana"
    assert net.bech32.account == "qor"
    assert net.bech32.validator == "qorvaloper"
    assert net.bech32.consensus == "qorvalcons"
    assert net.coin.display == "QOR"
    assert net.coin.base == "uqor"
    assert net.coin.exponent == 6
    assert net.endpoints is not None
    t = PUBLIC_ENDPOINTS["testnet"]
    assert net.endpoints.rest == t["rest"]
    assert net.endpoints.rpc == t["rpc"]
    assert net.endpoints.evm_rpc == t["evm_rpc"]
    assert net.endpoints.evm_ws == t["evm_ws"]
    assert net.endpoints.grpc is None
    assert net.endpoints.svm_rpc is None
    assert EVM_CHAIN_IDS["testnet"] == 9800


def test_mainnet_live():
    assert NETWORKS["mainnet"].live is True
    assert NETWORKS["mainnet"].chain_id == "qorechain-vladi"
    assert NETWORKS["mainnet"].bech32.account == "qor"
    assert NETWORKS["mainnet"].bech32.validator == "qorvaloper"
    assert NETWORKS["mainnet"].bech32.consensus == "qorvalcons"
    assert NETWORKS["mainnet"].coin.display == "QOR"
    assert NETWORKS["mainnet"].coin.base == "uqor"
    assert NETWORKS["mainnet"].coin.exponent == 6
    assert NETWORKS["mainnet"].endpoints is not None
    m = PUBLIC_ENDPOINTS["mainnet"]
    assert NETWORKS["mainnet"].endpoints.rest == m["rest"]
    assert NETWORKS["mainnet"].endpoints.rpc == m["rpc"]
    assert NETWORKS["mainnet"].endpoints.evm_rpc == m["evm_rpc"]
    assert NETWORKS["mainnet"].endpoints.evm_ws is None
    assert NETWORKS["mainnet"].endpoints.grpc is None
    assert NETWORKS["mainnet"].endpoints.svm_rpc is None
    assert EVM_CHAIN_IDS["mainnet"] == 9801
    net = get_network("mainnet")
    assert net.live is True
    assert net.chain_id == "qorechain-vladi"


def test_unknown_network():
    with pytest.raises(ValueError, match="unknown network"):
        get_network("devnet")


def test_list_networks():
    assert list_networks() == ["testnet", "mainnet", "localnet"]


def test_public_endpoints_are_https_or_wss():
    for net in PUBLIC_ENDPOINTS.values():
        for url in net.values():
            assert url.startswith(("https://", "wss://")), url


def test_localnet_is_the_old_localhost_preset():
    net = get_network("localnet")
    assert net.chain_id == "qorechain-devnet"
    assert net.live is True
    for key, url in LOCALNET_ENDPOINTS.items():
        assert getattr(net.endpoints, key) == url
    assert net.endpoints.grpc == "http://localhost:9090"
    assert net.endpoints.evm_ws == "ws://localhost:8546"
