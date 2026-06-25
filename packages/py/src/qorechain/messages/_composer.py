"""The composer primitive shared by every message builder.

A *composer* binds a fixed ``type_url`` to a generated protobuf ``Msg*`` class
and returns a callable that builds that message from keyword arguments (the
proto's snake_case field names) into a :class:`Msg` — a ``{type_url, value}``
pair where ``value`` is a populated protobuf message instance.

The :class:`Msg` shape is exactly what :func:`qorechain.tx.send_messages` and
the hybrid PQC tx path consume: it packs ``value`` into a Cosmos ``Any`` under
``type_url``. This mirrors the TypeScript SDK's ``{ typeUrl, value }``
``EncodeObject`` so the two SDKs compose transactions identically.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


class _ProtoMessage(Protocol):
    """The structural surface a generated protobuf message exposes."""

    def SerializeToString(self) -> bytes: ...


@dataclass(frozen=True)
class Msg:
    """A transaction message: a ``type_url`` plus a populated protobuf ``value``.

    Ready to pass (in a list) to :func:`qorechain.tx.send_messages` /
    :func:`qorechain.tx.build_hybrid_tx`, which pack ``value`` into a Cosmos
    ``Any`` under ``type_url``.
    """

    #: The canonical on-chain message identifier, e.g.
    #: ``/qorechain.amm.v1.MsgSwapExactIn``.
    type_url: str
    #: The populated protobuf message instance.
    value: _ProtoMessage


def composer(type_url: str, msg_cls: Callable[..., Any]) -> Callable[..., Msg]:
    """Build a composer bound to a fixed ``type_url`` and protobuf class.

    The returned callable accepts the message's fields as keyword arguments
    (proto snake_case names) and returns a :class:`Msg`. Field validation and
    defaults are delegated to the generated protobuf constructor, so an unknown
    field raises and omitted fields take their proto3 defaults.

    :param type_url: The canonical on-chain ``/package.Msg*`` identifier.
    :param msg_cls: The generated ``Msg*`` protobuf class to instantiate.
    """

    def build(**fields: Any) -> Msg:
        return Msg(type_url=type_url, value=msg_cls(**fields))

    build.__name__ = msg_cls.__name__
    build.__qualname__ = msg_cls.__name__
    return build
