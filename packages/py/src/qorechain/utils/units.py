"""Generic, integer-exact unit conversion for arbitrary token decimals.

Where :func:`qorechain.denom.to_base` / :func:`qorechain.denom.from_base` are
specialized to the QoreChain staking coin (``uqor``, exponent 6), these helpers
take an explicit ``decimals`` argument and are the right tool for EVM-style
18-decimal tokens, SPL tokens, or any other denomination.

All math is performed with Python's arbitrary-precision ``int`` on decimal
strings — there is no floating-point arithmetic, so conversions are exact for
any magnitude. :func:`parse_units` returns an ``int``; :func:`format_units`
returns a normalized decimal string.
"""

from __future__ import annotations

import re

_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")
_INT_RE = re.compile(r"^[+-]?\d+$")


def _check_decimals(decimals: int) -> None:
    if not isinstance(decimals, int) or isinstance(decimals, bool) or decimals < 0:
        raise ValueError(
            f"invalid decimals: {decimals} (must be a non-negative integer)"
        )


def parse_units(amount: str, decimals: int) -> int:
    """Parse a human display amount into its integer base-unit value.

    :param amount: A non-negative decimal string, e.g. ``"1.5"``. A single
        leading ``+`` and surrounding whitespace are tolerated; scientific
        notation, thousands separators, and other formatting are rejected.
    :param decimals: Number of fractional decimals the unit has (e.g. ``18`` for
        most ERC-20 tokens).
    :returns: The base-unit value, e.g. ``parse_units("1.5", 18) ==
        1500000000000000000``.
    :raises ValueError: If ``amount`` is malformed, negative, or has more
        fractional digits than ``decimals`` allows.
    """
    _check_decimals(decimals)
    body = amount.strip()
    if body.startswith("-"):
        raise ValueError(f"negative amounts are not supported: {amount}")
    if body.startswith("+"):
        body = body[1:]
    if not _DECIMAL_RE.match(body):
        raise ValueError(f"invalid decimal amount: {amount}")

    int_part, _, frac_part = body.partition(".")
    if len(frac_part) > decimals:
        raise ValueError(
            f"too many decimal places in {amount}: {len(frac_part)} > decimals {decimals}"
        )
    padded = frac_part.ljust(decimals, "0")
    return int(int_part + padded)


def format_units(value: int | str, decimals: int) -> str:
    """Format an integer base-unit value as a normalized display string.

    :param value: The base-unit value as an ``int`` or decimal string. Must be a
        non-negative integer.
    :param decimals: Number of fractional decimals the unit has.
    :returns: The display amount with no trailing zeros and no trailing dot,
        e.g. ``format_units(1500000000000000000, 18) == "1.5"``; ``0`` formats as
        ``"0"``.
    :raises ValueError: If ``value`` is not a valid non-negative integer.
    """
    _check_decimals(decimals)

    if isinstance(value, bool):
        raise ValueError(f"invalid base value: {value}")
    if isinstance(value, int):
        big = value
    else:
        t = value.strip()
        if not _INT_RE.match(t):
            raise ValueError(f"invalid base value: {value}")
        big = int(t)

    if big < 0:
        raise ValueError(f"negative amounts are not supported: {value}")
    if decimals == 0:
        return str(big)

    digits = str(big).rjust(decimals + 1, "0")
    int_part = digits[: len(digits) - decimals]
    frac_part = digits[len(digits) - decimals :]

    normalized_int = str(int(int_part))
    trimmed_frac = frac_part.rstrip("0")
    return f"{normalized_int}.{trimmed_frac}" if trimmed_frac else normalized_int
