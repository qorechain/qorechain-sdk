"""Gas-price parsing, simulation, and auto-fee computation.

A gas price is a decimal amount of a base denom per unit of gas, written as a
single token like ``"0.025uqor"``. :meth:`GasPrice.from_string` parses that into
an exact fraction (numerator / 10^scale) so fee math stays integer-exact with no
floating-point drift, and :func:`calculate_fee` turns a gas limit plus a gas
price into a Cosmos ``StdFee``-shaped dict.

The auto-gas path simulates a transaction against the REST
``/cosmos/tx/v1beta1/simulate`` endpoint to discover ``gas_used``, applies a
safety multiplier (default ``1.4``), and prices it at a gas price (default
``0.025uqor``). :func:`estimate_gas` returns the multiplied gas; :func:`auto_fee`
returns the priced fee.
"""

from __future__ import annotations

import base64
import math
import re
from dataclasses import dataclass
from typing import Any

import httpx

from .tx import BuiltTx

#: Default gas-used safety multiplier applied to a simulation result.
DEFAULT_GAS_MULTIPLIER = 1.4
#: Default gas price (base denom per unit of gas).
DEFAULT_GAS_PRICE = "0.025uqor"

_GAS_PRICE_RE = re.compile(r"^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z][a-zA-Z0-9/:._-]*)$")

#: A Cosmos ``StdFee``-shaped dict (``{"amount": [...], "gas": "..."}``).
FeeDict = dict[str, Any]


@dataclass(frozen=True)
class GasPrice:
    """A decimal amount of a base denom per unit of gas (e.g. ``0.025 uqor``).

    Stored as an exact fraction: ``numerator / 10^scale`` of ``denom`` per gas.
    """

    #: The price scaled by ``10^scale``, as an integer.
    numerator: int
    #: Number of fractional decimal places encoded in ``numerator``.
    scale: int
    #: The base denomination (e.g. ``"uqor"``).
    denom: str

    @staticmethod
    def from_string(gas_price: str) -> GasPrice:
        """Parse a gas price like ``"0.025uqor"`` (decimal amount + denom).

        :raises ValueError: If the string is not a valid ``<amount><denom>`` token.
        """
        match = _GAS_PRICE_RE.match(gas_price.strip())
        if not match:
            raise ValueError(
                f'invalid gas price: "{gas_price}" (expected e.g. "0.025uqor")'
            )
        amount, denom = match.group(1), match.group(2)
        int_part, _, frac_part = amount.partition(".")
        scale = len(frac_part)
        numerator = int((int_part or "0") + frac_part)
        return GasPrice(numerator=numerator, scale=scale, denom=denom)

    @staticmethod
    def from_amount(amount: str, denom: str) -> GasPrice:
        """Construct from a decimal amount string and denom (``"0.025"``, ``"uqor"``)."""
        return GasPrice.from_string(f"{amount}{denom}")

    def __str__(self) -> str:
        s = str(self.numerator).rjust(self.scale + 1, "0")
        cut = len(s) - self.scale
        int_part = s[:cut]
        frac_part = s[cut:].rstrip("0")
        amount = f"{int_part}.{frac_part}" if frac_part else int_part
        return f"{amount}{self.denom}"


def calculate_fee(gas: int | str, gas_price: GasPrice | str) -> FeeDict:
    """Compute a Cosmos ``StdFee``-shaped dict for ``gas`` at ``gas_price``.

    The fee amount is ``ceil(gas * price)`` in the price's denom, computed with
    integer math: ``ceil(gas * numerator / 10^scale)``. Ceil rounding ensures
    the offered fee always meets a node's ``gas * min_gas_price`` threshold.

    :param gas: The gas limit, as an integer or decimal string.
    :param gas_price: A :class:`GasPrice` or a parseable string (``"0.025uqor"``).
    """
    price = GasPrice.from_string(gas_price) if isinstance(gas_price, str) else gas_price
    gas_limit = int(gas)
    denominator = 10**price.scale
    raw = gas_limit * price.numerator
    amount = (raw + denominator - 1) // denominator  # ceil division
    return {
        "amount": [{"denom": price.denom, "amount": str(amount)}],
        "gas": str(gas_limit),
    }


def _simulate_request(
    rest_url: str,
    tx_bytes: bytes,
    *,
    timeout: float,
    client: httpx.Client | None,
) -> Any:
    """POST a tx to ``/cosmos/tx/v1beta1/simulate`` and return the JSON response."""
    payload = {"tx_bytes": base64.b64encode(tx_bytes).decode("ascii")}
    url = f"{rest_url.rstrip('/')}/cosmos/tx/v1beta1/simulate"
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout)
    try:
        resp = http.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()
    finally:
        if owns_client:
            http.close()


def simulate_gas_used(
    rest_url: str,
    built: BuiltTx,
    *,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> int:
    """Simulate ``built`` over REST and return the reported ``gas_used``.

    Simulation requires a live node; unit tests mock the HTTP POST.

    :raises ValueError: If the response carries no ``gas_info.gas_used``.
    """
    res = _simulate_request(
        rest_url, built.tx_raw_bytes, timeout=timeout, client=client
    )
    gas_used = None
    if isinstance(res, dict):
        gas_info = res.get("gas_info")
        if isinstance(gas_info, dict):
            gas_used = gas_info.get("gas_used")
    if gas_used is None:
        raise ValueError("simulation response did not include gas_info.gas_used")
    return int(gas_used)


def estimate_gas(
    rest_url: str,
    built: BuiltTx,
    *,
    gas_multiplier: float = DEFAULT_GAS_MULTIPLIER,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> int:
    """Simulate ``built`` and return ``ceil(gas_used * gas_multiplier)``.

    The multiplier provides headroom over the simulated estimate, which a node
    can exceed slightly at execution time.
    """
    gas_used = simulate_gas_used(rest_url, built, timeout=timeout, client=client)
    return math.ceil(gas_used * gas_multiplier)


def auto_fee(
    rest_url: str,
    built: BuiltTx,
    *,
    gas_multiplier: float = DEFAULT_GAS_MULTIPLIER,
    gas_price: GasPrice | str = DEFAULT_GAS_PRICE,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> FeeDict:
    """Simulate, multiply the gas, and price it into a Cosmos ``StdFee`` dict.

    Mirrors the ``fee="auto"`` path: simulate ``built`` to discover ``gas_used``,
    apply ``gas_multiplier``, and compute ``ceil(gas * gas_price)``.
    """
    gas = estimate_gas(
        rest_url, built, gas_multiplier=gas_multiplier, timeout=timeout, client=client
    )
    return calculate_fee(gas, gas_price)
