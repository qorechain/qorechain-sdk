"""Top-level ``create_client`` factory for the QoreChain Python SDK.

:func:`create_client` resolves a :class:`~qorechain.networks.NetworkConfig`
(applying any endpoint overrides) and composes the read clients
(:class:`~qorechain.rest.RestClient` and the ``qor_`` :class:`~qorechain.qor.QorClient`)
plus a fee-estimate convenience.

Network resolution rules:
  - The default network is ``testnet``. Both ``testnet`` and ``mainnet`` are live
    and ship localhost endpoint defaults; callers can override them with real
    hostnames.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from .fees import estimate_fee
from .networks import NETWORKS, NetworkConfig, NetworkEndpoints
from .qor import QorClient
from .rest import FeeUrgency, RestClient

_ENDPOINT_KEYS = ("rest", "grpc", "rpc", "evm_rpc", "evm_ws", "svm_rpc")


class _Fees:
    """Fee-estimate convenience surface bound to a :class:`RestClient`."""

    def __init__(self, rest: RestClient) -> None:
        self._rest = rest

    def estimate(self, urgency: FeeUrgency = "normal") -> dict[str, Any]:
        """Estimate a fee for the given urgency via the AI fee oracle.

        Falls back to a deterministic static fee when the oracle is unavailable.
        Returns a Cosmos ``StdFee``-shaped dict: ``{"amount": [...], "gas": ...}``.
        """
        return estimate_fee(self._rest, urgency=urgency)


@dataclass
class QoreChainClient:
    """A composed QoreChain client: resolved config, read clients, fee helper."""

    network: NetworkConfig
    rest: RestClient
    qor: QorClient
    fees: _Fees

    def close(self) -> None:
        self.rest.close()
        self.qor.close()

    def __enter__(self) -> QoreChainClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _resolve_network(
    network: str, endpoints: dict[str, str] | None, chain_id: str | None
) -> NetworkConfig:
    overrides = endpoints or {}
    bad = set(overrides) - set(_ENDPOINT_KEYS)
    if bad:
        raise ValueError(f"unknown endpoint keys: {sorted(bad)}")

    base = NETWORKS.get(network)
    if base is None:
        raise ValueError(f"unknown network: {network}")

    # Live preset (testnet or mainnet): overlay endpoint overrides onto the defaults.
    current = {k: getattr(base.endpoints, k) for k in _ENDPOINT_KEYS}
    current.update(overrides)
    return replace(
        base,
        chain_id=chain_id or base.chain_id,
        endpoints=NetworkEndpoints(**current),
    )


def _require_endpoint(network: NetworkConfig, key: str) -> str:
    value: str | None = getattr(network.endpoints, key, None) if network.endpoints else None
    if not value:
        raise ValueError(
            f'endpoint "{key}" is not configured — pass it via '
            f"create_client(endpoints={{'{key}': '...'}})"
        )
    return value


def create_client(
    network: str = "testnet",
    endpoints: dict[str, str] | None = None,
    *,
    chain_id: str | None = None,
    timeout: float = 30.0,
) -> QoreChainClient:
    """Create a composed :class:`QoreChainClient`.

    :param network: Network preset to target. Defaults to ``"testnet"``.
    :param endpoints: Endpoint overrides (keys: ``rest``, ``grpc``, ``rpc``,
        ``evm_rpc``, ``evm_ws``, ``svm_rpc``). Both presets default to localhost.
    :param chain_id: Chain ID override.
    :raises ValueError: If the network or an endpoint key is unknown.
    """
    resolved = _resolve_network(network, endpoints, chain_id)
    rest = RestClient(_require_endpoint(resolved, "rest"), timeout=timeout)
    qor = QorClient(_require_endpoint(resolved, "evm_rpc"), timeout=timeout)
    return QoreChainClient(network=resolved, rest=rest, qor=qor, fees=_Fees(rest))


__all__ = ["QoreChainClient", "create_client"]
