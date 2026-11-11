"""Client-side checks for the governance params messages (chain v3.2.5, extended
in v3.2.8).

``MsgUpdateParams`` of ``x/crossvm`` and ``x/rdk`` and ``MsgUpdateConfig`` of
``x/abstractaccount`` replace a module's settings wholesale, and only execute
from a passed proposal (``authority`` is the governance module account). A
proposal copies the current values from the module's params query and changes
only what it means to change. The checks below mirror the chain's, so a
proposal that would fail on execution is refused before it is submitted.

**Every field is required (v3.2.8).** The crossvm, svm and rdk ``MsgUpdateParams``
replace the module's parameters wholesale, so a field left out is set to zero: a
proposal that omitted the crossvm ``bridge_target_pins`` would wipe them, and one
that omitted the svm custody ceilings would remove them. The composers therefore
refuse a missing (or ``None``) field, naming it. Build a params proposal with
:func:`crossvm_update_params_from_current`, :func:`svm_update_params_from_current`
or :func:`rdk_update_params_from_current`: they read the parameters in force over
REST and apply only the ``changes`` you pass.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .messages._composer import Msg

from .address import is_valid_bech32

#: Type URLs.
UPDATE_CROSSVM_PARAMS_TYPE_URL = "/qorechain.crossvm.v1.MsgUpdateParams"
UPDATE_RDK_PARAMS_TYPE_URL = "/qorechain.rdk.v1.MsgUpdateParams"
UPDATE_SVM_PARAMS_TYPE_URL = "/qorechain.svm.v1.MsgUpdateParams"

#: Every field of crossvm ``MsgUpdateParams`` but ``authority`` (v3.2.8, fields 2..18).
CROSSVM_UPDATE_PARAMS_FIELDS: tuple[str, ...] = (
    "max_message_size",
    "max_queue_size",
    "queue_timeout_blocks",
    "enabled",
    "bridge_allowed_targets",
    "bridge_target_pins",
    "max_pending_per_sender",
    "max_cosmos_tx_gas",
    "record_retention_blocks",
    "max_block_wasm_gas",
    "max_tx_wasm_share_bps",
    "max_block_level_wasm_gas",
    "queue_wasm_reserve_bps",
    "wasm_congestion_max_factor",
    "wasm_congestion_target_bps",
    "max_block_upload_bps",
    "max_queue_timeouts_per_block",
)

#: Every field of rdk ``MsgUpdateParams`` but ``authority`` (v3.2.8, fields 2..14).
RDK_UPDATE_PARAMS_FIELDS: tuple[str, ...] = (
    "max_rollups",
    "min_stake_for_rollup",
    "rollup_creation_burn_rate",
    "default_challenge_window",
    "max_da_blob_size",
    "blob_retention_blocks",
    "max_batches_per_block",
    "finalized_batch_retention_blocks",
    "max_posted_data_bytes",
    "max_posted_data_bytes_per_block",
    "posted_data_fee_per_byte",
    "posted_data_retention_blocks",
    "min_submitter_bond",
)

#: Every field of the svm ``SVMParams`` (v3.2.8, fields 1..12).
SVM_PARAMS_FIELDS: tuple[str, ...] = (
    "max_program_size",
    "max_account_data_size",
    "compute_budget_max",
    "lamports_per_byte",
    "rent_exemption_multi",
    "enabled",
    "svm_slot_offset",
    "default_sig_scheme",
    "max_cpi",
    "max_custody_uqor",
    "max_custody_hard_uqor",
    "max_account_excess_uqor",
)

#: REST routes of the params queries the copy-from-query helpers read.
CROSSVM_PARAMS_PATH = "/qorechain/crossvm/v1/params"
SVM_PARAMS_PATH = "/qorechain/svm/v1/params"
RDK_PARAMS_PATH = "/qorechain/rdk/v1/params"

#: crossvm ceilings a governance update must respect.
CROSSVM_MAX_MESSAGE_SIZE = 1 << 20
CROSSVM_MAX_QUEUE_SIZE = 10_000
CROSSVM_MAX_QUEUE_TIMEOUT_BLOCKS = 100_000
CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS = 64
CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE = 256

#: rdk bounds of ``default_challenge_window`` (seconds) and ``max_da_blob_size``.
RDK_MIN_CHALLENGE_WINDOW_SEC = 60
RDK_MAX_CHALLENGE_WINDOW_SEC = 30 * 24 * 3600
RDK_MAX_DA_BLOB_SIZE = 8 << 20


def _positive_int(value: object, name: str, what: str, ceiling: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{what}: {name} must be a positive integer, got {value!r}")
    if ceiling is not None and value > ceiling:
        raise ValueError(f"{what}: {name} {value} exceeds {ceiling}")
    return value


def _authority(authority: str, what: str) -> None:
    if not authority:
        raise ValueError(f"{what}: authority (the governance module account) is required")


def require_fields(what: str, given: Mapping[str, Any], names: tuple[str, ...]) -> None:
    """Refuse a params update that leaves out a field (absent or ``None``).

    :raises ValueError: Naming every missing field.
    """
    missing = [n for n in names if given.get(n) is None]
    if missing:
        raise ValueError(
            f"{what}: the message replaces every parameter, so each must be given explicitly "
            f"(a field left out would be set to zero); missing: {', '.join(missing)}. "
            "Copy the current values with the *_update_params_from_current helpers."
        )


def _non_negative_int(value: object, name: str, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{what}: {name} must be a non-negative integer, got {value!r}")
    return value


def _pin_field(pin: Any, name: str) -> Any:
    if isinstance(pin, Mapping):
        return pin.get(name)
    return getattr(pin, name, None)


def validate_crossvm_target_pins(pins: Any, targets: list[str], what: str) -> None:
    """The chain's checks on ``bridge_target_pins`` (v3.2.8): each pin names an
    allowlist entry, once, with a non-zero ``code_id`` and ``history_len``."""
    listed = set(targets)
    pinned: set[str] = set()
    for pin in pins or ():
        target = _pin_field(pin, "target")
        if not isinstance(target, str) or target not in listed:
            raise ValueError(f"{what}: bridge target pin {target!r} names no allowlist entry")
        if target in pinned:
            raise ValueError(f"{what}: bridge target {target!r} is pinned twice")
        pinned.add(target)
        for field in ("code_id", "history_len"):
            v = _pin_field(pin, field)
            if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
                raise ValueError(f"{what}: bridge target pin {target!r} has no {field}")


def validate_crossvm_update_params(
    *,
    authority: str,
    max_message_size: int,
    max_queue_size: int,
    queue_timeout_blocks: int,
    enabled: bool = False,
    bridge_allowed_targets: list[str] | tuple[str, ...] | None = None,
) -> None:
    """The chain's checks on crossvm ``MsgUpdateParams``.

    Each ``bridge_allowed_targets`` entry is ``"cosmwasm:<contract>"`` (the EVM
    bridge precompile only calls CosmWasm contracts), at most 64 entries of at
    most 256 bytes, no duplicates. An empty list keeps the bridge shut.

    :raises ValueError: Naming the field.
    """
    what = "crossvm update_params"
    _authority(authority, what)
    _positive_int(max_message_size, "max_message_size", what, CROSSVM_MAX_MESSAGE_SIZE)
    _positive_int(max_queue_size, "max_queue_size", what, CROSSVM_MAX_QUEUE_SIZE)
    _positive_int(
        queue_timeout_blocks, "queue_timeout_blocks", what, CROSSVM_MAX_QUEUE_TIMEOUT_BLOCKS
    )
    targets = list(bridge_allowed_targets or ())
    if len(targets) > CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS:
        raise ValueError(
            f"{what}: bridge allowlist has {len(targets)} entries, "
            f"max {CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS}"
        )
    seen: set[str] = set()
    for entry in targets:
        if not isinstance(entry, str):
            raise ValueError(f"{what}: bridge allowed target {entry!r} is not a string")
        vm, sep, contract = entry.partition(":")
        if not sep or not contract:
            raise ValueError(f"{what}: bridge allowed target {entry!r} must be <vm>:<contract>")
        if len(entry.encode()) > CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE:
            raise ValueError(
                f"{what}: bridge allowed target {entry!r} is longer than "
                f"{CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE} bytes"
            )
        if entry in seen:
            raise ValueError(f"{what}: bridge allowed target {entry!r} is listed twice")
        seen.add(entry)
        if vm != "cosmwasm":
            raise ValueError(
                f"{what}: bridge allowed target {entry!r}: the bridge only calls cosmwasm contracts"
            )
        if not is_valid_bech32(contract):
            raise ValueError(f"{what}: bridge allowed target {entry!r}: invalid contract address")


def validate_svm_params(params: Mapping[str, Any]) -> None:
    """Checks on the svm ``SVMParams`` of a ``MsgUpdateParams`` (v3.2.8).

    Every field must be given, and ``enabled = true`` needs a non-zero
    ``max_custody_hard_uqor``.

    :raises ValueError: Naming the field.
    """
    what = "svm update_params"
    if not isinstance(params, Mapping):
        raise ValueError(
            f"{what}: pass params as a mapping with every SVMParams field "
            f"({', '.join(SVM_PARAMS_FIELDS)})"
        )
    require_fields(what, params, SVM_PARAMS_FIELDS)
    for name in (
        "max_program_size",
        "max_account_data_size",
        "compute_budget_max",
        "lamports_per_byte",
        "default_sig_scheme",
        "max_cpi",
        "max_custody_uqor",
        "max_custody_hard_uqor",
        "max_account_excess_uqor",
    ):
        _non_negative_int(params[name], name, what)
    if params["enabled"] and int(params["max_custody_hard_uqor"]) == 0:
        raise ValueError(
            f"{what}: governance must set a hard custody ceiling before opening the lane "
            "(enabled = true needs max_custody_hard_uqor > 0)"
        )


def validate_rdk_update_params(
    *,
    authority: str,
    max_rollups: int,
    min_stake_for_rollup: int,
    rollup_creation_burn_rate: str,
    default_challenge_window: int,
    max_da_blob_size: int,
    blob_retention_blocks: int,
    max_batches_per_block: int,
) -> None:
    """The chain's checks on rdk ``MsgUpdateParams``.

    ``rollup_creation_burn_rate`` is a decimal string in [0, 1);
    ``default_challenge_window`` is 60 seconds to 30 days; ``max_da_blob_size``
    is 1 byte to 8 MiB; every other value is positive.

    :raises ValueError: Naming the field.
    """
    what = "rdk update_params"
    _authority(authority, what)
    _positive_int(max_rollups, "max_rollups", what)
    _positive_int(min_stake_for_rollup, "min_stake_for_rollup", what)
    try:
        rate = (
            Decimal(rollup_creation_burn_rate)
            if isinstance(rollup_creation_burn_rate, str)
            else None
        )
    except InvalidOperation:
        rate = None
    if rate is None or not rate.is_finite() or rate < 0 or rate >= 1:
        raise ValueError(
            f"{what}: rollup_creation_burn_rate must be a decimal in [0, 1), "
            f"got {rollup_creation_burn_rate!r}"
        )
    _positive_int(default_challenge_window, "default_challenge_window", what)
    if not RDK_MIN_CHALLENGE_WINDOW_SEC <= default_challenge_window <= RDK_MAX_CHALLENGE_WINDOW_SEC:
        raise ValueError(
            f"{what}: default_challenge_window must be {RDK_MIN_CHALLENGE_WINDOW_SEC}.."
            f"{RDK_MAX_CHALLENGE_WINDOW_SEC} seconds, got {default_challenge_window}"
        )
    _positive_int(max_da_blob_size, "max_da_blob_size", what, RDK_MAX_DA_BLOB_SIZE)
    _positive_int(blob_retention_blocks, "blob_retention_blocks", what)
    _positive_int(max_batches_per_block, "max_batches_per_block", what)


# --------------------------------------------------------------------------- #
# copy-from-query: build a params proposal from the values in force
# --------------------------------------------------------------------------- #


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(w.title() for w in rest)


def _get(payload: Mapping[str, Any], name: str) -> Any:
    if name in payload:
        return payload[name]
    return payload.get(_camel(name))


def _as_uint(value: Any, name: str, what: str) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        raise ValueError(f"{what}: {name} in the params answer is not an integer: {value!r}")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(
            f"{what}: {name} in the params answer is not an integer: {value!r}"
        ) from None


def _unwrap(payload: Any, what: str) -> Mapping[str, Any]:
    if not isinstance(payload, Mapping):
        raise ValueError(f"{what}: the params answer is not an object")
    inner = payload.get("params")
    return inner if isinstance(inner, Mapping) else payload


def _apply_changes(
    what: str, current: dict[str, Any], changes: Mapping[str, Any] | None, names: tuple[str, ...]
) -> dict[str, Any]:
    out = dict(current)
    for key, value in (changes or {}).items():
        if key not in names:
            raise ValueError(f"{what}: unknown parameter {key!r} in changes")
        out[key] = value
    return out


_CROSSVM_BOOL = ("enabled",)
_CROSSVM_LISTS = ("bridge_allowed_targets", "bridge_target_pins")


def parse_crossvm_params(payload: Any) -> dict[str, Any]:
    """The crossvm params answer as ``MsgUpdateParams`` fields (v3.2.8).

    The query lists the values IN FORCE (defaults substituted for zero), so
    copying them is correct. ``wasm_congestion_factor_micro`` is a live reading,
    not a parameter, and is left out.
    """
    what = "crossvm params"
    p = _unwrap(payload, what)
    out: dict[str, Any] = {}
    for name in CROSSVM_UPDATE_PARAMS_FIELDS:
        raw = _get(p, name)
        if name in _CROSSVM_BOOL:
            out[name] = raw is True
        elif name == "bridge_allowed_targets":
            out[name] = [str(t) for t in (raw or ())]
        elif name == "bridge_target_pins":
            out[name] = [
                {
                    "target": str(_get(pin, "target") or ""),
                    "code_id": _as_uint(_get(pin, "code_id"), "code_id", what),
                    "history_len": _as_uint(_get(pin, "history_len"), "history_len", what),
                }
                for pin in (raw or ())
                if isinstance(pin, Mapping)
            ]
        else:
            out[name] = _as_uint(raw, name, what)
    return out


def parse_rdk_params(payload: Any) -> dict[str, Any]:
    """The rdk params answer (``{"params": ParamsView}``) as ``MsgUpdateParams`` fields."""
    what = "rdk params"
    p = _unwrap(payload, what)
    out: dict[str, Any] = {}
    for name in RDK_UPDATE_PARAMS_FIELDS:
        raw = _get(p, name)
        if name == "rollup_creation_burn_rate":
            out[name] = "" if raw is None else str(raw)
        else:
            out[name] = _as_uint(raw, name, what)
    return out


def parse_svm_params(payload: Any) -> dict[str, Any]:
    """An svm params object (``{"params": {...}}`` or the bare ``SVMParams``) as a
    mapping of every ``SVMParams`` field."""
    what = "svm params"
    p = _unwrap(payload, what)
    out: dict[str, Any] = {}
    for name in SVM_PARAMS_FIELDS:
        raw = _get(p, name)
        if name == "enabled":
            out[name] = raw is True
        elif name == "rent_exemption_multi":
            if raw is None or raw == "":
                raise ValueError(f"{what}: rent_exemption_multi is missing from the answer")
            out[name] = str(raw)
        else:
            out[name] = _as_uint(raw, name, what)
    return out


def crossvm_update_params_from_current(
    rest: Any, *, authority: str, changes: Mapping[str, Any] | None = None
) -> Msg:
    """Build a crossvm ``MsgUpdateParams`` from the parameters in force plus
    ``changes`` (the way to build a crossvm params proposal).

    :param rest: A :class:`~qorsdk.rest.RestClient` (anything with ``get``).
    :param authority: The governance module account.
    :param changes: Field name to new value; any other field keeps its value.
    """
    from .messages.qorechain import crossvm

    current = parse_crossvm_params(rest.get(CROSSVM_PARAMS_PATH))
    fields = _apply_changes("crossvm update_params", current, changes, CROSSVM_UPDATE_PARAMS_FIELDS)
    return crossvm.update_params(authority=authority, **fields)  # type: ignore[no-any-return]


async def crossvm_update_params_from_current_async(
    rest: Any, *, authority: str, changes: Mapping[str, Any] | None = None
) -> Msg:
    """Asynchronous mirror of :func:`crossvm_update_params_from_current`."""
    from .messages.qorechain import crossvm

    current = parse_crossvm_params(await rest.get(CROSSVM_PARAMS_PATH))
    fields = _apply_changes("crossvm update_params", current, changes, CROSSVM_UPDATE_PARAMS_FIELDS)
    return crossvm.update_params(authority=authority, **fields)  # type: ignore[no-any-return]


def rdk_update_params_from_current(
    rest: Any, *, authority: str, changes: Mapping[str, Any] | None = None
) -> Msg:
    """Build an rdk ``MsgUpdateParams`` from ``/qorechain/rdk/v1/params`` plus
    ``changes`` (the way to build an rdk params proposal)."""
    from .messages.qorechain import rdk

    current = parse_rdk_params(rest.get(RDK_PARAMS_PATH))
    fields = _apply_changes("rdk update_params", current, changes, RDK_UPDATE_PARAMS_FIELDS)
    return rdk.update_params(authority=authority, **fields)  # type: ignore[no-any-return]


async def rdk_update_params_from_current_async(
    rest: Any, *, authority: str, changes: Mapping[str, Any] | None = None
) -> Msg:
    """Asynchronous mirror of :func:`rdk_update_params_from_current`."""
    from .messages.qorechain import rdk

    current = parse_rdk_params(await rest.get(RDK_PARAMS_PATH))
    fields = _apply_changes("rdk update_params", current, changes, RDK_UPDATE_PARAMS_FIELDS)
    return rdk.update_params(authority=authority, **fields)  # type: ignore[no-any-return]


def svm_update_params_from_current(
    rest: Any,
    *,
    authority: str,
    changes: Mapping[str, Any] | None = None,
    current: Mapping[str, Any] | None = None,
) -> Msg:
    """Build an svm ``MsgUpdateParams`` from the current ``SVMParams`` plus
    ``changes`` (the way to build an svm params proposal).

    Reads ``/qorechain/svm/v1/params`` (served from chain v3.2.8; ``enabled``
    is reported as in force). A node before v3.2.8 answers "Not Implemented";
    then pass the current parameters as ``current`` (every field) and ``rest``
    is not used.
    """
    from .messages.qorechain import svm

    base = parse_svm_params(current if current is not None else rest.get(SVM_PARAMS_PATH))
    params = _apply_changes("svm update_params", base, changes, SVM_PARAMS_FIELDS)
    return svm.update_params(authority=authority, params=params)  # type: ignore[no-any-return]


async def svm_update_params_from_current_async(
    rest: Any,
    *,
    authority: str,
    changes: Mapping[str, Any] | None = None,
    current: Mapping[str, Any] | None = None,
) -> Msg:
    """Asynchronous mirror of :func:`svm_update_params_from_current`."""
    from .messages.qorechain import svm

    base = parse_svm_params(current if current is not None else await rest.get(SVM_PARAMS_PATH))
    params = _apply_changes("svm update_params", base, changes, SVM_PARAMS_FIELDS)
    return svm.update_params(authority=authority, params=params)  # type: ignore[no-any-return]


__all__ = [
    "UPDATE_CROSSVM_PARAMS_TYPE_URL",
    "UPDATE_RDK_PARAMS_TYPE_URL",
    "CROSSVM_MAX_MESSAGE_SIZE",
    "CROSSVM_MAX_QUEUE_SIZE",
    "CROSSVM_MAX_QUEUE_TIMEOUT_BLOCKS",
    "CROSSVM_MAX_BRIDGE_ALLOWED_TARGETS",
    "CROSSVM_MAX_BRIDGE_ALLOWED_TARGET_SIZE",
    "RDK_MIN_CHALLENGE_WINDOW_SEC",
    "RDK_MAX_CHALLENGE_WINDOW_SEC",
    "RDK_MAX_DA_BLOB_SIZE",
    "validate_crossvm_update_params",
    "validate_rdk_update_params",
    "UPDATE_SVM_PARAMS_TYPE_URL",
    "CROSSVM_UPDATE_PARAMS_FIELDS",
    "RDK_UPDATE_PARAMS_FIELDS",
    "SVM_PARAMS_FIELDS",
    "CROSSVM_PARAMS_PATH",
    "SVM_PARAMS_PATH",
    "RDK_PARAMS_PATH",
    "require_fields",
    "validate_crossvm_target_pins",
    "validate_svm_params",
    "parse_crossvm_params",
    "parse_rdk_params",
    "parse_svm_params",
    "crossvm_update_params_from_current",
    "crossvm_update_params_from_current_async",
    "rdk_update_params_from_current",
    "rdk_update_params_from_current_async",
    "svm_update_params_from_current",
    "svm_update_params_from_current_async",
]
