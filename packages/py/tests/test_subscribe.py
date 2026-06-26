"""Tests for the websocket subscription client (mocked connection)."""

from __future__ import annotations

import asyncio
import json

import pytest

from qorsdk import SubscriptionClient, build_tx_query


def test_build_tx_query():
    assert build_tx_query() == "tm.event='Tx'"
    assert build_tx_query({"message.sender": "qor1abc"}) == (
        "tm.event='Tx' AND message.sender='qor1abc'"
    )
    assert build_tx_query({"tx.height": 5}) == "tm.event='Tx' AND tx.height=5"


class FakeWs:
    """A fake websocket: records sends and replays queued inbound frames."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self._inbound: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False

    async def send(self, message: str) -> None:
        self.sent.append(json.loads(message))

    async def recv(self) -> str:
        return await self._inbound.get()

    async def close(self) -> None:
        self.closed = True

    def push(self, frame: dict) -> None:
        self._inbound.put_nowait(json.dumps(frame))


@pytest.mark.asyncio
async def test_subscribe_new_blocks_registers_and_dispatches():
    ws = FakeWs()
    client = SubscriptionClient(ws)
    received: list[dict] = []

    async def handler(event):
        received.append(event)

    unsubscribe = await client.subscribe_new_blocks(handler)

    # The subscribe request was sent with the NewBlock query.
    assert ws.sent[0]["method"] == "subscribe"
    assert ws.sent[0]["params"]["query"] == "tm.event='NewBlock'"
    sub_id = ws.sent[0]["id"]

    # Push a matching event; the read loop should dispatch it.
    ws.push({"id": sub_id, "result": {"data": {"value": {"block": {}}}}})
    await asyncio.sleep(0.05)
    assert len(received) == 1

    # Unsubscribe sends the unsubscribe frame and drops the handler.
    await unsubscribe()
    assert ws.sent[-1]["method"] == "unsubscribe"

    await client.close()
    assert ws.closed is True


@pytest.mark.asyncio
async def test_subscribe_tx_builds_query_from_filters():
    ws = FakeWs()
    client = SubscriptionClient(ws)

    async def handler(_event):
        pass

    await client.subscribe_tx({"message.sender": "qor1abc"}, handler)
    assert ws.sent[0]["params"]["query"] == (
        "tm.event='Tx' AND message.sender='qor1abc'"
    )
    await client.close()
