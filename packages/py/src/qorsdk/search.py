"""Block and transaction lookup/search over the Native REST (LCD) endpoints.

Wraps the standard ``/cosmos/tx/v1beta1`` and consensus block routes: fetch a
single transaction by hash, fetch a block by height (or the latest), and search
transactions by an events query. :func:`build_events_query` turns an attribute
map (e.g. ``{"message.sender": addr}``) into the ``query=...`` parameter the
REST API expects (Cosmos SDK v0.53: predicates joined with ``" AND "``; the old
``events`` parameter is no longer read).

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
    """Build the ``query`` value for the REST tx-search endpoint.

    Each ``key=value`` pair is rendered as ``key='value'`` (integers unquoted)
    and the predicates are joined with ``" AND "`` - the format
    ``/cosmos/tx/v1beta1/txs?query=...`` expects on Cosmos SDK v0.53.

    :example: ``build_events_query({"message.sender": "qor1...", "tx.height": 5})``
        → ``"message.sender='qor1...' AND tx.height=5"``
    """
    parts = []
    for key, value in filters.items():
        if isinstance(value, bool):
            raise TypeError("event filter values must be str or int, not bool")
        rendered = f"{value}" if isinstance(value, int) else f"'{value}'"
        parts.append(f"{key}={rendered}")
    return " AND ".join(parts)


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

    :param query: A tx-search query string (predicates joined with ``" AND "``,
        see :func:`build_events_query`) or an attribute-filter dict passed
        through it. Sent as the ``query`` parameter.
    :param page: 1-based page number.
    :param limit: Page size, sent as ``limit`` (the endpoint ignores
        ``pagination.*``).
    :param order_by: Result ordering by block height.
    """
    q = query if isinstance(query, str) else build_events_query(query)
    params: dict[str, Any] = {
        "query": q,
        "limit": limit,
        "order_by": _order_by_param(order_by),
    }
    if page is not None:
        params["page"] = page
    return rest.get("/cosmos/tx/v1beta1/txs", params)
