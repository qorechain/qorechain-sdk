"""REST (LCD) read clients for QoreChain (sync + async).

Wraps the standard Cosmos SDK bank endpoints plus QoreChain's custom module read
routes under ``/qorechain/<module>/v1/...``. Both :class:`RestClient` and
:class:`AsyncRestClient` share the same path-building logic; only the transport
(``httpx.Client`` vs ``httpx.AsyncClient``) differs.

Failures surface as :class:`QoreHttpError` on non-2xx responses.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

import httpx

#: Relative urgency of a fee estimate.
FeeUrgency = Literal["fast", "normal", "slow"]

_DEFAULT_TIMEOUT = 30.0


class QoreHttpError(Exception):
    """Raised when an HTTP response has a non-2xx status."""

    def __init__(self, status: int, url: str, body: str | None = None) -> None:
        super().__init__(f"HTTP {status} for {url}")
        self.status = status
        self.url = url
        self.body = body


def _join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def _clean_params(params: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop ``None`` values so they are not serialized into the query string."""
    if not params:
        return None
    cleaned = {k: v for k, v in params.items() if v is not None}
    return cleaned or None


class _RestPaths:
    """Shared path/param builders for the REST clients.

    Each builder returns a ``(path, params)`` pair so the sync and async clients
    issue identical requests.
    """

    @staticmethod
    def all_balances(address: str) -> tuple[str, dict[str, Any] | None]:
        return f"/cosmos/bank/v1beta1/balances/{quote(address, safe='')}", None

    @staticmethod
    def ai_stats() -> tuple[str, dict[str, Any] | None]:
        return "/qorechain/ai/v1/stats", None

    @staticmethod
    def fee_estimate(urgency: FeeUrgency) -> tuple[str, dict[str, Any] | None]:
        return "/qorechain/ai/v1/fee-estimate", {"urgency": urgency}

    @staticmethod
    def bridge_chains() -> tuple[str, dict[str, Any] | None]:
        return "/qorechain/bridge/v1/chains", None

    @staticmethod
    def pqc_account(address: str) -> tuple[str, dict[str, Any] | None]:
        return f"/qorechain/pqc/v1/accounts/{quote(address, safe='')}", None

    @staticmethod
    def reputation(validator_address: str) -> tuple[str, dict[str, Any] | None]:
        return (
            f"/qorechain/reputation/v1/validators/{quote(validator_address, safe='')}",
            None,
        )

    @staticmethod
    def burn_stats() -> tuple[str, dict[str, Any] | None]:
        return "/qorechain/burn/v1/stats", None

    @staticmethod
    def xqore_position(address: str) -> tuple[str, dict[str, Any] | None]:
        return f"/qorechain/xqore/v1/position/{quote(address, safe='')}", None

    @staticmethod
    def inflation_rate() -> tuple[str, dict[str, Any] | None]:
        return "/qorechain/inflation/v1/rate", None


class RestClient:
    """Synchronous Cosmos + QoreChain REST read client."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=timeout, headers=headers)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> RestClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """Generic GET escape hatch for any documented REST route."""
        url = _join_url(self.base_url, path)
        resp = self._client.get(url, params=_clean_params(params))
        if resp.status_code < 200 or resp.status_code >= 300:
            raise QoreHttpError(resp.status_code, url, resp.text)
        return resp.json()

    def _get_built(self, built: tuple[str, dict[str, Any] | None]) -> Any:
        path, params = built
        return self.get(path, params)

    # --- Standard Cosmos bank ---
    def get_all_balances(self, address: str) -> Any:
        return self._get_built(_RestPaths.all_balances(address))

    # --- Custom QoreChain module reads ---
    def get_ai_stats(self) -> Any:
        return self._get_built(_RestPaths.ai_stats())

    def get_fee_estimate(self, urgency: FeeUrgency) -> Any:
        return self._get_built(_RestPaths.fee_estimate(urgency))

    def get_bridge_chains(self) -> Any:
        return self._get_built(_RestPaths.bridge_chains())

    def get_pqc_account(self, address: str) -> Any:
        return self._get_built(_RestPaths.pqc_account(address))

    def get_reputation(self, validator_address: str) -> Any:
        return self._get_built(_RestPaths.reputation(validator_address))

    def get_burn_stats(self) -> Any:
        return self._get_built(_RestPaths.burn_stats())

    def get_xqore_position(self, address: str) -> Any:
        return self._get_built(_RestPaths.xqore_position(address))

    def get_inflation_rate(self) -> Any:
        return self._get_built(_RestPaths.inflation_rate())


class AsyncRestClient:
    """Asynchronous mirror of :class:`RestClient`."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
        client: httpx.AsyncClient | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout, headers=headers)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> AsyncRestClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """Generic GET escape hatch for any documented REST route."""
        url = _join_url(self.base_url, path)
        resp = await self._client.get(url, params=_clean_params(params))
        if resp.status_code < 200 or resp.status_code >= 300:
            raise QoreHttpError(resp.status_code, url, resp.text)
        return resp.json()

    async def _get_built(self, built: tuple[str, dict[str, Any] | None]) -> Any:
        path, params = built
        return await self.get(path, params)

    async def get_all_balances(self, address: str) -> Any:
        return await self._get_built(_RestPaths.all_balances(address))

    async def get_ai_stats(self) -> Any:
        return await self._get_built(_RestPaths.ai_stats())

    async def get_fee_estimate(self, urgency: FeeUrgency) -> Any:
        return await self._get_built(_RestPaths.fee_estimate(urgency))

    async def get_bridge_chains(self) -> Any:
        return await self._get_built(_RestPaths.bridge_chains())

    async def get_pqc_account(self, address: str) -> Any:
        return await self._get_built(_RestPaths.pqc_account(address))

    async def get_reputation(self, validator_address: str) -> Any:
        return await self._get_built(_RestPaths.reputation(validator_address))

    async def get_burn_stats(self) -> Any:
        return await self._get_built(_RestPaths.burn_stats())

    async def get_xqore_position(self, address: str) -> Any:
        return await self._get_built(_RestPaths.xqore_position(address))

    async def get_inflation_rate(self) -> Any:
        return await self._get_built(_RestPaths.inflation_rate())
