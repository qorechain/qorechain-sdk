"""Client-side checks for the governance messages added in chain v3.2.5.

``MsgUpdateParams`` of ``x/crossvm`` and ``x/rdk`` and ``MsgUpdateConfig`` of
``x/abstractaccount`` replace a module's settings wholesale, and only execute
from a passed proposal (``authority`` is the governance module account). A
proposal copies the current values from the module's params query and changes
only what it means to change. The checks below mirror the chain's, so a
proposal that would fail on execution is refused before it is submitted.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from .address import is_valid_bech32

#: Type URLs.
UPDATE_CROSSVM_PARAMS_TYPE_URL = "/qorechain.crossvm.v1.MsgUpdateParams"
UPDATE_RDK_PARAMS_TYPE_URL = "/qorechain.rdk.v1.MsgUpdateParams"

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
]
