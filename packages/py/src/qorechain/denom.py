"""Conversion between human display amounts and integer base amounts.

All value math is performed with integer arithmetic on decimal strings — there
is no floating-point arithmetic anywhere in this module, so conversions are
exact for any magnitude and never drift (e.g. ``to_base("0.1") == "100000"``).

QoreChain's staking coin uses a default exponent of ``6`` (1 QOR = 10^6 uqor),
but every function accepts a custom ``exponent`` for other denominations.
"""

from __future__ import annotations

import re

#: The QoreChain staking coin's default decimal exponent (1 QOR = 10^6 uqor).
DEFAULT_EXPONENT = 6

_DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")
_INT_RE = re.compile(r"^\d+$")


def _resolve_exponent(exponent: int) -> int:
    if not isinstance(exponent, int) or isinstance(exponent, bool) or exponent < 0:
        raise ValueError(f"invalid exponent: {exponent} (must be a non-negative integer)")
    return exponent


def to_base(amount: str, exponent: int = DEFAULT_EXPONENT) -> str:
    """Convert a human display amount to its integer base amount string.

    :param amount: A non-negative decimal string, e.g. ``"1.5"``. Surrounding
        whitespace and a single leading ``+`` are tolerated. Scientific
        notation, thousands separators, and other formatting are rejected.
    :param exponent: Decimal exponent (defaults to 6).
    :returns: The integer base amount as a string with no leading zeros.
    :raises ValueError: If ``amount`` is not a valid decimal string, is
        negative, or has more fractional digits than ``exponent`` allows.
    """
    exponent = _resolve_exponent(exponent)
    body = amount.strip()

    if body.startswith("-"):
        raise ValueError(f"negative amounts are not supported: {amount}")
    if body.startswith("+"):
        body = body[1:]

    if not _DECIMAL_RE.match(body):
        raise ValueError(f"invalid decimal amount: {amount}")

    int_part, _, frac_part = body.partition(".")
    if len(frac_part) > exponent:
        raise ValueError(
            f"too many decimal places in {amount}: {len(frac_part)} > exponent {exponent}"
        )

    padded = frac_part.ljust(exponent, "0")
    return str(int(int_part + padded))


def from_base(base: str, exponent: int = DEFAULT_EXPONENT) -> str:
    """Convert an integer base amount string to a normalized display string.

    :param base: A non-negative integer string, e.g. ``"1500000"``.
    :param exponent: Decimal exponent (defaults to 6).
    :returns: The display amount with no trailing zeros and no trailing dot,
        e.g. ``"1.5"``. ``"1000000"`` becomes ``"1"``, ``"1"`` becomes
        ``"0.000001"``, ``"0"`` becomes ``"0"``.
    :raises ValueError: If ``base`` is not a valid non-negative integer string.
    """
    exponent = _resolve_exponent(exponent)
    trimmed = base.strip()

    if trimmed.startswith("-"):
        raise ValueError(f"negative amounts are not supported: {base}")
    if not _INT_RE.match(trimmed):
        raise ValueError(f"invalid base amount: {base}")

    if exponent == 0:
        return str(int(trimmed))

    padded = trimmed.rjust(exponent + 1, "0")
    int_part = padded[: len(padded) - exponent]
    frac_part = padded[len(padded) - exponent :]

    normalized_int = str(int(int_part))
    trimmed_frac = frac_part.rstrip("0")
    return f"{normalized_int}.{trimmed_frac}" if trimmed_frac else normalized_int
