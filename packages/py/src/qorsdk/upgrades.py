"""Which chain releases a network has applied.

A release adds message fields and message types, and a node that has not
applied it does not know them. The transaction decoder refuses a message that
carries an unknown field, so setting one of the new OPTIONAL fields before the
upgrade does not get it ignored: the whole transaction is refused. A client
therefore sets a release's new fields only after the network has applied that
release, and this module is how it finds out.

The chain has no query for its protocol features, but each release switches
them on at its upgrade plan height, and the upgrade module reports the height at
which a plan was applied. A plan name is the same on every network.
"""

from __future__ import annotations

import time
from typing import Any, Protocol
from urllib.parse import quote

#: EIP-7702 delegation consent, the measured EVM spending policy, the
#: ``ecdsa_pubkey`` check on PQC registration and the new bridge, multilayer and
#: RDK messages.
CHAIN_UPGRADE_V3_2_2 = "v3.2.2"

#: How long a "not applied yet" answer is trusted before asking again, seconds.
NOT_APPLIED_TTL_S = 60.0

# An applied plan stays applied, so a positive answer is cached for the life of
# the process. A negative one is cached briefly: the upgrade can land at any
# block, and a client that cached "no" for long would keep leaving the new
# fields off after the network switched.
_cache: dict[tuple[str, str], tuple[int, float]] = {}


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def applied_plan_path(upgrade: str) -> str:
    """The REST path of the ``applied_plan`` query for ``upgrade``."""
    return f"/cosmos/upgrade/v1beta1/applied_plan/{quote(upgrade, safe='')}"


def parse_applied_height(payload: Any) -> int:
    """The applied height from an ``applied_plan`` payload; ``0`` = not applied.

    Mainnet answers ``{"height": "0"}`` for a plan it has not applied, a truthy
    string, so the height is parsed as a number rather than tested for presence.
    """
    raw = payload.get("height") if isinstance(payload, dict) else None
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"applied_plan height is a boolean: {raw!r}")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(f"applied_plan height is not an integer: {raw!r}") from None
    raise ValueError(f"applied_plan height is not an integer: {raw!r}")


def upgrade_applied_height(
    rest: _RestGet, upgrade: str, *, cache_key: str | None = None, fresh: bool = False
) -> int:
    """The height at which ``upgrade`` was applied, or ``0`` if it has not been.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    :param cache_key: Identifies the network for the cache (its REST URL).
        Without one nothing is cached.
    :param fresh: Ignore the cache and ask the node.
    :raises Exception: When the node cannot be asked. Do not read a failure as
        "not applied": that guess sends the old wire format to an upgraded
        network, or the new one to an old network, and both are refused.
    """
    key = (cache_key, upgrade) if cache_key else None
    if key and not fresh and key in _cache:
        height, at = _cache[key]
        if height > 0 or time.monotonic() - at < NOT_APPLIED_TTL_S:
            return height
    height = parse_applied_height(rest.get(applied_plan_path(upgrade)))
    if key:
        _cache[key] = (height, time.monotonic())
    return height


def is_upgrade_applied(
    rest: _RestGet, upgrade: str, *, cache_key: str | None = None, fresh: bool = False
) -> bool:
    """Whether the network has applied ``upgrade``. Raises when it cannot be asked."""
    return upgrade_applied_height(rest, upgrade, cache_key=cache_key, fresh=fresh) > 0


def require_upgrade_applied(
    rest: _RestGet, upgrade: str, what: str, *, cache_key: str | None = None
) -> None:
    """Refuse to set ``what`` (a release's new fields) on a network below ``upgrade``.

    :raises ValueError: When the network has not applied ``upgrade``.
    """
    if not is_upgrade_applied(rest, upgrade, cache_key=cache_key):
        raise ValueError(
            f"{what} needs chain {upgrade}, which this network has not applied yet. "
            f"A node below {upgrade} refuses the whole transaction when the field is "
            "set; leave it unset until the upgrade."
        )


def clear_upgrade_cache() -> None:
    """Forget cached answers. For tests and for clients that switch networks."""
    _cache.clear()
