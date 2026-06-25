"""Tests for block/tx search REST path building and events query builder."""

from __future__ import annotations

import httpx
import pytest
import respx

from qorechain import (
    RestClient,
    build_events_query,
    get_block,
    get_latest_block,
    get_tx,
    search_txs,
)

BASE = "http://localhost:1317"


def test_build_events_query_quotes_strings_and_bare_ints():
    q = build_events_query({"message.sender": "qor1abc", "tx.height": 42})
    assert q == "message.sender='qor1abc'&tx.height=42"


def test_build_events_query_rejects_bool():
    with pytest.raises(TypeError):
        build_events_query({"k": True})


@respx.mock
def test_get_tx_hits_path():
    route = respx.get(f"{BASE}/cosmos/tx/v1beta1/txs/ABCD").mock(
        return_value=httpx.Response(200, json={"ok": 1})
    )
    rest = RestClient(BASE)
    assert get_tx(rest, "ABCD") == {"ok": 1}
    rest.close()
    assert route.called


@respx.mock
def test_get_block_by_height():
    route = respx.get(
        f"{BASE}/cosmos/base/tendermint/v1beta1/blocks/100"
    ).mock(return_value=httpx.Response(200, json={"h": 100}))
    rest = RestClient(BASE)
    assert get_block(rest, 100) == {"h": 100}
    rest.close()
    assert route.called


@respx.mock
def test_get_latest_block():
    route = respx.get(
        f"{BASE}/cosmos/base/tendermint/v1beta1/blocks/latest"
    ).mock(return_value=httpx.Response(200, json={"latest": True}))
    rest = RestClient(BASE)
    assert get_latest_block(rest) == {"latest": True}
    rest.close()
    assert route.called


@respx.mock
def test_search_txs_builds_events_and_pagination():
    route = respx.get(f"{BASE}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"txs": []})
    )
    rest = RestClient(BASE)
    search_txs(
        rest, {"message.sender": "qor1abc"}, page=2, limit=10, order_by="desc"
    )
    rest.close()
    req = route.calls.last.request
    assert req.url.params.get("events") == "message.sender='qor1abc'"
    assert req.url.params.get("pagination.limit") == "10"
    assert req.url.params.get("order_by") == "ORDER_BY_DESC"
    assert req.url.params.get("page") == "2"


@respx.mock
def test_search_txs_accepts_raw_query_string():
    route = respx.get(f"{BASE}/cosmos/tx/v1beta1/txs").mock(
        return_value=httpx.Response(200, json={"txs": []})
    )
    rest = RestClient(BASE)
    search_txs(rest, "message.action='swap'")
    rest.close()
    assert route.calls.last.request.url.params.get("events") == "message.action='swap'"
