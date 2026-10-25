"""The chain's protocol feature switches (chain v3.2.4,
``/qorechain/pqc/v1/protocol_features``).

Each consensus change ships behind a named switch that a governance upgrade
turns on at its height. Reading the switch tells a client whether the network
enforces a rule today, without inferring it from upgrade plan names. Networks
below v3.2.4 do not serve the route: use :func:`qorsdk.upgrades.is_upgrade_applied`
there.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

#: REST path of the protocol feature switches.
PROTOCOL_FEATURES_PATH = "/qorechain/pqc/v1/protocol_features"


@dataclass(frozen=True)
class ProtocolFeature:
    """One switch."""

    name: str
    #: On at the current height.
    enabled: bool
    #: False for a switch a newer release enabled and this node does not know.
    known: bool
    #: Carried by the node's binary but not enabled by any release yet.
    staged: bool


@dataclass(frozen=True)
class ProtocolFeatures:
    """Every switch the node knows, at ``height``."""

    features: tuple[ProtocolFeature, ...]
    height: int

    def is_enabled(self, name: str) -> bool:
        """Whether the switch ``name`` is on. A switch the node does not list is off."""
        return any(f.name == name and f.enabled for f in self.features)


def _height(raw: Any) -> int:
    if isinstance(raw, bool) or raw is None or raw == "":
        return 0
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(f"protocol_features height is not an integer: {raw!r}") from None
    raise ValueError(f"protocol_features height is not an integer: {raw!r}")


def parse_protocol_features(payload: Mapping[str, Any]) -> ProtocolFeatures:
    """Parse a ``protocol_features`` REST payload."""
    raw = payload.get("features")
    items = [x for x in raw if isinstance(x, Mapping)] if isinstance(raw, list) else []
    return ProtocolFeatures(
        features=tuple(
            ProtocolFeature(
                name=x["name"] if isinstance(x.get("name"), str) else "",
                enabled=x.get("enabled") is True,
                known=x.get("known") is True,
                staged=x.get("staged") is True,
            )
            for x in items
        ),
        height=_height(payload.get("height")),
    )


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def fetch_protocol_features(rest: _RestGet) -> ProtocolFeatures:
    """Read the network's protocol feature switches.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    """
    return parse_protocol_features(rest.get(PROTOCOL_FEATURES_PATH))


def is_protocol_feature_enabled(rest: _RestGet, name: str) -> bool:
    """Whether the switch ``name`` is on. A switch the node does not list is off."""
    return fetch_protocol_features(rest).is_enabled(name)


async def fetch_protocol_features_async(rest: _AsyncRestGet) -> ProtocolFeatures:
    """Asynchronous mirror of :func:`fetch_protocol_features`."""
    return parse_protocol_features(await rest.get(PROTOCOL_FEATURES_PATH))


async def is_protocol_feature_enabled_async(rest: _AsyncRestGet, name: str) -> bool:
    """Asynchronous mirror of :func:`is_protocol_feature_enabled`."""
    return (await fetch_protocol_features_async(rest)).is_enabled(name)


__all__ = [
    "PROTOCOL_FEATURES_PATH",
    "ProtocolFeature",
    "ProtocolFeatures",
    "parse_protocol_features",
    "fetch_protocol_features",
    "is_protocol_feature_enabled",
    "fetch_protocol_features_async",
    "is_protocol_feature_enabled_async",
]
