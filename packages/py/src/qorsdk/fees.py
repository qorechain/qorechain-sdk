"""Native-transaction fee estimation for QoreChain.

QoreChain exposes an AI-assisted fee oracle at the REST route
``/qorechain/ai/v1/fee-estimate?urgency=fast|normal|slow``. :func:`estimate_fee`
queries it via the shared :class:`~qorechain.rest.RestClient` and shapes the
answer as a Cosmos ``StdFee``-style dict (``{"amount": [...], "gas": ...}``).

The oracle can be unavailable, so this falls back to a deterministic static fee
computed from a configurable gas price in the base denom — ``ceil(gas *
gas_price)`` — using integer math (no floats). The fallback is transparent and
never raises on a missing/erroring endpoint.
"""

from __future__ import annotations

from typing import Any

from .rest import FeeUrgency, RestClient

#: Default static-fallback parameters used when the AI fee oracle is unavailable.
STATIC_FALLBACK_GAS_PRICE = "0.025"
STATIC_FALLBACK_DENOM = "uqor"
STATIC_FALLBACK_GAS = "200000"


def _static_fee(gas: str, gas_price: str, denom: str) -> dict[str, Any]:
    """Compute a static fee as ``ceil(gas * gas_price)`` in ``denom``.

    Uses integer math on a scaled value to avoid floating-point drift.
    """
    gas_units = int(gas)
    int_part, _, frac_part = gas_price.partition(".")
    scale = 10 ** len(frac_part)
    numerator = int(int_part or "0") * scale + int(frac_part or "0")
    raw = gas_units * numerator
    amount = (raw + scale - 1) // scale  # ceil division
    return {"amount": [{"denom": denom, "amount": str(amount)}], "gas": gas}


def estimate_fee(
    rest: RestClient,
    *,
    urgency: FeeUrgency = "normal",
    gas: int | str = STATIC_FALLBACK_GAS,
    fallback_gas_price: str = STATIC_FALLBACK_GAS_PRICE,
    denom: str = STATIC_FALLBACK_DENOM,
) -> dict[str, Any]:
    """Estimate a transaction fee for the given urgency.

    Queries the QoreChain AI fee oracle and returns a Cosmos ``StdFee``-shaped
    dict. Falls back to a deterministic static fee when the oracle is
    unavailable or returns no usable amount.
    """
    gas_str = str(int(gas)) if isinstance(gas, int) else gas

    try:
        res = rest.get_fee_estimate(urgency)
        suggested = res.get("suggested_fee_uqor") if isinstance(res, dict) else None
        if suggested is not None:
            amount = str(int(suggested)) if isinstance(suggested, (int, float)) else str(suggested)
            if amount not in ("", "0"):
                return {"amount": [{"denom": denom, "amount": amount}], "gas": gas_str}
    except Exception:
        # Oracle unavailable — fall through to the static fee.
        pass

    return _static_fee(gas_str, fallback_gas_price, denom)
