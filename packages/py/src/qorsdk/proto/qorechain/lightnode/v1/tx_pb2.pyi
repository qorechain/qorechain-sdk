from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgRegisterLightNode(_message.Message):
    __slots__ = ("operator", "node_type", "version", "capabilities")
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    operator: str
    node_type: str
    version: str
    capabilities: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, operator: _Optional[str] = ..., node_type: _Optional[str] = ..., version: _Optional[str] = ..., capabilities: _Optional[_Iterable[str]] = ...) -> None: ...

class MsgRegisterLightNodeResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgHeartbeat(_message.Message):
    __slots__ = ("operator",)
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    operator: str
    def __init__(self, operator: _Optional[str] = ...) -> None: ...

class MsgHeartbeatResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgDeregisterLightNode(_message.Message):
    __slots__ = ("operator",)
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    operator: str
    def __init__(self, operator: _Optional[str] = ...) -> None: ...

class MsgDeregisterLightNodeResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgClaimLightNodeRewards(_message.Message):
    __slots__ = ("operator",)
    OPERATOR_FIELD_NUMBER: _ClassVar[int]
    operator: str
    def __init__(self, operator: _Optional[str] = ...) -> None: ...

class MsgClaimLightNodeRewardsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgReleaseLightNodeReserve(_message.Message):
    __slots__ = ("authority", "amount", "destination")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    DESTINATION_FIELD_NUMBER: _ClassVar[int]
    authority: str
    amount: str
    destination: str
    def __init__(self, authority: _Optional[str] = ..., amount: _Optional[str] = ..., destination: _Optional[str] = ...) -> None: ...

class MsgReleaseLightNodeReserveResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
