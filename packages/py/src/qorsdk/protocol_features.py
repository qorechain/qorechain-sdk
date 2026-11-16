"""The chain's protocol feature switches (chain v3.2.4,
``/qorechain/pqc/v1/protocol_features``).

Each consensus change ships behind a named switch that a governance upgrade
turns on at its height. Reading the switch tells a client whether the network
enforces a rule today, without inferring it from upgrade plan names. Networks
below v3.2.4 do not serve the route: use :func:`qorsdk.upgrades.is_upgrade_applied`
there.

Automatic choices that depend on a chain upgrade (the hybrid sign-bytes form,
whether to attach a PQC proof of possession) read the switch FIRST, through
:func:`lookup_protocol_feature`, which sorts the node's answer into one of four
outcomes (:class:`FeatureLookup`):

``"enabled"`` / ``"disabled"``
    HTTP 200 and the switch is listed: its ``enabled`` value decides, and no
    upgrade plan is asked.
``"not_served"``
    The node says definitively that it cannot answer: HTTP 404 or 501 (the
    gateway's "Not Implemented", body code 12), or HTTP 200 with an empty list,
    or HTTP 200 without that switch. Only then may the caller fall back to the
    ``applied_plan`` queries.
``"error"``
    Anything else: a transport failure or timeout, any other HTTP status (5xx,
    429, ...), a body that is not the expected JSON. The caller must raise and
    must NOT fall back: forks, fresh devnets and event chains answer
    ``applied_plan`` with height 0 while running the new rules, so a silent
    fallback picks the old form and the chain refuses the transaction.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx

#: REST path of the protocol feature switches.
PROTOCOL_FEATURES_PATH = "/qorechain/pqc/v1/protocol_features"

#: HTTP statuses that mean "this node does not serve the route" (a node below
#: chain v3.2.4): 404, and 501 for the gateway's "Not Implemented" (code 12).
NOT_SERVED_STATUSES: frozenset[int] = frozenset({404, 501})

#: The four outcomes of :func:`lookup_protocol_feature`.
FeatureLookupState = Literal["enabled", "disabled", "not_served", "error"]


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


class ProtocolFeatureQueryError(Exception):
    """The network could not be asked for its protocol feature switches.

    Raised instead of guessing from the upgrade plans: pass the choice
    explicitly (for example ``sign_bytes_version="v1"`` / ``"v2"``) or retry.
    """


@dataclass(frozen=True)
class FeatureLookup:
    """What a node said about one switch (see :func:`lookup_protocol_feature`)."""

    #: ``"enabled"`` / ``"disabled"``: listed by the node; ``"not_served"``: the
    #: node cannot answer (fall back to the upgrade plans); ``"error"``: the node
    #: could not be asked (do NOT fall back).
    state: FeatureLookupState
    #: Human-readable reason, set for ``"not_served"`` and ``"error"``.
    detail: str = ""

    @property
    def found(self) -> bool:
        """True when the node listed the switch (``enabled`` or ``disabled``)."""
        return self.state in ("enabled", "disabled")

    @property
    def enabled(self) -> bool:
        """True only for ``"enabled"``."""
        return self.state == "enabled"


def protocol_features_url(rest_url: str) -> str:
    """The full URL of the protocol feature switches on ``rest_url``."""
    return f"{rest_url.rstrip('/')}{PROTOCOL_FEATURES_PATH}"


def classify_protocol_feature_response(
    status_code: int, read_json: Any, name: str
) -> FeatureLookup:
    """Sort one HTTP answer of the protocol features route for the switch ``name``.

    :param status_code: The HTTP status.
    :param read_json: A zero-argument callable returning the parsed JSON body
        (called only for HTTP 200; any exception it raises means ``"error"``).
    :param name: The switch, e.g. ``"pqc-sign-bytes-v2"``.
    """
    if status_code in NOT_SERVED_STATUSES:
        return FeatureLookup("not_served", f"HTTP {status_code}")
    if status_code != 200:
        return FeatureLookup("error", f"HTTP {status_code}")
    try:
        payload = read_json()
    except Exception as err:  # noqa: BLE001 - a body that is not JSON
        return FeatureLookup("error", f"unparsable body ({err})")
    if not isinstance(payload, Mapping):
        return FeatureLookup("error", f"unexpected body {payload!r:.80}")
    raw = payload.get("features")
    if raw is not None and not isinstance(raw, list):
        return FeatureLookup("error", f"unexpected features value {raw!r:.80}")
    try:
        parsed = parse_protocol_features(payload)
    except (TypeError, ValueError, KeyError) as err:
        return FeatureLookup("error", f"unparsable body ({err})")
    listed = [f for f in parsed.features if f.name == name]
    if not parsed.features:
        return FeatureLookup("not_served", "empty feature list")
    if not listed:
        return FeatureLookup("not_served", f"{name} is not listed")
    return FeatureLookup("enabled" if any(f.enabled for f in listed) else "disabled")


def _classify_response(resp: Any, name: str) -> FeatureLookup:
    return classify_protocol_feature_response(int(resp.status_code), resp.json, name)


def lookup_protocol_feature(http: httpx.Client, rest_url: str, name: str) -> FeatureLookup:
    """Ask ``rest_url`` for the switch ``name`` and classify the answer.

    Never raises for a network problem: a transport failure or timeout comes
    back as ``FeatureLookup("error", ...)``. Not cached; callers cache.
    """
    try:
        resp = http.get(protocol_features_url(rest_url))
    except Exception as err:  # noqa: BLE001 - transport failure, timeout, ...
        return FeatureLookup("error", f"{type(err).__name__}: {err}")
    return _classify_response(resp, name)


async def lookup_protocol_feature_async(
    http: httpx.AsyncClient, rest_url: str, name: str
) -> FeatureLookup:
    """Asynchronous mirror of :func:`lookup_protocol_feature`."""
    try:
        resp = await http.get(protocol_features_url(rest_url))
    except Exception as err:  # noqa: BLE001 - transport failure, timeout, ...
        return FeatureLookup("error", f"{type(err).__name__}: {err}")
    return _classify_response(resp, name)


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
    "NOT_SERVED_STATUSES",
    "FeatureLookupState",
    "FeatureLookup",
    "ProtocolFeatureQueryError",
    "protocol_features_url",
    "classify_protocol_feature_response",
    "lookup_protocol_feature",
    "lookup_protocol_feature_async",
    "ProtocolFeature",
    "ProtocolFeatures",
    "parse_protocol_features",
    "fetch_protocol_features",
    "is_protocol_feature_enabled",
    "fetch_protocol_features_async",
    "is_protocol_feature_enabled_async",
]
