"""AI pre-flight bindings for QoreChain's EVM precompiles.

QoreChain's EVM Engine exposes on-chain risk/anomaly intelligence through two
fixed-address precompiles, callable like any view function via ``eth_call``:

- ``aiRiskScore(bytes) returns (uint256 score, uint8 level)`` at
  :data:`PRECOMPILE_AI_RISK_SCORE` — a model-driven risk score for raw
  transaction calldata.
- ``aiAnomalyCheck(address,uint256) returns (uint256 anomalyScore, bool flagged)``
  at :data:`PRECOMPILE_AI_ANOMALY_CHECK` — whether a ``(sender, amount)`` pair is
  anomalous.

This module ABI-encodes the calldata by hand (no web3 dependency): the 4-byte
selector is ``keccak256(signature)[:4]`` (reusing :func:`qorsdk.utils.keccak256`),
and the two return words are sliced from the 32-byte-aligned result. The helpers
take the EVM JSON-RPC client (:class:`~qorsdk.qor.QorClient`, which exposes
``eth_call``/``eth_estimateGas``) and are also surfaced as methods on it.

Availability note: on a default or community node these precompiles may return a
"not available" error; they are available on QoreChain network nodes. The
:func:`simulate_with_risk_score` ``safe`` verdict is ADVISORY — it summarizes the
advice (``level < 3`` and not ``flagged``) but does not gate or alter the
transaction; the caller decides whether to proceed.
"""

from __future__ import annotations

from typing import Any, Protocol

from .utils import keccak256

#: ``aiRiskScore(bytes)`` precompile address (20 bytes, zero-padded).
PRECOMPILE_AI_RISK_SCORE = "0x0000000000000000000000000000000000000B01"
#: ``aiAnomalyCheck(address,uint256)`` precompile address (20 bytes, zero-padded).
PRECOMPILE_AI_ANOMALY_CHECK = "0x0000000000000000000000000000000000000B02"

#: The exact Solidity function signatures the selectors are derived from.
_SIG_AI_RISK_SCORE = "aiRiskScore(bytes)"
_SIG_AI_ANOMALY_CHECK = "aiAnomalyCheck(address,uint256)"

_WORD = 32


class _EthCaller(Protocol):
    """The EVM JSON-RPC surface these helpers need (``QorClient`` satisfies it)."""

    def call(self, method: str, params: list[Any] | None = ...) -> Any: ...


def _strip_0x(value: str) -> str:
    return value[2:] if value.startswith(("0x", "0X")) else value


def selector(signature: str) -> bytes:
    """The 4-byte function selector: ``keccak256(signature)[:4]``."""
    return keccak256(signature)[:4]


def _encode_uint(value: int) -> bytes:
    """A non-negative integer as a 32-byte left-padded big-endian word."""
    if value < 0:
        raise ValueError("cannot ABI-encode a negative integer")
    return int(value).to_bytes(_WORD, "big")


def _encode_address(address: str) -> bytes:
    """A 20-byte hex address as a 32-byte left-padded word."""
    raw = bytes.fromhex(_strip_0x(address))
    if len(raw) != 20:
        raise ValueError(f"expected a 20-byte address, got {len(raw)} bytes")
    return raw.rjust(_WORD, b"\x00")


def _encode_bytes_arg(data: bytes) -> bytes:
    """ABI-encode a single dynamic ``bytes`` argument (head + tail).

    Layout: a 32-byte head offset (``0x20``), then the 32-byte length, then the
    payload right-padded to a 32-byte boundary.
    """
    length = _encode_uint(len(data))
    pad = (-len(data)) % _WORD
    body = data + b"\x00" * pad
    head_offset = _encode_uint(_WORD)
    return head_offset + length + body


def encode_ai_risk_score(tx_data: bytes) -> str:
    """Calldata for ``aiRiskScore(bytes)`` as a ``0x``-prefixed hex string."""
    return "0x" + (selector(_SIG_AI_RISK_SCORE) + _encode_bytes_arg(tx_data)).hex()


def encode_ai_anomaly_check(sender: str, amount: int) -> str:
    """Calldata for ``aiAnomalyCheck(address,uint256)`` as a hex string."""
    calldata = (
        selector(_SIG_AI_ANOMALY_CHECK)
        + _encode_address(sender)
        + _encode_uint(amount)
    )
    return "0x" + calldata.hex()


def _result_words(result: str, count: int) -> list[int]:
    """Slice an ``eth_call`` hex result into ``count`` 32-byte words as ints."""
    raw = bytes.fromhex(_strip_0x(result))
    if len(raw) < count * _WORD:
        raise ValueError(
            f"eth_call returned {len(raw)} bytes; expected at least "
            f"{count * _WORD} ({count} words)"
        )
    return [
        int.from_bytes(raw[i * _WORD : (i + 1) * _WORD], "big") for i in range(count)
    ]


def _eth_call(client: _EthCaller, to: str, data: str) -> str:
    result = client.call("eth_call", [{"to": to, "data": data}, "latest"])
    return result if isinstance(result, str) else "0x"


def ai_risk_score(client: _EthCaller, tx_data: bytes) -> dict[str, int]:
    """Compute an on-chain risk score for raw transaction calldata.

    :returns: ``{"score": int, "level": int}`` (``level`` is the low byte of the
        second return word).
    """
    result = _eth_call(client, PRECOMPILE_AI_RISK_SCORE, encode_ai_risk_score(tx_data))
    score, level = _result_words(result, 2)
    return {"score": score, "level": level & 0xFF}


def ai_anomaly_check(client: _EthCaller, sender: str, amount: int) -> dict[str, Any]:
    """Check whether a ``(sender, amount)`` pair is anomalous.

    :returns: ``{"anomaly_score": int, "flagged": bool}``.
    """
    result = _eth_call(
        client, PRECOMPILE_AI_ANOMALY_CHECK, encode_ai_anomaly_check(sender, amount)
    )
    anomaly_score, flagged = _result_words(result, 2)
    return {"anomaly_score": anomaly_score, "flagged": bool(flagged)}


def simulate_with_risk_score(client: _EthCaller, tx: dict[str, Any]) -> dict[str, Any]:
    """Pre-flight a transaction: estimate gas plus AI risk and anomaly checks.

    Runs three reads against the node:

    - ``eth_estimateGas`` for the transaction.
    - :func:`ai_risk_score` over the tx ``data`` (empty when absent).
    - :func:`ai_anomaly_check` over ``(from, value)``.

    :param tx: ``{"from", "to"?, "data"?, "value"?}``. ``value`` may be an int or
        a hex string; ``data`` is a ``0x``-prefixed hex string.
    :returns: ``{"gas": int, "risk": {...}, "anomaly": {...}, "safe": bool}``.

    The ``safe`` flag (``risk.level < 3`` and not ``anomaly.flagged``) is
    ADVISORY: it summarizes the AI advice and never blocks or mutates the tx.
    """
    sender = tx["from"]
    data_hex = tx.get("data") or "0x"
    value = tx.get("value", 0)
    amount = int(value, 16) if isinstance(value, str) else int(value)

    call_obj = {k: tx[k] for k in ("from", "to", "data", "value") if tx.get(k) is not None}
    gas_hex = client.call("eth_estimateGas", [call_obj])
    gas = int(gas_hex, 16) if isinstance(gas_hex, str) else int(gas_hex)

    tx_data = bytes.fromhex(_strip_0x(data_hex)) if data_hex != "0x" else b""
    risk = ai_risk_score(client, tx_data)
    anomaly = ai_anomaly_check(client, sender, amount)
    safe = risk["level"] < 3 and not anomaly["flagged"]
    return {"gas": gas, "risk": risk, "anomaly": anomaly, "safe": safe}


__all__ = [
    "PRECOMPILE_AI_RISK_SCORE",
    "PRECOMPILE_AI_ANOMALY_CHECK",
    "selector",
    "encode_ai_risk_score",
    "encode_ai_anomaly_check",
    "ai_risk_score",
    "ai_anomaly_check",
    "simulate_with_risk_score",
]
