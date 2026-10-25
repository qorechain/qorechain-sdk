"""Staking tiers (chain v3.2.4, ``x/stakingtier``).

A delegator locks part of an existing delegation for 3, 6 or 12 months and earns
a bonus on top of the staking reward (the terms and bonus rates are governance
parameters, read them with :func:`fetch_staking_tier_params`). Running a light
node or a validator adds to the bonus, up to a total cap. Leaving a lock early
burns a penalty and forfeits the bonus.

Messages: :data:`qorsdk.msg.stakingtier` (``lock_delegation``,
``unlock_early``, ``claim_bonus``, ``update_params``). Reads (REST):
:func:`fetch_staking_tier_params`, :func:`fetch_staking_locks`,
:func:`fetch_staking_tier_pool`.

Every integer the chain renders as a JSON string (amounts, ids, heights, times)
is parsed into an exact Python ``int``; decimal strings stay strings.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import quote

#: The lock terms the chain accepts (``AllowedLockMonths``).
STAKING_LOCK_MONTHS: tuple[int, ...] = (3, 6, 12)

#: Type URLs of the module's messages.
LOCK_DELEGATION_TYPE_URL = "/qorechain.stakingtier.v1.MsgLockDelegation"
UNLOCK_EARLY_TYPE_URL = "/qorechain.stakingtier.v1.MsgUnlockEarly"
CLAIM_BONUS_TYPE_URL = "/qorechain.stakingtier.v1.MsgClaimBonus"
UPDATE_STAKING_TIER_PARAMS_TYPE_URL = "/qorechain.stakingtier.v1.MsgUpdateParams"

_DIGITS = re.compile(r"^\d+$")


def validate_lock_delegation(
    *, delegator: str, validator: str, amount: str, months: int
) -> None:
    """The chain's stateless checks on ``MsgLockDelegation``, run by
    ``msg.stakingtier.lock_delegation`` before encoding.

    ``amount`` is a positive integer string in base units (uqor); ``months`` is
    one of :data:`STAKING_LOCK_MONTHS`.

    :raises ValueError: Naming the field.
    """
    if not delegator:
        raise ValueError("lock_delegation: delegator is required")
    if not validator:
        raise ValueError("lock_delegation: validator is required")
    if not isinstance(amount, str) or not _DIGITS.match(amount) or int(amount) <= 0:
        raise ValueError(
            "lock_delegation: amount must be a positive integer in base units, "
            f"got {amount!r}"
        )
    if (
        not isinstance(months, int)
        or isinstance(months, bool)
        or months not in STAKING_LOCK_MONTHS
    ):
        raise ValueError(
            "lock_delegation: months must be one of "
            f"{', '.join(str(m) for m in STAKING_LOCK_MONTHS)}, got {months!r}"
        )


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #

#: REST path of the module parameters.
STAKING_TIER_PARAMS_PATH = "/qorechain/stakingtier/v1/params"

#: REST path of the bonus pool.
STAKING_TIER_POOL_PATH = "/qorechain/stakingtier/v1/pool"


def staking_locks_path(holder: str) -> str:
    """The REST path of ``holder``'s locks."""
    return f"/qorechain/stakingtier/v1/locks/{quote(holder, safe='')}"


@dataclass(frozen=True)
class StakingLockTier:
    """One offered term and its bonus."""

    months: int
    #: Bonus in basis points of APY.
    bonus_bps: int


@dataclass(frozen=True)
class StakingTierParams:
    """Module parameters (``/qorechain/stakingtier/v1/params``)."""

    #: Offered terms and their bonus.
    lock_tiers: tuple[StakingLockTier, ...]
    #: Extra bonus for a holder that runs an active light node.
    light_node_bonus_bps: int
    #: Extra bonus for a holder that runs a validator.
    validator_bonus_bps: int
    #: Cap on the total yield (staking reward plus every bonus).
    max_total_apy_bps: int
    #: Share of the locked amount burned on an early unlock.
    early_unlock_penalty_bps: int
    #: Whether governance has the module switched on.
    enabled: bool
    #: Smallest lock, in base units.
    min_lock_amount: int


@dataclass(frozen=True)
class StakingLock:
    """One lock (``/qorechain/stakingtier/v1/locks/{holder}``)."""

    id: int
    validator: str
    locked_amount: int
    locked_shares: str
    months: int
    tier_bonus_bps: int
    start_height: int
    #: Unix seconds.
    start_time: int
    #: Unix seconds; the lock is released at this block time.
    end_time: int
    accrued_bonus: int
    released: bool
    light_node_bonus_bps: int
    validator_bonus_bps: int
    #: Decimal string.
    projected_bonus_bps: str
    projected_bonus_to_expiry: int


@dataclass(frozen=True)
class StakingLocks:
    """A holder's locks and claimable bonus."""

    locks: tuple[StakingLock, ...]
    claimable: int
    total_claimable: int


@dataclass(frozen=True)
class StakingTierPool:
    """The bonus pool (``/qorechain/stakingtier/v1/pool``)."""

    balance: int
    outstanding: int
    surplus: int
    total_minted: int
    total_paid: int
    total_forfeited: int
    total_penalty_burned: int
    last_settle_time: int
    last_settle_height: int
    #: Decimal string.
    last_base_apy_bps: str
    lock_count: int


def _int(payload: Mapping[str, Any], field: str) -> int:
    """An exact integer from a field the chain renders as a string or a number."""
    raw = payload.get(field)
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError(f"stakingtier field {field!r} is a boolean, expected an integer")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip(), 10)
        except ValueError:
            raise ValueError(f"stakingtier field {field!r} is not an integer: {raw!r}") from None
    raise ValueError(f"stakingtier field {field!r} is not an integer: {raw!r}")


def _str(payload: Mapping[str, Any], field: str) -> str:
    raw = payload.get(field)
    return raw if isinstance(raw, str) else ""


def _list(payload: Mapping[str, Any], field: str) -> list[Mapping[str, Any]]:
    raw = payload.get(field)
    return [x for x in raw if isinstance(x, Mapping)] if isinstance(raw, list) else []


def parse_staking_tier_params(payload: Mapping[str, Any]) -> StakingTierParams:
    """Parse a ``params`` REST payload."""
    return StakingTierParams(
        lock_tiers=tuple(
            StakingLockTier(months=_int(t, "months"), bonus_bps=_int(t, "bonus_bps"))
            for t in _list(payload, "lock_tiers")
        ),
        light_node_bonus_bps=_int(payload, "light_node_bonus_bps"),
        validator_bonus_bps=_int(payload, "validator_bonus_bps"),
        max_total_apy_bps=_int(payload, "max_total_apy_bps"),
        early_unlock_penalty_bps=_int(payload, "early_unlock_penalty_bps"),
        enabled=payload.get("enabled") is True,
        min_lock_amount=_int(payload, "min_lock_amount"),
    )


def _parse_lock(raw: Mapping[str, Any]) -> StakingLock:
    return StakingLock(
        id=_int(raw, "id"),
        validator=_str(raw, "validator"),
        locked_amount=_int(raw, "locked_amount"),
        locked_shares=_str(raw, "locked_shares"),
        months=_int(raw, "months"),
        tier_bonus_bps=_int(raw, "tier_bonus_bps"),
        start_height=_int(raw, "start_height"),
        start_time=_int(raw, "start_time"),
        end_time=_int(raw, "end_time"),
        accrued_bonus=_int(raw, "accrued_bonus"),
        released=raw.get("released") is True,
        light_node_bonus_bps=_int(raw, "light_node_bonus_bps"),
        validator_bonus_bps=_int(raw, "validator_bonus_bps"),
        projected_bonus_bps=_str(raw, "projected_bonus_bps"),
        projected_bonus_to_expiry=_int(raw, "projected_bonus_to_expiry"),
    )


def parse_staking_locks(payload: Mapping[str, Any]) -> StakingLocks:
    """Parse a ``locks/{holder}`` REST payload."""
    return StakingLocks(
        locks=tuple(_parse_lock(lock) for lock in _list(payload, "locks")),
        claimable=_int(payload, "claimable"),
        total_claimable=_int(payload, "total_claimable"),
    )


def parse_staking_tier_pool(payload: Mapping[str, Any]) -> StakingTierPool:
    """Parse a ``pool`` REST payload."""
    return StakingTierPool(
        balance=_int(payload, "balance"),
        outstanding=_int(payload, "outstanding"),
        surplus=_int(payload, "surplus"),
        total_minted=_int(payload, "total_minted"),
        total_paid=_int(payload, "total_paid"),
        total_forfeited=_int(payload, "total_forfeited"),
        total_penalty_burned=_int(payload, "total_penalty_burned"),
        last_settle_time=_int(payload, "last_settle_time"),
        last_settle_height=_int(payload, "last_settle_height"),
        last_base_apy_bps=_str(payload, "last_base_apy_bps"),
        lock_count=_int(payload, "lock_count"),
    )


class _RestGet(Protocol):
    def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


class _AsyncRestGet(Protocol):
    async def get(self, path: str, params: dict[str, Any] | None = ...) -> Any: ...


def fetch_staking_tier_params(rest: _RestGet) -> StakingTierParams:
    """Read the module parameters.

    :param rest: A :class:`~qorsdk.rest.RestClient` (or anything with ``get``).
    """
    return parse_staking_tier_params(rest.get(STAKING_TIER_PARAMS_PATH))


def fetch_staking_locks(rest: _RestGet, holder: str) -> StakingLocks:
    """Read ``holder``'s (``qor1…``) locks and claimable bonus."""
    return parse_staking_locks(rest.get(staking_locks_path(holder)))


def fetch_staking_tier_pool(rest: _RestGet) -> StakingTierPool:
    """Read the bonus pool."""
    return parse_staking_tier_pool(rest.get(STAKING_TIER_POOL_PATH))


async def fetch_staking_tier_params_async(rest: _AsyncRestGet) -> StakingTierParams:
    """Asynchronous mirror of :func:`fetch_staking_tier_params`."""
    return parse_staking_tier_params(await rest.get(STAKING_TIER_PARAMS_PATH))


async def fetch_staking_locks_async(rest: _AsyncRestGet, holder: str) -> StakingLocks:
    """Asynchronous mirror of :func:`fetch_staking_locks`."""
    return parse_staking_locks(await rest.get(staking_locks_path(holder)))


async def fetch_staking_tier_pool_async(rest: _AsyncRestGet) -> StakingTierPool:
    """Asynchronous mirror of :func:`fetch_staking_tier_pool`."""
    return parse_staking_tier_pool(await rest.get(STAKING_TIER_POOL_PATH))


__all__ = [
    "STAKING_LOCK_MONTHS",
    "LOCK_DELEGATION_TYPE_URL",
    "UNLOCK_EARLY_TYPE_URL",
    "CLAIM_BONUS_TYPE_URL",
    "UPDATE_STAKING_TIER_PARAMS_TYPE_URL",
    "validate_lock_delegation",
    "STAKING_TIER_PARAMS_PATH",
    "STAKING_TIER_POOL_PATH",
    "staking_locks_path",
    "StakingLockTier",
    "StakingTierParams",
    "StakingLock",
    "StakingLocks",
    "StakingTierPool",
    "parse_staking_tier_params",
    "parse_staking_locks",
    "parse_staking_tier_pool",
    "fetch_staking_tier_params",
    "fetch_staking_locks",
    "fetch_staking_tier_pool",
    "fetch_staking_tier_params_async",
    "fetch_staking_locks_async",
    "fetch_staking_tier_pool_async",
]
