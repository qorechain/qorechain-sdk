from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgLockDelegation(_message.Message):
    __slots__ = ("delegator", "validator", "amount", "months")
    DELEGATOR_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    delegator: str
    validator: str
    amount: str
    months: int
    def __init__(self, delegator: _Optional[str] = ..., validator: _Optional[str] = ..., amount: _Optional[str] = ..., months: _Optional[int] = ...) -> None: ...

class MsgLockDelegationResponse(_message.Message):
    __slots__ = ("lock_id", "end_time")
    LOCK_ID_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    lock_id: int
    end_time: int
    def __init__(self, lock_id: _Optional[int] = ..., end_time: _Optional[int] = ...) -> None: ...

class MsgUnlockEarly(_message.Message):
    __slots__ = ("delegator", "lock_id")
    DELEGATOR_FIELD_NUMBER: _ClassVar[int]
    LOCK_ID_FIELD_NUMBER: _ClassVar[int]
    delegator: str
    lock_id: int
    def __init__(self, delegator: _Optional[str] = ..., lock_id: _Optional[int] = ...) -> None: ...

class MsgUnlockEarlyResponse(_message.Message):
    __slots__ = ("penalty_burned", "bonus_forfeited")
    PENALTY_BURNED_FIELD_NUMBER: _ClassVar[int]
    BONUS_FORFEITED_FIELD_NUMBER: _ClassVar[int]
    penalty_burned: str
    bonus_forfeited: str
    def __init__(self, penalty_burned: _Optional[str] = ..., bonus_forfeited: _Optional[str] = ...) -> None: ...

class MsgClaimBonus(_message.Message):
    __slots__ = ("holder",)
    HOLDER_FIELD_NUMBER: _ClassVar[int]
    holder: str
    def __init__(self, holder: _Optional[str] = ...) -> None: ...

class MsgClaimBonusResponse(_message.Message):
    __slots__ = ("amount",)
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    amount: str
    def __init__(self, amount: _Optional[str] = ...) -> None: ...

class LockTierParam(_message.Message):
    __slots__ = ("months", "bonus_bps")
    MONTHS_FIELD_NUMBER: _ClassVar[int]
    BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    months: int
    bonus_bps: int
    def __init__(self, months: _Optional[int] = ..., bonus_bps: _Optional[int] = ...) -> None: ...

class MsgUpdateParams(_message.Message):
    __slots__ = ("authority", "lock_tiers", "light_node_bonus_bps", "validator_bonus_bps", "max_total_apy_bps", "early_unlock_penalty_bps", "enabled", "min_lock_amount")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    LOCK_TIERS_FIELD_NUMBER: _ClassVar[int]
    LIGHT_NODE_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_BONUS_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_TOTAL_APY_BPS_FIELD_NUMBER: _ClassVar[int]
    EARLY_UNLOCK_PENALTY_BPS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    MIN_LOCK_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    authority: str
    lock_tiers: _containers.RepeatedCompositeFieldContainer[LockTierParam]
    light_node_bonus_bps: int
    validator_bonus_bps: int
    max_total_apy_bps: int
    early_unlock_penalty_bps: int
    enabled: bool
    min_lock_amount: str
    def __init__(self, authority: _Optional[str] = ..., lock_tiers: _Optional[_Iterable[_Union[LockTierParam, _Mapping]]] = ..., light_node_bonus_bps: _Optional[int] = ..., validator_bonus_bps: _Optional[int] = ..., max_total_apy_bps: _Optional[int] = ..., early_unlock_penalty_bps: _Optional[int] = ..., enabled: bool = ..., min_lock_amount: _Optional[str] = ...) -> None: ...

class MsgUpdateParamsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
