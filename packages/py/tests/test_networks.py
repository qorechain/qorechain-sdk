import pytest

from qorsdk import NETWORKS, get_network, list_networks


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
    assert net.endpoints.rest == "http://localhost:1317"
    assert net.endpoints.grpc == "http://localhost:9090"
    assert net.endpoints.rpc == "http://localhost:26657"
    assert net.endpoints.evm_rpc == "http://localhost:8545"
    assert net.endpoints.evm_ws == "ws://localhost:8546"
    assert net.endpoints.svm_rpc == "http://localhost:8899"


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
    assert NETWORKS["mainnet"].endpoints.rest == "http://localhost:1317"
    assert NETWORKS["mainnet"].endpoints.evm_rpc == "http://localhost:8545"
    assert NETWORKS["mainnet"].endpoints.svm_rpc == "http://localhost:8899"
    net = get_network("mainnet")
    assert net.live is True
    assert net.chain_id == "qorechain-vladi"


def test_unknown_network():
    with pytest.raises(ValueError, match="unknown network"):
        get_network("devnet")


def test_list_networks():
    assert list_networks() == ["testnet", "mainnet"]
