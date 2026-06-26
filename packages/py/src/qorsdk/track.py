"""Transaction tracking, broadcast-and-wait, and a transient-error retry helper.

After a ``sync``/``async`` broadcast you hold only a tx hash; the tx is in the
mempool but not yet in a block. :func:`wait_for_tx` polls the REST tx endpoint
until the tx is included (or a timeout elapses), decoding the result and raising
a typed :class:`~qorechain.errors.QoreTxError` if it landed with a non-zero code.

:func:`broadcast_and_wait` chains a ``sync`` broadcast with :func:`wait_for_tx`.
:func:`with_retry` retries a callable with exponential backoff — useful for
wrapping flaky read RPC calls.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .errors import tx_error_from
from .rest import QoreHttpError, RestClient
from .search import get_tx

#: A function that fetches a tx by hash; defaults to :func:`~qorechain.search.get_tx`.
GetTxFn = Callable[[str], Any]


@dataclass(frozen=True)
class IncludedTx:
    """The decoded result of an included transaction."""

    #: The transaction hash.
    tx_hash: str
    #: Block height the tx was included in.
    height: int
    #: ABCI result code (``0`` = success).
    code: int
    #: Gas used, when reported.
    gas_used: int | None
    #: Gas wanted, when reported.
    gas_wanted: int | None
    #: Raw ABCI log.
    raw_log: str | None
    #: The full REST response, for callers that need more.
    raw: Any


def _is_not_found(err: Exception) -> bool:
    """A REST "tx not found yet" error is expected while polling."""
    if isinstance(err, QoreHttpError):
        if err.status == 404:
            return True
        body = (err.body or "").lower()
        if "not found" in body or "tx not found" in body or "code = 5" in body:
            return True
    return False


def _to_included_tx(tx_hash: str, res: Any) -> IncludedTx | None:
    """Map a REST tx response into an :class:`IncludedTx`, or ``None`` if pending."""
    r = res.get("tx_response") if isinstance(res, dict) else None
    if not r:
        return None
    return IncludedTx(
        tx_hash=r.get("txhash") or tx_hash,
        height=int(r["height"]) if r.get("height") else 0,
        code=int(r.get("code", 0)),
        gas_used=int(r["gas_used"]) if r.get("gas_used") else None,
        gas_wanted=int(r["gas_wanted"]) if r.get("gas_wanted") else None,
        raw_log=r.get("raw_log"),
        raw=res,
    )


def wait_for_tx(
    fetcher: RestClient | GetTxFn,
    tx_hash: str,
    *,
    timeout: float = 60.0,
    poll_interval: float = 2.0,
) -> IncludedTx:
    """Poll for a transaction until it is included in a block or times out.

    :param fetcher: A :class:`~qorechain.rest.RestClient` (uses
        :func:`~qorechain.search.get_tx`) or a custom ``GetTxFn``.
    :param tx_hash: The transaction hash to wait for.
    :param timeout: Total seconds to wait before giving up.
    :param poll_interval: Seconds between polls.
    :returns: The decoded :class:`IncludedTx` once found.
    :raises QoreTxError: If the tx is included with a non-zero code.
    :raises TimeoutError: If the tx is not included within ``timeout``.
    """
    if isinstance(fetcher, RestClient):
        rest = fetcher
        get: GetTxFn = lambda h: get_tx(rest, h)  # noqa: E731
    else:
        get = fetcher

    deadline = time.monotonic() + timeout
    while True:
        res: Any = None
        try:
            res = get(tx_hash)
        except Exception as err:  # noqa: BLE001 — re-raised unless a benign 404
            if not (isinstance(err, Exception) and _is_not_found(err)):
                raise

        included = _to_included_tx(tx_hash, res) if res is not None else None
        if included is not None:
            if included.code != 0:
                codespace = None
                if isinstance(res, dict):
                    codespace = (res.get("tx_response") or {}).get("codespace")
                raise tx_error_from(
                    included.code,
                    codespace=codespace,
                    raw_log=included.raw_log,
                    tx_hash=included.tx_hash,
                )
            return included

        if time.monotonic() + poll_interval > deadline:
            raise TimeoutError(
                f"timed out after {timeout}s waiting for tx {tx_hash} to be included"
            )
        time.sleep(poll_interval)


#: A broadcaster returning a tx hash.
SyncBroadcaster = Callable[[], str]


def broadcast_and_wait(
    broadcaster: SyncBroadcaster,
    fetcher: RestClient | GetTxFn,
    *,
    timeout: float = 60.0,
    poll_interval: float = 2.0,
) -> IncludedTx:
    """Broadcast (sync) and then wait for inclusion.

    :param broadcaster: A callable that submits the tx and returns its hash.
    :param fetcher: A :class:`~qorechain.rest.RestClient` or ``GetTxFn`` to poll.
    """
    tx_hash = broadcaster()
    return wait_for_tx(
        fetcher, tx_hash, timeout=timeout, poll_interval=poll_interval
    )


def with_retry(
    fn: Callable[[int], Any],
    *,
    retries: int = 3,
    backoff: float = 0.25,
    max_backoff: float = 5.0,
    should_retry: Callable[[Exception, int], bool] | None = None,
) -> Any:
    """Run ``fn``, retrying on failure with exponential backoff.

    :param fn: The operation to run (receives the 0-based attempt number).
    :param retries: Number of retries after the first attempt.
    :param backoff: Initial backoff in seconds (doubled each retry).
    :param max_backoff: Maximum backoff in seconds.
    :param should_retry: Predicate deciding whether an error is retryable;
        defaults to retrying every error.
    :returns: The first successful result.
    :raises Exception: The last error if all attempts fail or ``should_retry``
        returns ``False``.
    """
    predicate = should_retry or (lambda _err, _attempt: True)
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            return fn(attempt)
        except Exception as err:  # noqa: BLE001 — generic retry wrapper
            last_error = err
            if attempt == retries or not predicate(err, attempt):
                raise
            delay = min(backoff * (2**attempt), max_backoff)
            if delay > 0:
                time.sleep(delay)
    assert last_error is not None
    raise last_error
