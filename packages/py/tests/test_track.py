"""Tests for tx tracking (wait_for_tx, broadcast_and_wait, with_retry)."""

from __future__ import annotations

import pytest

from qorsdk import (
    QoreHttpError,
    QoreTxError,
    broadcast_and_wait,
    wait_for_tx,
    with_retry,
)


def test_wait_for_tx_returns_on_success():
    calls = {"n": 0}

    def fetcher(_hash):
        calls["n"] += 1
        if calls["n"] < 3:
            raise QoreHttpError(404, "url", "tx not found")
        return {
            "tx_response": {
                "txhash": "HASH",
                "height": "42",
                "code": 0,
                "gas_used": "90000",
                "gas_wanted": "100000",
                "raw_log": "",
            }
        }

    included = wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01)
    assert included.height == 42
    assert included.code == 0
    assert included.gas_used == 90000
    assert calls["n"] == 3


def test_wait_for_tx_raises_qore_tx_error_on_nonzero_code():
    def fetcher(_hash):
        return {
            "tx_response": {
                "txhash": "HASH",
                "height": "10",
                "code": 5,
                "codespace": "sdk",
                "raw_log": "insufficient funds",
            }
        }

    with pytest.raises(QoreTxError) as exc:
        wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01)
    assert exc.value.code == 5
    assert exc.value.kind == "insufficient_funds"


def test_wait_for_tx_times_out():
    def fetcher(_hash):
        raise QoreHttpError(404, "url", "not found")

    with pytest.raises(TimeoutError):
        wait_for_tx(fetcher, "HASH", timeout=0.05, poll_interval=0.02)


def test_wait_for_tx_propagates_non_404_errors():
    def fetcher(_hash):
        raise QoreHttpError(500, "url", "boom")

    with pytest.raises(QoreHttpError):
        wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01)


def test_broadcast_and_wait_chains():
    def broadcaster():
        return "HASH"

    def fetcher(_hash):
        return {"tx_response": {"txhash": "HASH", "height": "1", "code": 0}}

    included = broadcast_and_wait(broadcaster, fetcher, timeout=5, poll_interval=0.01)
    assert included.tx_hash == "HASH"


def test_with_retry_succeeds_after_failures():
    attempts = {"n": 0}

    def fn(_attempt):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("transient")
        return "ok"

    assert with_retry(fn, retries=5, backoff=0.0) == "ok"
    assert attempts["n"] == 3


def test_with_retry_gives_up_and_raises_last():
    def fn(_attempt):
        raise RuntimeError("always")

    with pytest.raises(RuntimeError, match="always"):
        with_retry(fn, retries=2, backoff=0.0)


def test_with_retry_respects_should_retry_predicate():
    attempts = {"n": 0}

    def fn(_attempt):
        attempts["n"] += 1
        raise ValueError("fatal")

    with pytest.raises(ValueError):
        with_retry(fn, retries=5, backoff=0.0, should_retry=lambda _e, _a: False)
    assert attempts["n"] == 1


@pytest.mark.parametrize(
    "answer",
    [
        {},
        {"tx_response": None},
        {"tx_response": {}},
        {"tx_response": {"height": "5", "code": 0}},
        {"tx_response": {"txhash": "", "height": "5", "code": 0}},
        {"tx_response": "HASH"},
    ],
)
def test_wait_for_tx_needs_tx_response_and_txhash(answer):
    # An answer without a tx_response carrying a txhash is not an inclusion.
    with pytest.raises(TimeoutError):
        wait_for_tx(lambda _h: answer, "HASH", timeout=0.05, poll_interval=0.02)


@pytest.mark.parametrize("code", ["abc", "1.0", 1.0, 0.0, True, False, -1, "", [0], {}])
def test_wait_for_tx_treats_a_non_integer_code_as_an_error(code):
    def fetcher(_hash):
        return {"tx_response": {"txhash": "HASH", "height": "3", "code": code}}

    with pytest.raises(QoreTxError) as exc:
        wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01)
    assert exc.value.kind == "unreadable_code"
    assert exc.value.tx_hash == "HASH"


def test_wait_for_tx_reads_an_absent_code_as_zero():
    def fetcher(_hash):
        return {"tx_response": {"txhash": "HASH", "height": "3"}}

    assert wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01).code == 0


def test_wait_for_tx_accepts_a_string_code():
    def fetcher(_hash):
        return {"tx_response": {"txhash": "HASH", "height": "3", "code": "5", "codespace": "sdk"}}

    with pytest.raises(QoreTxError) as exc:
        wait_for_tx(fetcher, "HASH", timeout=5, poll_interval=0.01)
    assert exc.value.code == 5
