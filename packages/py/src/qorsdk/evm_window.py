"""The EVM authorisation window (chain v3.2.0, ``x/pqc``).

From v3.2.0 an EVM-lane transaction is admitted only from an account that

1. has a **registered post-quantum key**, and
2. has an **open, unexhausted authorisation window**.

The window is opened by an ordinary Cosmos-lane message
(``/qorechain.pqc.v1.MsgOpenEVMWindow``) which therefore carries the account's
hybrid (classical + ML-DSA-87) signature: the classical key alone can never open
a window. That is the whole point of the design — MetaMask and any other EVM
client keep working unmodified *inside* a window, and the post-quantum key
authorises the window itself.

This module carries the client surface: the bounds the chain enforces in
``ValidateBasic`` (so a caller fails fast instead of paying for a refused
transaction), the ``evm_window`` status query and its exact-integer parsing, and
a classifier for the four refusals an EVM send can hit. The message composers
live with every other message, as :func:`qorsdk.msg.pqc.open_evm_window` and
:func:`qorsdk.msg.pqc.close_evm_window`.

Nothing here opens a window implicitly. A wallet is expected to show an explicit
authorisation step; a silent open would spend the user's funds on a transaction
they never saw.

Three traps
-----------

**Ordering.** QoreChain unifies the identity, so the Cosmos sequence *is* the EVM
nonce, and opening a window **advances it** (measured on the testnet: 2 before,
3 after). The order is: open the window, **then** read the nonce, **then** sign
the EVM transaction. Signing first gives ``nonce too low``.

**max_value covers the fee.** The bound counts the transferred value **plus the
maximum fee** each admitted transaction could pay (gas limit x gas fee cap),
because the holder of the classical key sets the gas price and a value-only
bound would leave the account drainable through fees. Measured on the testnet: a
1,000 uqor transfer with a 21,000 gas limit at 112.5 gwei consumed 3,363 uqor of
the window. Wei to uqor rounds **up**, so a series of sub-uqor transfers cannot
drain a window that never appears to move.

**Do not print "about 24 hours".** The chain constant describes
:data:`MAX_EVM_WINDOW_BLOCKS` as about 24 hours at 5s blocks, but no QoreChain
network runs at 5s: the testnet is at ~1.03 s (17280 blocks is about 5 hours) and
mainnet at ~3.1 s (about 15 hours). Say "up to 17280 blocks", or compute the
duration from the chain's recent block time.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import quote

# --------------------------------------------------------------------------- #
# Type URLs and bounds
# --------------------------------------------------------------------------- #

#: Type URL of the message that opens a window.
OPEN_EVM_WINDOW_TYPE_URL = "/qorechain.pqc.v1.MsgOpenEVMWindow"

#: Type URL of the message that closes a window (takes effect in the same block).
CLOSE_EVM_WINDOW_TYPE_URL = "/qorechain.pqc.v1.MsgCloseEVMWindow"

#: The chain's ``MaxEVMWindowBlocks``: the longest a window may stay open.
#: Counted in BLOCKS, never in wall-clock time — see the module docstring.
MAX_EVM_WINDOW_BLOCKS = 17280

#: The chain's ``MaxEVMWindowTxs``: the most transactions a window may admit.
MAX_EVM_WINDOW_TXS = 1000

# --------------------------------------------------------------------------- #
# Error codes (codespace ``pqc``)
# --------------------------------------------------------------------------- #

#: The codespace every window refusal is reported under.
EVM_WINDOW_CODESPACE = "pqc"

#: ``pqc`` 26 — the account has no open EVM authorisation window.
ERR_NO_EVM_WINDOW = 26

#: ``pqc`` 27 — the window ran out of blocks, transactions or value.
ERR_EVM_WINDOW_EXHAUSTED = 27

#: ``pqc`` 28 — the window is invalid **or** the account has no registered
#: post-quantum key. The two are distinguished by the chain's message text, which
#: :func:`classify_evm_window_error` inspects.
ERR_INVALID_EVM_WINDOW = 28

#: What an EVM-lane refusal turned out to be.
#:
#: - ``"no_window"`` — no window is open (remedy: open one).
#: - ``"window_exhausted"`` — a window exists but has nothing left.
#: - ``"invalid_window"`` — the window does not cover this transaction.
#: - ``"no_pqc_key"`` — the account has no registered post-quantum key. This is
#:   its OWN state: no window can be opened until a key is registered.
EVMWindowErrorKind = Literal[
    "no_window", "window_exhausted", "invalid_window", "no_pqc_key"
]

#: The remedy for each refusal kind, phrased for a wallet to show a user.
EVM_WINDOW_REMEDIES: dict[str, str] = {
    "no_window": (
        "open an EVM authorisation window first (msg.pqc.open_evm_window, signed on "
        "the Cosmos lane with the account's post-quantum key), THEN read the nonce, "
        "THEN sign the EVM transaction — opening the window advances the nonce"
    ),
    "window_exhausted": (
        "the window ran out of blocks, transactions or value — open a new one "
        "(msg.pqc.open_evm_window); check the evm_window query to see which bound "
        "ran out"
    ),
    "invalid_window": (
        "the open window does not cover this transaction — re-open it with bounds "
        "that cover the value PLUS the maximum fee (gas limit x gas fee cap)"
    ),
    "no_pqc_key": (
        "register a post-quantum key first (msg.pqc.register_pqc_key_v2 / "
        "qorsdk.ensure_pqc_registered) — an account without one cannot open a window "
        "and cannot use the EVM lane"
    ),
}


def evm_window_remedy(kind: EVMWindowErrorKind) -> str:
    """The remedy text for a refusal ``kind`` from :func:`classify_evm_window_error`."""
    return EVM_WINDOW_REMEDIES[kind]


# --------------------------------------------------------------------------- #
# Client-side validation (mirrors the chain's ValidateBasic)
# --------------------------------------------------------------------------- #


def validate_evm_window_blocks(blocks: int) -> int:
    """Check ``blocks`` against the chain's bound and return it.

    :raises ValueError: If ``blocks`` is not in ``1..17280``.
    """
    if not isinstance(blocks, int) or isinstance(blocks, bool):
        raise ValueError(
            f"blocks must be an integer in 1..{MAX_EVM_WINDOW_BLOCKS}, got {blocks!r}"
        )
    if blocks < 1 or blocks > MAX_EVM_WINDOW_BLOCKS:
        raise ValueError(
            f"blocks must be in 1..{MAX_EVM_WINDOW_BLOCKS} "
            f"(MaxEVMWindowBlocks), got {blocks}"
        )
    return blocks


def validate_evm_window_max_txs(max_txs: int) -> int:
    """Check ``max_txs`` against the chain's bound and return it.

    :raises ValueError: If ``max_txs`` is not in ``1..1000``. Zero is refused
        explicitly by the chain: a window that admits nothing is a mistake, not a
        policy.
    """
    if not isinstance(max_txs, int) or isinstance(max_txs, bool):
        raise ValueError(
            f"max_txs must be an integer in 1..{MAX_EVM_WINDOW_TXS}, got {max_txs!r}"
        )
    if max_txs < 1 or max_txs > MAX_EVM_WINDOW_TXS:
        raise ValueError(
            f"max_txs must be in 1..{MAX_EVM_WINDOW_TXS} (MaxEVMWindowTxs), got {max_txs}"
        )
    return max_txs


def validate_evm_window_max_value(max_value: str | int) -> str:
    """Normalize ``max_value`` to the integer uqor string the chain expects.

    ``max_value`` is a ``cosmos.Int``: an exact integer, never a float. It bounds
    the transferred value **plus** the maximum fee (gas limit x gas fee cap).

    :raises ValueError: If it is not a positive integer.
    """
    if isinstance(max_value, bool):
        raise ValueError(f"max_value must be a positive integer in uqor, got {max_value!r}")
    if isinstance(max_value, int):
        parsed = max_value
    elif isinstance(max_value, str):
        text = max_value.strip()
        try:
            parsed = int(text, 10)
        except ValueError:
            raise ValueError(
                "max_value must be a positive integer string in uqor "
                f"(cosmos.Int, no decimals), got {max_value!r}"
            ) from None
    else:
        raise ValueError(f"max_value must be a positive integer in uqor, got {max_value!r}")
    if parsed <= 0:
        raise ValueError(f"max_value must be greater than 0 uqor, got {parsed}")
    return str(parsed)


@dataclass(frozen=True)
class EVMWindowParams:
    """The validated bounds of a window, as the chain stores them."""

    #: How long the window stays open, counted from the block that opens it.
    blocks: int
    #: How many EVM transactions the window admits.
    max_txs: int
    #: The total the window admits in uqor, value PLUS maximum fee, as an exact
    #: integer string (``cosmos.Int``).
    max_value: str


def validate_evm_window_params(
    *, blocks: int, max_txs: int, max_value: str | int
) -> EVMWindowParams:
    """Validate all three bounds at once, mirroring the chain's ``ValidateBasic``.

    Every field is required: the chain refuses an omitted field rather than
    defaulting it, so this helper takes no defaults either.

    :raises ValueError: Naming the bound that was violated.
    """
    return EVMWindowParams(
        blocks=validate_evm_window_blocks(blocks),
        max_txs=validate_evm_window_max_txs(max_txs),
        max_value=validate_evm_window_max_value(max_value),
    )


# --------------------------------------------------------------------------- #
# Status query
# --------------------------------------------------------------------------- #

#: The gRPC query path of the window status query.
EVM_WINDOW_QUERY_PATH = "/qorechain.pqc.v1.Query/EVMWindow"


def evm_window_path(address: str) -> str:
    """The REST (LCD) path of the window status for ``address``.

    The route answers ``200`` with ``found: false`` when no window is stored, so
    it is safe to poll.
    """
    return f"/qorechain/pqc/v1/evm_window/{quote(address, safe='')}"


@dataclass(frozen=True)
class EVMWindowStatus:
    """A decoded ``evm_window`` status.

    Every numeric field is an exact Python ``int``: the chain renders them as
    JSON strings precisely because several are ``cosmos.Int`` values that do not
    fit a float. Nothing here is ever parsed as a float.
    """

    #: Whether a window is stored at all. ``False`` for every other field zero.
    found: bool
    #: Whether the stored window still admits at least one zero-value
    #: transaction at the current height. A stored window may be expired or
    #: exhausted, so ``found`` alone is not enough.
    live: bool
    #: The height the window was opened at.
    opened_height: int
    #: The height the window expires at.
    expiry_height: int
    #: How many EVM transactions the window admits in total.
    max_txs: int
    #: How many it has admitted so far.
    used_txs: int
    #: The total uqor the window admits (value plus maximum fee).
    max_value: int
    #: The uqor consumed so far (value plus fee actually charged).
    used_value: int
    #: Blocks left before expiry.
    remaining_blocks: int
    #: Transactions left.
    remaining_txs: int
    #: uqor left.
    remaining_value: int


def _as_int(payload: Mapping[str, Any], field: str) -> int:
    """Read an exact integer from a JSON field that may be a string or a number."""
    raw = payload.get(field)
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"evm_window field {field!r} is a boolean, expected an integer")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(
                f"evm_window field {field!r} is not an integer: {raw!r}"
            ) from None
    # A float would already have lost precision above 2^53; refuse it rather than
    # silently truncate a cosmos.Int.
    raise ValueError(f"evm_window field {field!r} is not an integer: {raw!r}")


def parse_evm_window(payload: Mapping[str, Any]) -> EVMWindowStatus:
    """Parse an ``evm_window`` REST/gRPC-gateway payload into a typed status.

    Handles both shapes the route returns: ``{"found": false}`` when no window is
    stored, and the full live shape. Integers keep full precision.
    """
    found = bool(payload.get("found", False))
    if not found:
        return EVMWindowStatus(
            found=False,
            live=False,
            opened_height=0,
            expiry_height=0,
            max_txs=0,
            used_txs=0,
            max_value=0,
            used_value=0,
            remaining_blocks=0,
            remaining_txs=0,
            remaining_value=0,
        )
    return EVMWindowStatus(
        found=True,
        live=bool(payload.get("live", False)),
        opened_height=_as_int(payload, "opened_height"),
        expiry_height=_as_int(payload, "expiry_height"),
        max_txs=_as_int(payload, "max_txs"),
        used_txs=_as_int(payload, "used_txs"),
        max_value=_as_int(payload, "max_value"),
        used_value=_as_int(payload, "used_value"),
        remaining_blocks=_as_int(payload, "remaining_blocks"),
        remaining_txs=_as_int(payload, "remaining_txs"),
        remaining_value=_as_int(payload, "remaining_value"),
    )


class _RestGet(Protocol):
    """The read surface :func:`get_evm_window` needs from a REST client."""

    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    """The async mirror of :class:`_RestGet`."""

    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def get_evm_window(rest: _RestGet, address: str) -> EVMWindowStatus:
    """Read the EVM authorisation window status for ``address`` over REST.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    :param address: The ``qor1…`` account address.
    """
    return parse_evm_window(rest.get(evm_window_path(address)))


async def get_evm_window_async(rest: _AsyncRestGet, address: str) -> EVMWindowStatus:
    """Asynchronous mirror of :func:`get_evm_window`."""
    return parse_evm_window(await rest.get(evm_window_path(address)))


# --------------------------------------------------------------------------- #
# Refusal classifier
# --------------------------------------------------------------------------- #

# The chain's own texts. Over the EVM JSON-RPC lane the refusal arrives as a
# broadcast error carrying this text and NO codespace, so the text has to be
# matched as well as the code. Both spellings of "authorisation" are accepted.
_NO_PQC_KEY_TEXTS = (
    "no registered post-quantum key",
    "no registered post quantum key",
)
_NO_WINDOW_TEXTS = (
    "no open evm authorisation window",
    "no open evm authorization window",
)
_EXHAUSTED_TEXTS = (
    "evm authorisation window is exhausted",
    "evm authorization window is exhausted",
    "evm authorisation window exhausted",
    "evm authorization window exhausted",
)
_INVALID_TEXTS = (
    "invalid evm authorisation window",
    "invalid evm authorization window",
)


def classify_evm_window_error(
    *,
    code: int | None = None,
    codespace: str | None = None,
    message: str | None = None,
) -> EVMWindowErrorKind | None:
    """Classify an EVM-lane refusal, or return ``None`` if it is not one.

    Matches on the ``pqc`` codespace codes 26/27/28 **and** on the chain's own
    message text, because over EVM JSON-RPC the refusal arrives as a broadcast
    error that carries the text but not the codespace.

    ``pqc`` 28 covers two states the chain reports with one code: an invalid
    window, and an account with no registered post-quantum key. They have
    different remedies, so the text decides between them and a bare code 28 with
    no text classifies as ``"invalid_window"``.

    :param code: The ABCI result code, when one is available.
    :param codespace: The codespace the code belongs to; only ``"pqc"`` codes are
        considered, since a numeric code means nothing outside its codespace.
    :param message: The error / raw-log text, when one is available.
    """
    text = (message or "").lower()
    if text:
        if any(t in text for t in _NO_PQC_KEY_TEXTS):
            return "no_pqc_key"
        if any(t in text for t in _NO_WINDOW_TEXTS):
            return "no_window"
        if any(t in text for t in _EXHAUSTED_TEXTS):
            return "window_exhausted"
        if any(t in text for t in _INVALID_TEXTS):
            return "invalid_window"

    if code is not None and codespace == EVM_WINDOW_CODESPACE:
        if code == ERR_NO_EVM_WINDOW:
            return "no_window"
        if code == ERR_EVM_WINDOW_EXHAUSTED:
            return "window_exhausted"
        if code == ERR_INVALID_EVM_WINDOW:
            return "invalid_window"
    return None


@dataclass(frozen=True)
class EVMWindowRefusal:
    """A classified EVM-lane refusal together with the remedy to show."""

    #: Which of the four states the refusal is.
    kind: EVMWindowErrorKind
    #: What the caller must do about it.
    remedy: str
    #: The original message text, when one was supplied.
    message: str | None = None


def describe_evm_window_error(
    *,
    code: int | None = None,
    codespace: str | None = None,
    message: str | None = None,
) -> EVMWindowRefusal | None:
    """Classify a refusal and pair it with its remedy, or return ``None``.

    The convenience wrapper a high-level EVM send path uses to turn the chain's
    refusal into something a wallet can act on. It never opens a window: the
    authorisation step is always explicit.
    """
    kind = classify_evm_window_error(code=code, codespace=codespace, message=message)
    if kind is None:
        return None
    return EVMWindowRefusal(kind=kind, remedy=evm_window_remedy(kind), message=message)


__all__ = [
    "OPEN_EVM_WINDOW_TYPE_URL",
    "CLOSE_EVM_WINDOW_TYPE_URL",
    "MAX_EVM_WINDOW_BLOCKS",
    "MAX_EVM_WINDOW_TXS",
    "EVM_WINDOW_CODESPACE",
    "ERR_NO_EVM_WINDOW",
    "ERR_EVM_WINDOW_EXHAUSTED",
    "ERR_INVALID_EVM_WINDOW",
    "EVMWindowErrorKind",
    "EVM_WINDOW_REMEDIES",
    "evm_window_remedy",
    "EVMWindowParams",
    "validate_evm_window_blocks",
    "validate_evm_window_max_txs",
    "validate_evm_window_max_value",
    "validate_evm_window_params",
    "EVM_WINDOW_QUERY_PATH",
    "evm_window_path",
    "EVMWindowStatus",
    "parse_evm_window",
    "get_evm_window",
    "get_evm_window_async",
    "classify_evm_window_error",
    "EVMWindowRefusal",
    "describe_evm_window_error",
]
