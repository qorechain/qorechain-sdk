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
* A transaction carrying a CosmWasm execute / instantiate / migrate or a
  ``MsgCrossVMCall`` is sized at least ``ceil(gas_used * 1.3)``
  (:data:`WASM_MIN_GAS_MULTIPLIER`) whatever rule applies: the first call of a
  contract code in a block costs much more than a repeat (a cw20 transfer about
  533k gas cold, about 84k warm). Use auto / simulation for wasm and cross-VM
  gas; :func:`~qorsdk.fees.estimate_fee` refuses its fixed fallback for them.

Caps (chain v3.2.8): a Cosmos transaction above 50,000,000 gas
(:data:`~qorsdk.tx.COSMOS_TX_MAX_GAS`) is refused before signing, and an EVM
transaction above the EVM gas cap (30,000,000 by default,
:data:`EVM_TX_MAX_GAS`; read the value in force with :func:`fetch_evm_limits`)
by :func:`check_evm_gas_limit`.

Gas price: the default stays :data:`DEFAULT_GAS_PRICE`. The minimum the chain
enforces can be read, opt-in, with :func:`fetch_min_gas_price_uqor` and
:func:`recommended_gas_price_uqor` (no default path calls the network for it).
"""

from __future__ import annotations

import base64
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any

import httpx

from .errors import DecodedTxError, QoreTxError, decode_tx_error, error_from_text
from .tx import COSMOS_TX_MAX_GAS as COSMOS_TX_MAX_GAS
from .tx import BuiltTx, check_cosmos_gas_limit
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

#: Minimum multiplier for a transaction that carries CosmWasm or cross-VM calls.
WASM_MIN_GAS_MULTIPLIER = 1.3
#: Default EVM gas cap of chain v3.2.8 (``tx_max_gas`` while governance has not
#: set another).
EVM_TX_MAX_GAS = 30_000_000
#: Default largest guarded precompile input (bytes) when not queried.
EVM_PRECOMPILE_INPUT_MAX_BYTES = 0
#: REST route of the EVM limits query.
EVM_LIMITS_PATH = "/qorechain/pqc/v1/evm_limits"
#: REST route of the feemarket params (the minimum gas price the ante enforces).
FEEMARKET_PARAMS_PATH = "/cosmos/evm/feemarket/v1/params"
#: The chain's floor, in uqor per gas.
MIN_GAS_PRICE_FLOOR_UQOR = Decimal("0.1")
#: The lowest price :func:`recommended_gas_price_uqor` returns.
RECOMMENDED_GAS_PRICE_FLOOR_UQOR = Decimal("0.15")

#: Message types whose gas must come from simulation or an explicit limit.
WASM_GAS_TYPE_URLS: frozenset[str] = frozenset(
    {
        "/cosmwasm.wasm.v1.MsgExecuteContract",
        "/cosmwasm.wasm.v1.MsgInstantiateContract",
        "/cosmwasm.wasm.v1.MsgInstantiateContract2",
        "/cosmwasm.wasm.v1.MsgMigrateContract",
        "/qorechain.crossvm.v1.MsgCrossVMCall",
    }
)


def _type_url_of(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, dict):
        return str(message.get("type_url") or message.get("typeUrl") or "")
    return str(getattr(message, "type_url", "") or "")


def needs_simulated_gas(messages: Iterable[Any]) -> bool:
    """Whether a tx with ``messages`` carries a CosmWasm execute / instantiate /
    migrate or a ``MsgCrossVMCall``, whose gas must come from simulation (auto)
    or an explicit limit, never a fixed fallback.

    ``messages`` are :class:`~qorsdk.messages.Msg` objects, ``{"type_url", ...}``
    dicts or type URL strings.
    """
    return any(_type_url_of(m) in WASM_GAS_TYPE_URLS for m in messages)


def _built_type_urls(built: BuiltTx) -> list[str]:
    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody
    from google.protobuf.message import DecodeError

    body = TxBody()
    try:
        body.ParseFromString(built.tx_raw.body_bytes)
    except DecodeError:
        return []
    return [m.type_url for m in body.messages]


def check_evm_gas_limit(gas: int, *, cap: int = EVM_TX_MAX_GAS) -> int:
    """Refuse an EVM gas limit above the chain's EVM gas cap before signing.

    :param cap: The cap in force (from :func:`fetch_evm_limits`), default
        30,000,000.
    :raises ValueError: If ``gas`` is above ``cap``.
    """
    if gas > cap:
        raise ValueError(
            f"EVM gas limit {gas} exceeds the chain's EVM transaction gas cap of {cap:,} "
            "(chain v3.2.8 refuses it); lower the limit"
        )
    return gas


@dataclass(frozen=True)
class EVMLimits:
    """The EVM execution limits in force (``/qorechain/pqc/v1/evm_limits``)."""

    #: The most gas one EVM transaction may ask for.
    tx_max_gas: int
    #: The largest input a guarded stateful precompile accepts (0 = unknown).
    precompile_input_max_bytes: int


def parse_evm_limits(payload: Any) -> EVMLimits:
    """Parse the EVM limits answer: the top-level values in force, falling back
    to ``limits`` (what governance set), then to the defaults."""
    p: dict[str, Any] = payload if isinstance(payload, dict) else {}
    raw_limits = p.get("limits")
    limits: dict[str, Any] = raw_limits if isinstance(raw_limits, dict) else {}

    def pick(name: str, default: int) -> int:
        for source in (p, limits):
            raw = source.get(name)
            if raw is None or isinstance(raw, bool) or raw in ("", 0, "0"):
                continue
            try:
                return int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"evm_limits: {name} is not an integer: {raw!r}") from None
        return default

    return EVMLimits(
        tx_max_gas=pick("tx_max_gas", EVM_TX_MAX_GAS),
        precompile_input_max_bytes=pick(
            "precompile_input_max_bytes", EVM_PRECOMPILE_INPUT_MAX_BYTES
        ),
    )


def fetch_evm_limits(rest: Any) -> EVMLimits:
    """Read the EVM execution limits (chain v3.2.8) over REST.

    :param rest: A :class:`~qorsdk.rest.RestClient` (anything with ``get``).
    """
    return parse_evm_limits(rest.get(EVM_LIMITS_PATH))


async def fetch_evm_limits_async(rest: Any) -> EVMLimits:
    """Asynchronous mirror of :func:`fetch_evm_limits`."""
    return parse_evm_limits(await rest.get(EVM_LIMITS_PATH))


def _min_gas_price_from(payload: Any) -> Decimal:
    params = payload.get("params") if isinstance(payload, dict) else None
    raw = params.get("min_gas_price") if isinstance(params, dict) else None
    if raw is None or raw == "":
        value = Decimal(0)
    else:
        if not isinstance(raw, str):
            raise ValueError(f"feemarket min_gas_price is not a decimal string: {raw!r}")
        try:
            value = Decimal(raw)
        except InvalidOperation:
            raise ValueError(f"feemarket min_gas_price is not a decimal: {raw!r}") from None
        if not value.is_finite() or value < 0:
            raise ValueError(f"feemarket min_gas_price is not a non-negative decimal: {raw!r}")
    # 18-decimal EVM unit per gas -> uqor per gas, exactly (no context rounding).
    with localcontext() as ctx:
        ctx.prec = max(len(value.as_tuple().digits) + 4, 28)
        return max(value.scaleb(-12), MIN_GAS_PRICE_FLOOR_UQOR)


def _times(price: Decimal, margin: Decimal | str | int) -> Decimal:
    m = Decimal(str(margin))
    with localcontext() as ctx:
        ctx.prec = len(price.as_tuple().digits) + len(m.as_tuple().digits) + 4
        return max(price * m, RECOMMENDED_GAS_PRICE_FLOOR_UQOR)


def fetch_min_gas_price_uqor(rest: Any) -> Decimal:
    """The minimum gas price the chain enforces, in uqor per gas (opt-in).

    Reads ``params.min_gas_price`` of ``/cosmos/evm/feemarket/v1/params`` (a
    decimal in the 18-decimal EVM unit), divides it by 10^12 exactly and returns
    ``max(that, 0.1)``. The package's default gas price does not use it.
    """
    return _min_gas_price_from(rest.get(FEEMARKET_PARAMS_PATH))


async def fetch_min_gas_price_uqor_async(rest: Any) -> Decimal:
    """Asynchronous mirror of :func:`fetch_min_gas_price_uqor`."""
    return _min_gas_price_from(await rest.get(FEEMARKET_PARAMS_PATH))


def recommended_gas_price_uqor(rest: Any, *, margin: Decimal | str | int = "1.5") -> Decimal:
    """``max(0.15, fetch_min_gas_price_uqor(rest) * margin)`` uqor per gas (opt-in).

    Pass ``f"{price}uqor"`` to :func:`calculate_fee` / :func:`auto_fee`.
    """
    return _times(fetch_min_gas_price_uqor(rest), margin)


async def recommended_gas_price_uqor_async(
    rest: Any, *, margin: Decimal | str | int = "1.5"
) -> Decimal:
    """Asynchronous mirror of :func:`recommended_gas_price_uqor`."""
    return _times(await fetch_min_gas_price_uqor_async(rest), margin)


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
    wasm = needs_simulated_gas(_built_type_urls(built))
    if gas_multiplier is not None:
        if wasm:
            gas_multiplier = max(gas_multiplier, WASM_MIN_GAS_MULTIPLIER)
        limit = math.ceil(gas_used * gas_multiplier)
    elif built.pqc_signature and simulation_charges_pqc_verify(
        rest_url, timeout=timeout, client=client
    ):
        limit = exact_hybrid_gas(gas_used)
        if wasm:
            limit = max(limit, -(-gas_used * 13 // 10))
    else:
        limit = math.ceil(gas_used * DEFAULT_GAS_MULTIPLIER)
    return check_cosmos_gas_limit(limit)


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
    ``ceil(gas_used * gas_multiplier)``. A tx with CosmWasm or cross-VM calls
    gets at least ``ceil(gas_used * 1.3)``.

    :raises ValueError: If the limit would exceed the Cosmos gas cap.
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
