"""Generic JSON-RPC 2.0 clients (sync + async).

Manage request ids (auto-incrementing per client), serialize the standard
``{"jsonrpc", "id", "method", "params"}`` envelope, and map JSON-RPC error
responses to a typed :class:`JsonRpcError`. These are the transport base for the
QoreChain ``qor_*`` namespace and any EVM ``eth_*`` methods.
"""

from __future__ import annotations

from typing import Any

import httpx

from .rest import QoreHttpError

_DEFAULT_TIMEOUT = 30.0


class JsonRpcError(Exception):
    """Raised when a JSON-RPC response carries an ``error`` member."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


def _build_body(next_id: int, method: str, params: list[Any] | None) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": next_id, "method": method, "params": params or []}


def _parse_response(resp: httpx.Response, url: str) -> Any:
    if resp.status_code < 200 or resp.status_code >= 300:
        raise QoreHttpError(resp.status_code, url, resp.text)
    payload = resp.json()
    err = payload.get("error")
    if err:
        raise JsonRpcError(err.get("code", 0), err.get("message", ""), err.get("data"))
    return payload.get("result")


class JsonRpcClient:
    """A minimal synchronous JSON-RPC 2.0 client over HTTP POST."""

    def __init__(
        self,
        url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.url = url
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=timeout, headers=headers)
        self._next_id = 1

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> JsonRpcClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def call(self, method: str, params: list[Any] | None = None) -> Any:
        """Invoke a JSON-RPC method and return its ``result``.

        :raises JsonRpcError: When the response contains an ``error``.
        :raises QoreHttpError: On a non-2xx transport response.
        """
        body = _build_body(self._next_id, method, params)
        self._next_id += 1
        resp = self._client.post(self.url, json=body)
        return _parse_response(resp, self.url)


class AsyncJsonRpcClient:
    """Asynchronous mirror of :class:`JsonRpcClient`."""

    def __init__(
        self,
        url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
        client: httpx.AsyncClient | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.url = url
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout, headers=headers)
        self._next_id = 1

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> AsyncJsonRpcClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def call(self, method: str, params: list[Any] | None = None) -> Any:
        """Invoke a JSON-RPC method and return its ``result``."""
        body = _build_body(self._next_id, method, params)
        self._next_id += 1
        resp = await self._client.post(self.url, json=body)
        return _parse_response(resp, self.url)
