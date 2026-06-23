"""Network presets for the QoreChain Python SDK.

The ``testnet`` preset is fully populated and live; its endpoints default to
localhost ports so the SDK works out of the box against a locally running node,
and callers can override them with real hostnames. The ``mainnet`` preset is a
placeholder: mainnet is not yet live, so it carries no chain ID and no
endpoints, and :func:`get_network` raises if asked for it.
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
    grpc: str
    rpc: str
    evm_rpc: str
    evm_ws: str
    svm_rpc: str


@dataclass(frozen=True)
class NetworkConfig:
    """A fully described network preset."""

    name: str
    live: bool
    chain_id: str | None
    bech32: Bech32Prefixes
    coin: CoinInfo
    endpoints: NetworkEndpoints | None


# QoreChain uses the same token and address prefixes on every network.
_BECH32 = Bech32Prefixes(account="qor", validator="qorvaloper", consensus="qorvalcons")
_COIN = CoinInfo(display="QOR", base="uqor", exponent=6)

#: The set of built-in network presets, keyed by name.
NETWORKS: dict[str, NetworkConfig] = {
    "testnet": NetworkConfig(
        name="testnet",
        live=True,
        chain_id="qorechain-diana",
        bech32=_BECH32,
        coin=_COIN,
        endpoints=NetworkEndpoints(
            rest="http://localhost:1317",
            grpc="http://localhost:9090",
            rpc="http://localhost:26657",
            evm_rpc="http://localhost:8545",
            evm_ws="ws://localhost:8546",
            svm_rpc="http://localhost:8899",
        ),
    ),
    "mainnet": NetworkConfig(
        name="mainnet",
        live=False,
        chain_id=None,
        bech32=_BECH32,
        coin=_COIN,
        endpoints=None,
    ),
}


def get_network(name: str) -> NetworkConfig:
    """Resolve a network preset by name.

    :returns: The requested live :class:`NetworkConfig`.
    :raises ValueError: If the named network is unknown or not yet live
        (e.g. ``mainnet``). Pass custom endpoints to target such a network.
    """
    config = NETWORKS.get(name)
    if config is None:
        raise ValueError(f"unknown network: {name}")
    if not config.live:
        raise ValueError(f"{name} is not yet live — pass custom endpoints")
    return config


def list_networks() -> list[str]:
    """List the known network preset names without any liveness check."""
    return list(NETWORKS.keys())
