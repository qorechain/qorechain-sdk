"""Client-side checks for ``MsgUpdateSpendingRules``, run by the
``abstractaccount.update_spending_rules`` composer before anything is signed.

They follow the chain's own ``ValidateBasic`` (limits non-negative, at most
:data:`MAX_DENOM_LIMITS` denom limits and :data:`MAX_ALLOWED_EVM_CALLS`
allowed calls, one limit per denom, amounts as non-negative decimal integers
with ``""`` meaning "no limit of that kind") and refuse two shapes the chain
does not yet:

* an ENABLED rule that bounds nothing. A rule bounds something when it sets a
  rule-level per-tx or daily limit, a denom list, an allowed-call list, or a
  denom limit with a non-zero amount;
* a denom limit with both amounts empty or zero, whatever else the rule sets.
  When a denom has an entry the chain applies only that entry and skips the
  rule-level limits for the denom, so such an entry silently removes every
  limit on it while the rule still reads as limited.

From chain v3.2.5 the chain refuses both shapes itself when a rule is saved
(``abstractaccount`` code 8, "invalid spending rule"), and also an EVM token
denom whose address does not parse: an ``erc20/``, ``erc721/`` or ``erc1155/``
denom (prefix in any case), in ``denom_limits`` or ``allowed_denoms``, must
carry a ``0x``-prefixed 20-byte contract address, and an ``erc20/`` denom is
the address alone (no ``/<token id>`` tail). :func:`validate_evm_denom` is that
check.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from typing import Any

#: At most this many ``denom_limits`` per rule (chain ``MaxDenomLimits``).
MAX_DENOM_LIMITS = 64
#: At most this many ``allowed_evm_calls`` per rule (chain ``MaxAllowedEVMCalls``).
MAX_ALLOWED_EVM_CALLS = 64

_DECIMAL = re.compile(r"[0-9]+")
_EVM_ADDRESS = re.compile(r"0[xX][0-9a-fA-F]{40}")

#: Denom prefixes of EVM tokens in a spending rule.
EVM_DENOM_PREFIXES = ("erc20/", "erc721/", "erc1155/")


def validate_evm_denom(denom: str) -> None:
    """Refuse an EVM token denom whose contract address does not parse
    (chain v3.2.5 ``ValidateEVMDenom``). Other denoms pass.

    :raises ValueError: Naming the denom.
    """
    lower = denom.lower()
    for prefix in EVM_DENOM_PREFIXES:
        if not lower.startswith(prefix):
            continue
        rest = denom[len(prefix):]
        addr, slash, _tail = rest.partition("/")
        if not _EVM_ADDRESS.fullmatch(addr):
            raise ValueError(
                f"denom {_quote(denom)}: {prefix} must be followed by a 0x-prefixed "
                "20-byte contract address"
            )
        if prefix == "erc20/" and slash:
            raise ValueError(
                f"denom {_quote(denom)}: an erc20/ denom is the contract address alone"
            )
        return
_WHITESPACE_OR_CONTROL = re.compile(r"[\x00-\x20\x7f]")


def _field(obj: Any, name: str, default: Any = None) -> Any:
    """A field of a protobuf message or a plain mapping (``None`` when unset)."""
    if obj is None:
        return default
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _quote(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def _rule_limit(v: Any, what: str, i: int) -> int:
    """A rule-level limit as an int; raises on anything that is not an integer."""
    if v is None or v == "":
        return 0
    if isinstance(v, bool):
        raise ValueError(f"spending rule {i}: {what} {_quote(str(v))} is not an integer")
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"spending rule {i}: {what} {_quote(str(v))} is not an integer") from None
    if n < 0:
        raise ValueError(f"spending rule {i}: {what} must be non-negative")
    return n


def _limit_amount(s: Any, what: str, i: int) -> int:
    """A denom-limit amount: ``""`` is zero, otherwise a non-negative decimal integer."""
    if s is None or s == "":
        return 0
    if not isinstance(s, str) or not _DECIMAL.fullmatch(s):
        raise ValueError(
            f"spending rule {i}: {what} {_quote(str(s))} is not a non-negative decimal integer"
        )
    return int(s)


def validate_spending_rules(rules: Iterable[Any] | None) -> None:
    """Check the rules of a ``MsgUpdateSpendingRules``.

    ``rules`` are ``SpendingRule`` protobuf messages or mappings with the same
    snake_case fields.

    :raises ValueError: Naming the rule (by index) and the problem; returns
        nothing when the rules are acceptable.
    """
    for i, rule in enumerate(rules or ()):
        daily = _rule_limit(_field(rule, "daily_limit"), "daily limit", i)
        per_tx = _rule_limit(_field(rule, "per_tx_limit"), "per-tx limit", i)
        calls = list(_field(rule, "allowed_evm_calls") or ())
        limits = list(_field(rule, "denom_limits") or ())
        if len(calls) > MAX_ALLOWED_EVM_CALLS:
            raise ValueError(
                f"spending rule {i}: at most {MAX_ALLOWED_EVM_CALLS} allowed EVM calls, "
                f"got {len(calls)}"
            )
        if len(limits) > MAX_DENOM_LIMITS:
            raise ValueError(
                f"spending rule {i}: at most {MAX_DENOM_LIMITS} denom limits, got {len(limits)}"
            )
        seen: set[str] = set()
        bounding_denom_limit = False
        for dl in limits:
            denom = _field(dl, "denom") or ""
            if denom.strip() == "":
                raise ValueError(f"spending rule {i}: a denom limit has no denom")
            # Length in UTF-16 units, as the other SDKs count it.
            if len(denom.encode("utf-16-le")) // 2 > 256 or _WHITESPACE_OR_CONTROL.search(denom):
                raise ValueError(
                    f"spending rule {i}: denom {_quote(denom)} is too long or contains whitespace"
                )
            try:
                validate_evm_denom(denom)
            except ValueError as err:
                raise ValueError(f"spending rule {i}: {err}") from None
            key = denom.lower()
            if key in seen:
                raise ValueError(f"spending rule {i}: denom {denom} has more than one limit")
            seen.add(key)
            a = _limit_amount(_field(dl, "per_tx_limit"), f"denom {denom} per-tx limit", i)
            b = _limit_amount(_field(dl, "daily_limit"), f"denom {denom} daily limit", i)
            if a == 0 and b == 0:
                raise ValueError(
                    f"spending rule {i}: the limit for {denom} sets neither a per-tx nor a daily "
                    f"amount, which would remove the limit for {denom} (an entry replaces the "
                    "rule-level limits for its denom); set an amount or drop the entry"
                )
            bounding_denom_limit = True
        allowed_denoms = list(_field(rule, "allowed_denoms") or ())
        for d in allowed_denoms:
            try:
                validate_evm_denom(d or "")
            except ValueError as err:
                raise ValueError(f"spending rule {i}: {err}") from None
        bounded = (
            daily > 0
            or per_tx > 0
            or len(allowed_denoms) > 0
            or len(calls) > 0
            or bounding_denom_limit
        )
        if _field(rule, "enabled") and not bounded:
            raise ValueError(
                f"spending rule {i} is enabled but bounds nothing: no per-tx or daily limit, "
                "no denom list, no allowed calls, and no denom limit with a non-zero amount. "
                "It would permit everything while showing as a spending limit; set at least "
                "one bound or disable it."
            )


__all__ = [
    "EVM_DENOM_PREFIXES",
    "MAX_ALLOWED_EVM_CALLS",
    "MAX_DENOM_LIMITS",
    "validate_evm_denom",
    "validate_spending_rules",
]
