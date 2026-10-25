from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class LockTierView(_message.Message):
    __slots__ = ("months", "bonus_bps")
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    months: int
    bonus_bps: int
    def __init__(self, months: _Optional[int] = ..., bonus_bps: _Optional[int] = ...) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("lock_tiers", "light_node_bonus_bps", "validator_bonus_bps", "max_total_apy_bps", "early_unlock_penalty_bps", "enabled", "min_lock_amount")
    LOCK_TIERS_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_TOTAL_APY_BPS_FIELD_NUMBER: _ClassVar[int]
    EARLY_UNLOCK_PENALTY_BPS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    MIN_LOCK_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    lock_tiers: _containers.RepeatedCompositeFieldContainer[LockTierView]
    light_node_bonus_bps: int
    validator_bonus_bps: int
    max_total_apy_bps: int
    early_unlock_penalty_bps: int
    enabled: bool
    min_lock_amount: str
    def __init__(self, lock_tiers: _Optional[_Iterable[_Union[LockTierView, _Mapping]]] = ..., light_node_bonus_bps: _Optional[int] = ..., validator_bonus_bps: _Optional[int] = ..., max_total_apy_bps: _Optional[int] = ..., early_unlock_penalty_bps: _Optional[int] = ..., enabled: bool = ..., min_lock_amount: _Optional[str] = ...) -> None: ...

class QueryLocksRequest(_message.Message):
    __slots__ = ("holder",)
    HOLDER_FIELD_NUMBER: _ClassVar[int]
    holder: str
    def __init__(self, holder: _Optional[str] = ...) -> None: ...

class LockView(_message.Message):
    __slots__ = ("id", "validator", "locked_amount", "locked_shares", "months", "tier_bonus_bps", "start_height", "start_time", "end_time", "accrued_bonus", "released", "light_node_bonus_bps", "validator_bonus_bps", "projected_bonus_bps", "projected_bonus_to_expiry")
    ID_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    LOCKED_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    LOCKED_SHARES_FIELD_NUMBER: _ClassVar[int]
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    TIER_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    START_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    ACCRUED_BONUS_FIELD_NUMBER: _ClassVar[int]
    RELEASED_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    PROJECTED_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    PROJECTED_BONUS_TO_EXPIRY_FIELD_NUMBER: _ClassVar[int]
    id: int
    validator: str
    locked_amount: str
    locked_shares: str
    months: int
    tier_bonus_bps: int
    start_height: int
    start_time: int
    end_time: int
    accrued_bonus: str
    released: bool
    light_node_bonus_bps: int
    validator_bonus_bps: int
    projected_bonus_bps: str
    projected_bonus_to_expiry: str
    def __init__(self, id: _Optional[int] = ..., validator: _Optional[str] = ..., locked_amount: _Optional[str] = ..., locked_shares: _Optional[str] = ..., months: _Optional[int] = ..., tier_bonus_bps: _Optional[int] = ..., start_height: _Optional[int] = ..., start_time: _Optional[int] = ..., end_time: _Optional[int] = ..., accrued_bonus: _Optional[str] = ..., released: bool = ..., light_node_bonus_bps: _Optional[int] = ..., validator_bonus_bps: _Optional[int] = ..., projected_bonus_bps: _Optional[str] = ..., projected_bonus_to_expiry: _Optional[str] = ...) -> None: ...

class QueryLocksResponse(_message.Message):
    __slots__ = ("locks", "claimable", "total_claimable")
    LOCKS_FIELD_NUMBER: _ClassVar[int]
    CLAIMABLE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CLAIMABLE_FIELD_NUMBER: _ClassVar[int]
    locks: _containers.RepeatedCompositeFieldContainer[LockView]
    claimable: str
    total_claimable: str
    def __init__(self, locks: _Optional[_Iterable[_Union[LockView, _Mapping]]] = ..., claimable: _Optional[str] = ..., total_claimable: _Optional[str] = ...) -> None: ...

class QueryPoolRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryPoolResponse(_message.Message):
    __slots__ = ("balance", "outstanding", "surplus", "total_minted", "total_paid", "total_forfeited", "total_penalty_burned", "last_settle_time", "last_settle_height", "last_owed", "last_funded", "last_minted", "last_base_apy_bps", "lock_count")
    BALANCE_FIELD_NUMBER: _ClassVar[int]
    OUTSTANDING_FIELD_NUMBER: _ClassVar[int]
    SURPLUS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_MINTED_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAID_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FORFEITED_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PENALTY_BURNED_FIELD_NUMBER: _ClassVar[int]
    LAST_SETTLE_TIME_FIELD_NUMBER: _ClassVar[int]
    LAST_SETTLE_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    LAST_OWED_FIELD_NUMBER: _ClassVar[int]
    LAST_FUNDED_FIELD_NUMBER: _ClassVar[int]
    LAST_MINTED_FIELD_NUMBER: _ClassVar[int]
    LAST_BASE_APY_BPS_FIELD_NUMBER: _ClassVar[int]
    LOCK_COUNT_FIELD_NUMBER: _ClassVar[int]
    balance: str
    outstanding: str
    surplus: str
    total_minted: str
    total_paid: str
    total_forfeited: str
    total_penalty_burned: str
    last_settle_time: int
    last_settle_height: int
    last_owed: str
    last_funded: str
    last_minted: str
    last_base_apy_bps: str
    lock_count: int
    def __init__(self, balance: _Optional[str] = ..., outstanding: _Optional[str] = ..., surplus: _Optional[str] = ..., total_minted: _Optional[str] = ..., total_paid: _Optional[str] = ..., total_forfeited: _Optional[str] = ..., total_penalty_burned: _Optional[str] = ..., last_settle_time: _Optional[int] = ..., last_settle_height: _Optional[int] = ..., last_owed: _Optional[str] = ..., last_funded: _Optional[str] = ..., last_minted: _Optional[str] = ..., last_base_apy_bps: _Optional[str] = ..., lock_count: _Optional[int] = ...) -> None: ...
