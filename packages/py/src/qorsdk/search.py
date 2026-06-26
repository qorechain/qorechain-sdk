"""Block and transaction lookup/search over the Cosmos REST (LCD) endpoints.

Wraps the standard ``/cosmos/tx/v1beta1`` and consensus block routes: fetch a
single transaction by hash, fetch a block by height (or the latest), and search
transactions by an events query. :func:`build_events_query` turns an attribute
map (e.g. ``{"message.sender": addr}``) into the ``events=...`` parameter the
REST API expects.

Responses are returned as the decoded JSON (the gateway JSON is large and
version-sensitive); the helpers cover path/param building.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from .rest import RestClient

#: Ordering for tx search.
TxOrderBy = Literal["asc", "desc"]


def build_events_query(filters: dict[str, str | int]) -> str:
    """Build the ``events`` query value for the REST tx-search endpoint.

    Each ``key=value`` pair is rendered as ``key='value'`` (integers unquoted)
    and joined with ``&`` — the format ``/cosmos/tx/v1beta1/txs?events=...``
    expects.

    :example: ``build_events_query({"message.sender": "qor1..."})`` →
        ``"message.sender='qor1...'"``
    """
    parts = []
    for key, value in filters.items():
        if isinstance(value, bool):
            raise TypeError("event filter values must be str or int, not bool")
        rendered = f"{value}" if isinstance(value, int) else f"'{value}'"
        parts.append(f"{key}={rendered}")
    return "&".join(parts)


def _order_by_param(order_by: TxOrderBy | None) -> str | None:
    if order_by == "asc":
        return "ORDER_BY_ASC"
    if order_by == "desc":
        return "ORDER_BY_DESC"
    return None


def get_tx(rest: RestClient, tx_hash: str) -> Any:
    """Fetch a single transaction by its (hex) hash."""
    return rest.get(f"/cosmos/tx/v1beta1/txs/{quote(tx_hash, safe='')}")


def get_block(rest: RestClient, height: int | str) -> Any:
    """Fetch a block by height."""
    return rest.get(
        f"/cosmos/base/tendermint/v1beta1/blocks/{quote(str(height), safe='')}"
    )


def get_latest_block(rest: RestClient) -> Any:
    """Fetch the latest block."""
    return rest.get("/cosmos/base/tendermint/v1beta1/blocks/latest")


def search_txs(
    rest: RestClient,
    query: str | dict[str, str | int],
    *,
    page: int | None = None,
    limit: int | None = None,
    order_by: TxOrderBy | None = None,
) -> Any:
    """Search transactions by an events query.

    :param query: An ``events`` query string (see :func:`build_events_query`) or
        an attribute-filter dict passed through it.
    :param page: 1-based page number.
    :param limit: Page size.
    :param order_by: Result ordering by block height.
    """
    events = query if isinstance(query, str) else build_events_query(query)
    params: dict[str, Any] = {
        "events": events,
        "pagination.limit": limit,
        "order_by": _order_by_param(order_by),
    }
    if page is not None:
        params["page"] = page
    return rest.get("/cosmos/tx/v1beta1/txs", params)
