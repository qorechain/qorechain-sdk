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

class AprBase(_message.Message):
    __slots__ = ("gross_base_apr_bps", "computed_height", "computed_time", "source", "last_owed", "last_funded", "bonus_funding_ratio", "bonus_enabled", "max_total_apy_bps")
    GROSS_BASE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    COMPUTED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    COMPUTED_TIME_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    LAST_OWED_FIELD_NUMBER: _ClassVar[int]
    LAST_FUNDED_FIELD_NUMBER: _ClassVar[int]
    BONUS_FUNDING_RATIO_FIELD_NUMBER: _ClassVar[int]
    BONUS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    MAX_TOTAL_APY_BPS_FIELD_NUMBER: _ClassVar[int]
    gross_base_apr_bps: str
    computed_height: int
    computed_time: int
    source: str
    last_owed: str
    last_funded: str
    bonus_funding_ratio: str
    bonus_enabled: bool
    max_total_apy_bps: int
    def __init__(self, gross_base_apr_bps: _Optional[str] = ..., computed_height: _Optional[int] = ..., computed_time: _Optional[int] = ..., source: _Optional[str] = ..., last_owed: _Optional[str] = ..., last_funded: _Optional[str] = ..., bonus_funding_ratio: _Optional[str] = ..., bonus_enabled: bool = ..., max_total_apy_bps: _Optional[int] = ...) -> None: ...

class QueryAprRequest(_message.Message):
    __slots__ = ("validator",)
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    validator: str
    def __init__(self, validator: _Optional[str] = ...) -> None: ...

class TierAprView(_message.Message):
    __slots__ = ("months", "bonus_bps", "effective_bonus_bps", "effective_apr_bps")
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    months: int
    bonus_bps: int
    effective_bonus_bps: str
    effective_apr_bps: str
    def __init__(self, months: _Optional[int] = ..., bonus_bps: _Optional[int] = ..., effective_bonus_bps: _Optional[str] = ..., effective_apr_bps: _Optional[str] = ...) -> None: ...

class QueryAprResponse(_message.Message):
    __slots__ = ("base", "validator", "commission", "base_apr_bps", "tiers", "light_node_bonus_bps", "validator_bonus_bps", "validator_effective_bonus_bps")
    BASE_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    COMMISSION_FIELD_NUMBER: _ClassVar[int]
    BASE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    TIERS_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_EFFECTIVE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    base: AprBase
    validator: str
    commission: str
    base_apr_bps: str
    tiers: _containers.RepeatedCompositeFieldContainer[TierAprView]
    light_node_bonus_bps: int
    validator_bonus_bps: int
    validator_effective_bonus_bps: str
    def __init__(self, base: _Optional[_Union[AprBase, _Mapping]] = ..., validator: _Optional[str] = ..., commission: _Optional[str] = ..., base_apr_bps: _Optional[str] = ..., tiers: _Optional[_Iterable[_Union[TierAprView, _Mapping]]] = ..., light_node_bonus_bps: _Optional[int] = ..., validator_bonus_bps: _Optional[int] = ..., validator_effective_bonus_bps: _Optional[str] = ...) -> None: ...

class QueryDelegatorAprRequest(_message.Message):
    __slots__ = ("delegator", "validator")
    DELEGATOR_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    delegator: str
    validator: str
    def __init__(self, delegator: _Optional[str] = ..., validator: _Optional[str] = ...) -> None: ...

class AprPosition(_message.Message):
    __slots__ = ("kind", "lock_id", "months", "end_time", "amount", "base_apr_bps", "tier_bonus_bps", "light_node_bonus_bps", "lock_bonus_bps", "validator_bonus_bps", "bonus_bps", "effective_apr_bps", "effective_apr_at_last_funding_bps", "capped", "reason")
    KIND_FIELD_NUMBER: _ClassVar[int]
    LOCK_ID_FIELD_NUMBER: _ClassVar[int]
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    BASE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    TIER_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    LOCK_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_AT_LAST_FUNDING_BPS_FIELD_NUMBER: _ClassVar[int]
    CAPPED_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    kind: str
    lock_id: int
    months: int
    end_time: int
    amount: str
    base_apr_bps: str
    tier_bonus_bps: int
    light_node_bonus_bps: int
    lock_bonus_bps: str
    validator_bonus_bps: str
    bonus_bps: str
    effective_apr_bps: str
    effective_apr_at_last_funding_bps: str
    capped: bool
    reason: str
    def __init__(self, kind: _Optional[str] = ..., lock_id: _Optional[int] = ..., months: _Optional[int] = ..., end_time: _Optional[int] = ..., amount: _Optional[str] = ..., base_apr_bps: _Optional[str] = ..., tier_bonus_bps: _Optional[int] = ..., light_node_bonus_bps: _Optional[int] = ..., lock_bonus_bps: _Optional[str] = ..., validator_bonus_bps: _Optional[str] = ..., bonus_bps: _Optional[str] = ..., effective_apr_bps: _Optional[str] = ..., effective_apr_at_last_funding_bps: _Optional[str] = ..., capped: bool = ..., reason: _Optional[str] = ...) -> None: ...

class DelegationApr(_message.Message):
    __slots__ = ("validator", "commission", "validator_active", "self_bond", "delegated_amount", "locked_amount", "effective_apr_bps", "effective_apr_at_last_funding_bps", "positions")
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    COMMISSION_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    SELF_BOND_FIELD_NUMBER: _ClassVar[int]
    DELEGATED_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    LOCKED_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_AT_LAST_FUNDING_BPS_FIELD_NUMBER: _ClassVar[int]
    POSITIONS_FIELD_NUMBER: _ClassVar[int]
    validator: str
    commission: str
    validator_active: bool
    self_bond: bool
    delegated_amount: str
    locked_amount: str
    effective_apr_bps: str
    effective_apr_at_last_funding_bps: str
    positions: _containers.RepeatedCompositeFieldContainer[AprPosition]
    def __init__(self, validator: _Optional[str] = ..., commission: _Optional[str] = ..., validator_active: bool = ..., self_bond: bool = ..., delegated_amount: _Optional[str] = ..., locked_amount: _Optional[str] = ..., effective_apr_bps: _Optional[str] = ..., effective_apr_at_last_funding_bps: _Optional[str] = ..., positions: _Optional[_Iterable[_Union[AprPosition, _Mapping]]] = ...) -> None: ...

class QueryDelegatorAprResponse(_message.Message):
    __slots__ = ("delegator", "base", "light_node_bonus", "light_node_reason", "delegations", "total_delegated", "effective_apr_bps", "effective_apr_at_last_funding_bps")
    DELEGATOR_FIELD_NUMBER: _ClassVar[int]
    BASE_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_REASON_FIELD_NUMBER: _ClassVar[int]
    DELEGATIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_DELEGATED_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_BPS_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_APR_AT_LAST_FUNDING_BPS_FIELD_NUMBER: _ClassVar[int]
    delegator: str
    base: AprBase
    light_node_bonus: bool
    light_node_reason: str
    delegations: _containers.RepeatedCompositeFieldContainer[DelegationApr]
    total_delegated: str
    effective_apr_bps: str
    effective_apr_at_last_funding_bps: str
    def __init__(self, delegator: _Optional[str] = ..., base: _Optional[_Union[AprBase, _Mapping]] = ..., light_node_bonus: bool = ..., light_node_reason: _Optional[str] = ..., delegations: _Optional[_Iterable[_Union[DelegationApr, _Mapping]]] = ..., total_delegated: _Optional[str] = ..., effective_apr_bps: _Optional[str] = ..., effective_apr_at_last_funding_bps: _Optional[str] = ...) -> None: ...
