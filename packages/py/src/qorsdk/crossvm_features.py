"""Pre-signing guard for the chain v3.2.8 ``MsgCrossVMCall`` fields.

``async_gas_limit`` (field 8) and ``async_max_factor`` (field 9) exist only from
chain v3.2.8. A node on an older release cannot decode a message that carries
them and refuses the whole transaction with an unclear parse error, so the SDK
checks the network's protocol feature switches before signing or sending:

* ``async_gas_limit != 0`` needs :data:`CROSSVM_ASYNC_GAS_PRICED_FEATURE`
  (``crossvm-async-gas-priced``) listed and enabled;
* ``async_max_factor != 0`` needs :data:`CROSSVM_ASYNC_ESCROW_FEATURE`
  (``crossvm-async-escrow``) listed and enabled.

A switch that is listed but disabled, absent from the list, or not served at
all (HTTP 404 / 501, an empty list) raises
:class:`CrossVmAsyncFieldsUnsupportedError`. There is no upgrade plan fallback:
a node without the switches is older than v3.2.8. A network error or another
HTTP status raises :class:`CrossVmFeatureQueryError` ("cannot ask"). Both fields
0 makes no request. Answers (on, or not on) are cached per ``(rest_url,
switch)`` for :data:`CROSSVM_FEATURE_CACHE_TTL` seconds; errors are not cached.

Callers that build or sign without a REST URL must pass
``skip_feature_check=True`` to set these fields; otherwise they get
:class:`CrossVmAsyncFieldsUnsupportedError` asking for a REST URL.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from typing import Any

import httpx
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody, TxRaw

from .proto.qorechain.crossvm.v1 import tx_pb2 as crossvm_tx
from .protocol_features import (
    FeatureLookup,
    ProtocolFeatureQueryError,
    lookup_protocol_feature,
    lookup_protocol_feature_async,
)

#: Type URL of the cross-VM call message.
CROSS_VM_CALL_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCall"

#: Switch that must be on for ``async_gas_limit`` (field 8, chain v3.2.8).
CROSSVM_ASYNC_GAS_PRICED_FEATURE = "crossvm-async-gas-priced"
#: Switch that must be on for ``async_max_factor`` (field 9, chain v3.2.8).
CROSSVM_ASYNC_ESCROW_FEATURE = "crossvm-async-escrow"

#: How long an answer is reused, seconds.
CROSSVM_FEATURE_CACHE_TTL = 60.0

#: (field name, proto field number, switch), in field order.
_GUARDED_FIELDS: tuple[tuple[str, int, str], ...] = (
    ("async_gas_limit", 8, CROSSVM_ASYNC_GAS_PRICED_FEATURE),
    ("async_max_factor", 9, CROSSVM_ASYNC_ESCROW_FEATURE),
)

# (rest_url, switch) -> (enabled, expiry on _clock()); answers only, never errors.
_cache: dict[tuple[str, str], tuple[bool, float]] = {}
_clock: Callable[[], float] = time.monotonic


class CrossVmAsyncFieldsUnsupportedError(ValueError):
    """A v3.2.8 ``MsgCrossVMCall`` field is set but the network does not accept it."""


class CrossVmFeatureQueryError(ProtocolFeatureQueryError):
    """The network could not be asked whether it accepts the v3.2.8 fields."""


def clear_crossvm_feature_cache() -> None:
    """Forget cached answers. For tests and for clients that switch networks."""
    _cache.clear()


def _field_value(value: Any, name: str) -> int:
    raw = value.get(name, 0) if isinstance(value, dict) else getattr(value, name, 0)
    return int(raw or 0)


def _call_values(messages: Iterable[Any]) -> list[Any]:
    """The ``MsgCrossVMCall`` values among ``messages`` (Msg objects or protos)."""
    out: list[Any] = []
    for m in messages:
        type_url = getattr(m, "type_url", None)
        if type_url is None and isinstance(m, dict):
            type_url = m.get("type_url") or m.get("typeUrl")
        value = getattr(m, "value", None)
        if value is None and isinstance(m, dict):
            value = m.get("value")
        if type_url == CROSS_VM_CALL_TYPE_URL and value is not None:
            if isinstance(value, bytes):
                parsed = crossvm_tx.MsgCrossVMCall()
                parsed.ParseFromString(value)
                value = parsed
            out.append(value)
        elif isinstance(m, crossvm_tx.MsgCrossVMCall):
            out.append(m)
    return out


def required_crossvm_features(messages: Iterable[Any]) -> list[tuple[str, int, str]]:
    """The ``(field, number, switch)`` entries the given messages need, in field order."""
    values = _call_values(messages)
    return [
        entry for entry in _GUARDED_FIELDS if any(_field_value(v, entry[0]) != 0 for v in values)
    ]


def required_crossvm_features_in_tx(tx_bytes: bytes) -> list[tuple[str, int, str]]:
    """:func:`required_crossvm_features` for signed ``TxRaw`` bytes."""
    try:
        raw = TxRaw()
        raw.ParseFromString(bytes(tx_bytes))
        body = TxBody()
        body.ParseFromString(raw.body_bytes)
    except Exception:  # noqa: BLE001 - not a TxRaw: nothing this guard can read
        return []
    return required_crossvm_features(body.messages)


def _not_on_error(name: str, number: int, switch: str, rest_url: str) -> Exception:
    return CrossVmAsyncFieldsUnsupportedError(
        f"MsgCrossVMCall {name} (field {number}) requires chain v3.2.8 (switch {switch} "
        f"is not on at {rest_url}); leave it 0 on this network"
    )


def _no_rest_error(name: str, number: int, switch: str) -> Exception:
    return CrossVmAsyncFieldsUnsupportedError(
        f"MsgCrossVMCall {name} (field {number}) requires chain v3.2.8 (switch {switch}), "
        "and no REST URL was given to check the network; pass rest_url, or "
        "skip_feature_check=True if you know the network runs v3.2.8, or leave it 0"
    )


def _cannot_ask_error(name: str, switch: str, rest_url: str, lookup: FeatureLookup) -> Exception:
    return CrossVmFeatureQueryError(
        f"cannot ask {rest_url} for its protocol features to check whether MsgCrossVMCall "
        f"{name} is accepted (switch {switch}; {lookup.detail}); the network could not be "
        "asked. Retry, leave the field 0, or pass skip_feature_check=True"
    )


def _cached(rest_url: str, switch: str) -> bool | None:
    hit = _cache.get((rest_url.rstrip("/"), switch))
    if hit is not None and hit[1] > _clock():
        return hit[0]
    return None


def _settle(entry: tuple[str, int, str], rest_url: str, lookup: FeatureLookup) -> None:
    name, number, switch = entry
    if lookup.state == "error":
        raise _cannot_ask_error(name, switch, rest_url, lookup)
    on = lookup.enabled
    _cache[(rest_url.rstrip("/"), switch)] = (on, _clock() + CROSSVM_FEATURE_CACHE_TTL)
    if not on:
        raise _not_on_error(name, number, switch, rest_url)


def require_crossvm_async_fields_supported(
    messages: Iterable[Any],
    rest_url: str | None,
    *,
    skip_feature_check: bool = False,
    client: httpx.Client | None = None,
    timeout: float = 10.0,
) -> None:
    """Refuse ``MsgCrossVMCall`` field 8 / 9 unless the network has switched them on.

    No request when no message sets either field, or when
    ``skip_feature_check=True``.

    :raises CrossVmAsyncFieldsUnsupportedError: The switch is not on (listed
        but disabled, absent, or not served), or ``rest_url`` is missing.
    :raises CrossVmFeatureQueryError: The network could not be asked.
    """
    needed = [] if skip_feature_check else required_crossvm_features(messages)
    _require(needed, rest_url, client, timeout)


def require_crossvm_async_fields_supported_in_tx(
    tx_bytes: bytes,
    rest_url: str | None,
    *,
    skip_feature_check: bool = False,
    client: httpx.Client | None = None,
    timeout: float = 10.0,
) -> None:
    """:func:`require_crossvm_async_fields_supported` for signed ``TxRaw`` bytes."""
    needed = [] if skip_feature_check else required_crossvm_features_in_tx(tx_bytes)
    _require(needed, rest_url, client, timeout)


def _require(
    needed: list[tuple[str, int, str]],
    rest_url: str | None,
    client: httpx.Client | None,
    timeout: float,
) -> None:
    if not needed:
        return
    if not rest_url:
        raise _no_rest_error(*needed[0])
    owns = client is None
    http: httpx.Client | None = client
    try:
        for entry in needed:
            name, number, switch = entry
            hit = _cached(rest_url, switch)
            if hit is True:
                continue
            if hit is False:
                raise _not_on_error(name, number, switch, rest_url)
            if http is None:
                http = httpx.Client(timeout=timeout)
            _settle(entry, rest_url, lookup_protocol_feature(http, rest_url, switch))
    finally:
        if owns and http is not None:
            http.close()


async def require_crossvm_async_fields_supported_async(
    messages: Iterable[Any],
    rest_url: str | None,
    *,
    skip_feature_check: bool = False,
    client: httpx.AsyncClient | None = None,
    timeout: float = 10.0,
) -> None:
    """Async variant of :func:`require_crossvm_async_fields_supported`."""
    needed = [] if skip_feature_check else required_crossvm_features(messages)
    if not needed:
        return
    if not rest_url:
        raise _no_rest_error(*needed[0])
    owns = client is None
    http: httpx.AsyncClient | None = client
    try:
        for entry in needed:
            name, number, switch = entry
            hit = _cached(rest_url, switch)
            if hit is True:
                continue
            if hit is False:
                raise _not_on_error(name, number, switch, rest_url)
            if http is None:
                http = httpx.AsyncClient(timeout=timeout)
            _settle(entry, rest_url, await lookup_protocol_feature_async(http, rest_url, switch))
    finally:
        if owns and http is not None:
            await http.aclose()


__all__ = [
    "CROSS_VM_CALL_TYPE_URL",
    "CROSSVM_ASYNC_GAS_PRICED_FEATURE",
    "CROSSVM_ASYNC_ESCROW_FEATURE",
    "CROSSVM_FEATURE_CACHE_TTL",
    "CrossVmAsyncFieldsUnsupportedError",
    "CrossVmFeatureQueryError",
    "clear_crossvm_feature_cache",
    "required_crossvm_features",
    "required_crossvm_features_in_tx",
    "require_crossvm_async_fields_supported",
    "require_crossvm_async_fields_supported_in_tx",
    "require_crossvm_async_fields_supported_async",
]
