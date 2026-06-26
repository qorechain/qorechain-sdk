from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SpendingRule(_message.Message):
    __slots__ = ("id", "daily_limit", "per_tx_limit", "allowed_denoms", "enabled")
    ID_FIELD_NUMBER: _ClassVar[int]
    DAILY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    PER_TX_LIMIT_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_DENOMS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    id: str
    daily_limit: int
    per_tx_limit: int
    allowed_denoms: _containers.RepeatedScalarFieldContainer[str]
    enabled: bool
    def __init__(self, id: _Optional[str] = ..., daily_limit: _Optional[int] = ..., per_tx_limit: _Optional[int] = ..., allowed_denoms: _Optional[_Iterable[str]] = ..., enabled: bool = ...) -> None: ...

class MsgCreateAbstractAccount(_message.Message):
    __slots__ = ("owner", "account_type")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_TYPE_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_type: str
    def __init__(self, owner: _Optional[str] = ..., account_type: _Optional[str] = ...) -> None: ...

class MsgCreateAbstractAccountResponse(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class MsgUpdateSpendingRules(_message.Message):
    __slots__ = ("owner", "account_address", "rules")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    RULES_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_address: str
    rules: _containers.RepeatedCompositeFieldContainer[SpendingRule]
    def __init__(self, owner: _Optional[str] = ..., account_address: _Optional[str] = ..., rules: _Optional[_Iterable[_Union[SpendingRule, _Mapping]]] = ...) -> None: ...

class MsgUpdateSpendingRulesResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
