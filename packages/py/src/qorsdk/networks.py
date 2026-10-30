"""Network presets for the QoreChain Python SDK.

``mainnet`` and ``testnet`` point at the public endpoints; ``localnet`` points at
a node on this machine (the localhost ports a default node listens on).
:func:`get_network` returns any of them, and ``create_client(endpoints=...)``
overrides any single endpoint.

Every public hostname lives in :data:`PUBLIC_ENDPOINTS` and nowhere else.

* The testnet endpoints are rate limited per IP at the edge. For production
  traffic, run or use your own node and pass its URLs as ``endpoints``.
* Neither network presets a gRPC endpoint, and mainnet has no public EVM
  WebSocket (poll over ``evm_rpc`` instead). An endpoint a preset leaves unset
  is ``None``; code that needs it raises :class:`EndpointNotConfiguredError`
  rather than falling back to localhost.
* SVM transactions are not open on either network, so no SVM endpoint is
  preset.
* ``https://download.qore.host/<network>/latest.json`` is a release manifest
  (version, peers, state sync), not an endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bech32Prefixes:
    """Bech32 human-readable prefixes used across QoreChain address types."""

    account: str
    validator: str
    consensus: str


@dataclass(frozen=True)
class CoinInfo:
    """Display and base denomination metadata for the network's staking coin."""

    display: str
    base: str
    exponent: int


@dataclass(frozen=True)
class NetworkEndpoints:
    """Service endpoints for talking to a network across its supported VMs."""

    rest: str
    rpc: str
    evm_rpc: str
    #: Native gRPC. No public network presets one.
    grpc: str | None = None
    #: EVM JSON-RPC over WebSocket. Only the testnet presets one.
    evm_ws: str | None = None
    #: SVM JSON-RPC. Not preset: SVM transactions are not open yet.
    svm_rpc: str | None = None


@dataclass(frozen=True)
class NetworkConfig:
    """A fully described network preset."""

    name: str
    live: bool
    chain_id: str
    bech32: Bech32Prefixes
    coin: CoinInfo
    endpoints: NetworkEndpoints


# QoreChain uses the same token and address prefixes on every network.
_BECH32 = Bech32Prefixes(account="qor", validator="qorvaloper", consensus="qorvalcons")
_COIN = CoinInfo(display="QOR", base="uqor", exponent=6)

#: The public endpoints of each network, the single place they are written.
#: Keys are :class:`NetworkEndpoints` fields; a missing key means the network
#: has no public endpoint of that kind.
PUBLIC_ENDPOINTS: dict[str, dict[str, str]] = {
    "mainnet": {
        "rest": "https://api.qore.host",
        "rpc": "https://rpc.qore.host",
        "evm_rpc": "https://evm.qore.host",
    },
    "testnet": {
        "rest": "https://api-testnet.qore.host",
        "rpc": "https://rpc-testnet.qore.host",
        "evm_rpc": "https://evm-testnet.qore.host",
        "evm_ws": "wss://evm-ws-testnet.qore.host",
    },
}

#: The endpoints of a node on this machine (default listen ports).
LOCALNET_ENDPOINTS: dict[str, str] = {
    "rest": "http://localhost:1317",
    "grpc": "http://localhost:9090",
    "rpc": "http://localhost:26657",
    "evm_rpc": "http://localhost:8545",
    "evm_ws": "ws://localhost:8546",
    "svm_rpc": "http://localhost:8899",
}

#: EVM chain id of each network (``eth_chainId``).
EVM_CHAIN_IDS: dict[str, int] = {"mainnet": 9801, "testnet": 9800}

#: The set of built-in network presets, keyed by name.
NETWORKS: dict[str, NetworkConfig] = {
    "testnet": NetworkConfig(
        name="testnet",
        live=True,
        chain_id="qorechain-diana",
        bech32=_BECH32,
        coin=_COIN,
        endpoints=NetworkEndpoints(**PUBLIC_ENDPOINTS["testnet"]),
    ),
    "mainnet": NetworkConfig(
        name="mainnet",
        live=True,
        chain_id="qorechain-vladi",
        bech32=_BECH32,
        coin=_COIN,
        endpoints=NetworkEndpoints(**PUBLIC_ENDPOINTS["mainnet"]),
    ),
    "localnet": NetworkConfig(
        name="localnet",
        live=True,
        chain_id="qorechain-devnet",
        bech32=_BECH32,
        coin=_COIN,
        endpoints=NetworkEndpoints(**LOCALNET_ENDPOINTS),
    ),
}


class EndpointNotConfiguredError(ValueError):
    """An endpoint the call needs is not set for this network."""

    def __init__(self, key: str, network: str) -> None:
        self.key = key
        self.network = network
        super().__init__(
            f"{key} is not configured for the {network} preset; pass endpoints.{key} "
            f"(create_client(endpoints={{'{key}': '...'}})) or use your own node"
        )


def require_endpoint(network: NetworkConfig, key: str) -> str:
    """The ``key`` endpoint of ``network``.

    :raises EndpointNotConfiguredError: When the network has none (for example
        ``grpc`` or ``svm_rpc`` on a public preset, or ``evm_ws`` on mainnet).
    """
    value: str | None = getattr(network.endpoints, key, None) if network.endpoints else None
    if not value:
        raise EndpointNotConfiguredError(key, network.name)
    return value


def get_network(name: str) -> NetworkConfig:
    """Resolve a network preset by name.

    :returns: The requested live :class:`NetworkConfig`.
    :raises ValueError: If the named network is unknown.
    """
    config = NETWORKS.get(name)
    if config is None:
        raise ValueError(f"unknown network: {name}")
    return config


def list_networks() -> list[str]:
    """List the known network preset names without any liveness check."""
    return list(NETWORKS.keys())
