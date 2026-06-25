"""Real-time event subscriptions over the chain's consensus RPC websocket.

The consensus RPC exposes a JSON-RPC ``subscribe`` method over a websocket at
``<rpc>/websocket``. :class:`SubscriptionClient` opens one connection, sends
``subscribe`` requests with a query (e.g. ``tm.event='NewBlock'`` or
``tm.event='Tx' AND ...``), and dispatches each pushed event to the registered
async handler. :meth:`subscribe_new_blocks` and :meth:`subscribe_tx` each return
an unsubscribe coroutine; the client is also an async context manager.

The transport is :mod:`websockets`; unit tests inject a fake connection so no
socket is opened.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import websockets

#: An async handler invoked for each emitted event value.
Handler = Callable[[Any], Awaitable[None]]
#: An awaitable that tears down a single subscription.
Unsubscribe = Callable[[], Awaitable[None]]


class _WsConnection(Protocol):
    """The subset of a websocket connection the client uses (for test fakes)."""

    async def send(self, message: str) -> None: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> None: ...


def _ws_url(rpc_url: str) -> str:
    """Derive the ``/websocket`` URL from an ``http(s)``/``ws(s)`` RPC endpoint."""
    url = rpc_url.rstrip("/")
    if url.startswith("http://"):
        url = "ws://" + url[len("http://") :]
    elif url.startswith("https://"):
        url = "wss://" + url[len("https://") :]
    if not url.endswith("/websocket"):
        url = f"{url}/websocket"
    return url


def build_tx_query(filters: dict[str, str | int] | None = None) -> str:
    """Build a consensus-RPC subscription query string for transaction events.

    Always includes ``tm.event='Tx'`` and ANDs in each attribute filter. String
    values are single-quoted; integers are emitted bare.

    :example: ``build_tx_query({"message.sender": "qor1..."})`` →
        ``"tm.event='Tx' AND message.sender='qor1...'"``
    """
    parts = ["tm.event='Tx'"]
    for key, value in (filters or {}).items():
        if isinstance(value, bool):
            raise TypeError("tx query filter values must be str or int, not bool")
        rendered = f"{value}" if isinstance(value, int) else f"'{value}'"
        parts.append(f"{key}={rendered}")
    return " AND ".join(parts)


class SubscriptionClient:
    """A websocket client for chain RPC event subscriptions.

    Open with :meth:`connect` (or use as an async context manager). Each
    ``subscribe_*`` call registers a query and returns an unsubscribe coroutine.
    Events are dispatched by a background read loop started on first subscribe.
    """

    def __init__(self, connection: _WsConnection) -> None:
        self._conn = connection
        self._next_id = 0
        #: Active handlers keyed by JSON-RPC subscription id.
        self._handlers: dict[int, Handler] = {}
        self._reader: Any = None

    @classmethod
    async def connect(cls, rpc_url: str) -> SubscriptionClient:
        """Open a websocket to ``<rpc_url>/websocket`` and return a client."""
        conn = await websockets.connect(_ws_url(rpc_url))
        return cls(conn)

    async def __aenter__(self) -> SubscriptionClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    def _ensure_reader(self) -> None:
        if self._reader is None:
            self._reader = asyncio.ensure_future(self._read_loop())

    async def _read_loop(self) -> None:
        """Dispatch each pushed event to its registered handler."""
        try:
            while True:
                raw = await self._conn.recv()
                msg = json.loads(raw)
                sub_id = msg.get("id")
                result = msg.get("result")
                if sub_id in self._handlers and result and result.get("data"):
                    await self._handlers[sub_id](result)
        except Exception:
            # Connection closed or read error — the loop ends; callers that need
            # error visibility can wrap the handler. Swallow on teardown.
            return

    async def _subscribe(self, query: str, handler: Handler) -> Unsubscribe:
        self._next_id += 1
        sub_id = self._next_id
        self._handlers[sub_id] = handler
        request = {
            "jsonrpc": "2.0",
            "method": "subscribe",
            "id": sub_id,
            "params": {"query": query},
        }
        await self._conn.send(json.dumps(request))
        self._ensure_reader()

        async def unsubscribe() -> None:
            self._handlers.pop(sub_id, None)
            await self._conn.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "unsubscribe",
                        "id": sub_id,
                        "params": {"query": query},
                    }
                )
            )

        return unsubscribe

    async def subscribe_new_blocks(self, handler: Handler) -> Unsubscribe:
        """Subscribe to newly committed blocks (``tm.event='NewBlock'``)."""
        return await self._subscribe("tm.event='NewBlock'", handler)

    async def subscribe_tx(
        self, query: str | dict[str, str | int], handler: Handler
    ) -> Unsubscribe:
        """Subscribe to committed transactions matching a query.

        :param query: A query string (see :func:`build_tx_query`) or an
            attribute-filter dict passed through it.
        """
        q = query if isinstance(query, str) else build_tx_query(query)
        return await self._subscribe(q, handler)

    async def close(self) -> None:
        """Cancel the read loop and close the websocket."""
        if self._reader is not None:
            self._reader.cancel()
            self._reader = None
        self._handlers.clear()
        await self._conn.close()
