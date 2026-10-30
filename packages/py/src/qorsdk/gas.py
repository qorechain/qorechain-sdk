"""Gas-price parsing, simulation, and auto-fee computation.

A gas price is a decimal amount of a base denom per unit of gas, written as a
single token like ``"0.025uqor"``. :meth:`GasPrice.from_string` parses that into
an exact fraction (numerator / 10^scale) so fee math stays integer-exact with no
floating-point drift, and :func:`calculate_fee` turns a gas limit plus a gas
price into a Native ``StdFee``-shaped dict.

The auto-gas path simulates a transaction against the REST
``/cosmos/tx/v1beta1/simulate`` endpoint to discover ``gas_used``, sizes the gas
limit from it, and prices it at a gas price (default ``0.15uqor``).
:func:`estimate_gas` returns the gas limit; :func:`auto_fee` returns the priced
fee.

How the limit is sized:

* A hybrid-signed transaction on a network that has applied chain v3.2.5:
  :func:`exact_hybrid_gas`, ``ceil(gas_used * 1.02) + 2000``. From v3.2.5 the
  simulation already charges the post-quantum signature check, so the estimate
  is exact up to small variance. Native-lane transactions pay the full gas
  limit times the gas price, so a tight limit is a lower fee.
* Everything else (a classical transaction, a network below v3.2.5, or when
  the network cannot be asked): ``ceil(gas_used * 1.4)``, as before.
* An explicit ``gas_multiplier`` always gives ``ceil(gas_used * gas_multiplier)``.
"""

from __future__ import annotations

import base64
import math
import re
from dataclasses import dataclass
from typing import Any

import httpx

from .errors import DecodedTxError, QoreTxError, decode_tx_error, error_from_text
from .tx import BuiltTx
from .upgrades import CHAIN_UPGRADE_V3_2_5, upgrade_applied_height

#: Default gas-used safety multiplier applied to a simulation result (every
#: transaction below chain v3.2.5, and classical transactions).
DEFAULT_GAS_MULTIPLIER = 1.4
#: Multiplier of the exact rule for hybrid transactions on chain v3.2.5+.
EXACT_GAS_MULTIPLIER = 1.02
#: Fixed headroom of the exact rule, added once per transaction (not per signer).
EXACT_GAS_HEADROOM = 2000
#: Default gas price (base denom per unit of gas). The chain enforces a genesis
#: min-gas-price (BaseFee) of ``0.1uqor``/gas on both networks; the default sits
#: above the floor for headroom.
DEFAULT_GAS_PRICE = "0.15uqor"

_GAS_PRICE_RE = re.compile(r"^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z][a-zA-Z0-9/:._-]*)$")

#: A Native ``StdFee``-shaped dict (``{"amount": [...], "gas": "..."}``).
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
    """Compute a Native ``StdFee``-shaped dict for ``gas`` at ``gas_price``.

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


class SimulationRefusedError(QoreTxError, httpx.HTTPStatusError):
    """A failed simulation whose text names a registered chain refusal.

    The simulate endpoint reports a refusal with the module's message but no
    ABCI code; :func:`~qorsdk.errors.decode_tx_error` names it from the chain's
    registered error descriptions. Both a :class:`~qorsdk.errors.QoreTxError`
    (``codespace`` / ``code`` / ``kind`` / ``raw_log``) and the original
    ``httpx.HTTPStatusError`` (``request`` / ``response``), so existing
    ``except httpx.HTTPStatusError`` handlers still catch it.
    """

    def __init__(self, decoded: DecodedTxError, err: httpx.HTTPStatusError) -> None:
        Exception.__init__(self, f"simulation refused: {decoded.message}")
        self.code = decoded.code
        self.codespace = decoded.codespace
        self.kind = decoded.kind
        self.raw_log = decoded.raw_log
        self.tx_hash = None
        self.request = err.request
        self.response = err.response


def _simulation_text(response: httpx.Response) -> str:
    """The refusal text of a failed simulate response (its ``message``, else the body)."""
    try:
        body = response.json()
    except ValueError:
        return response.text
    if isinstance(body, dict) and isinstance(body.get("message"), str):
        return str(body["message"])
    return response.text


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
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as err:
            text = _simulation_text(resp)
            if error_from_text(text) is not None:
                raise SimulationRefusedError(decode_tx_error(0, None, text), err) from err
            raise
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

    :raises SimulationRefusedError: If the chain refuses the transaction with a
        registered error (e.g. stakingtier 12, "no bonus to claim").
    :raises httpx.HTTPStatusError: On any other non-2xx response.
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


def exact_hybrid_gas(simulated: int) -> int:
    """The gas limit for a hybrid transaction on chain v3.2.5+:
    ``ceil(simulated * 1.02) + 2000``.

    From v3.2.5 the simulation charges the post-quantum verification itself, so
    nothing is added for it. Computed in integers, so no float rounding.
    """
    if simulated < 0:
        raise ValueError(f"simulated gas must be non-negative, got {simulated}")
    return -(-simulated * 102 // 100) + EXACT_GAS_HEADROOM


class _HttpGet:
    """``get(path) -> JSON`` over an httpx client, for the upgrade lookup."""

    def __init__(self, rest_url: str, client: httpx.Client, timeout: float) -> None:
        self._base = rest_url.rstrip("/")
        self._client = client
        self._timeout = timeout

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        resp = self._client.get(self._base + path, params=params, timeout=self._timeout)
        resp.raise_for_status()
        return resp.json()


def simulation_charges_pqc_verify(
    rest_url: str, *, timeout: float = 30.0, client: httpx.Client | None = None
) -> bool:
    """Whether the network behind ``rest_url`` has applied chain v3.2.5, so its
    simulation charges the post-quantum verification.

    The answer is cached per REST URL (an applied plan for the life of the
    process, "not applied" for a minute). A node that cannot be asked counts as
    not applied, which keeps the older, larger estimate.
    """
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout)
    try:
        height = upgrade_applied_height(
            _HttpGet(rest_url, http, timeout),
            CHAIN_UPGRADE_V3_2_5,
            cache_key=rest_url.rstrip("/"),
        )
        return height > 0
    except Exception:  # noqa: BLE001 - any failure keeps the conservative path
        return False
    finally:
        if owns_client:
            http.close()


def _gas_limit(
    rest_url: str,
    built: BuiltTx,
    gas_used: int,
    gas_multiplier: float | None,
    timeout: float,
    client: httpx.Client | None,
) -> int:
    if gas_multiplier is not None:
        return math.ceil(gas_used * gas_multiplier)
    if built.pqc_signature and simulation_charges_pqc_verify(
        rest_url, timeout=timeout, client=client
    ):
        return exact_hybrid_gas(gas_used)
    return math.ceil(gas_used * DEFAULT_GAS_MULTIPLIER)


def estimate_gas(
    rest_url: str,
    built: BuiltTx,
    *,
    gas_multiplier: float | None = None,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> int:
    """Simulate ``built`` and return the gas limit to sign.

    With no ``gas_multiplier``: :func:`exact_hybrid_gas` for a hybrid-signed
    ``built`` on a network that has applied v3.2.5, otherwise
    ``ceil(gas_used * DEFAULT_GAS_MULTIPLIER)``. With one:
    ``ceil(gas_used * gas_multiplier)``.
    """
    gas_used = simulate_gas_used(rest_url, built, timeout=timeout, client=client)
    return _gas_limit(rest_url, built, gas_used, gas_multiplier, timeout, client)


def auto_fee(
    rest_url: str,
    built: BuiltTx,
    *,
    gas_multiplier: float | None = None,
    gas_price: GasPrice | str = DEFAULT_GAS_PRICE,
    timeout: float = 30.0,
    client: httpx.Client | None = None,
) -> FeeDict:
    """Simulate, size the gas limit (see :func:`estimate_gas`), and price it into
    a Native ``StdFee`` dict: ``ceil(gas * gas_price)``.
    """
    gas = estimate_gas(
        rest_url, built, gas_multiplier=gas_multiplier, timeout=timeout, client=client
    )
    return calculate_fee(gas, gas_price)
