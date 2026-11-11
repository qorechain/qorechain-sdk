from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EVMLimits(_message.Message):
    __slots__ = ("tx_max_gas", "precompile_input_max_bytes")
    TX_MAX_GAS_FIELD_NUMBER: _ClassVar[int]
    PRECOMPILE_INPUT_MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    tx_max_gas: int
    precompile_input_max_bytes: int
    def __init__(self, tx_max_gas: _Optional[int] = ..., precompile_input_max_bytes: _Optional[int] = ...) -> None: ...

class MsgUpdateEVMLimits(_message.Message):
    __slots__ = ("authority", "limits")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    LIMITS_FIELD_NUMBER: _ClassVar[int]
    authority: str
    limits: EVMLimits
    def __init__(self, authority: _Optional[str] = ..., limits: _Optional[_Union[EVMLimits, _Mapping]] = ...) -> None: ...

class MsgUpdateEVMLimitsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryEVMLimitsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryEVMLimitsResponse(_message.Message):
    __slots__ = ("limits", "tx_max_gas", "precompile_input_max_bytes")
    LIMITS_FIELD_NUMBER: _ClassVar[int]
    TX_MAX_GAS_FIELD_NUMBER: _ClassVar[int]
    PRECOMPILE_INPUT_MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    limits: EVMLimits
    tx_max_gas: int
    precompile_input_max_bytes: int
    def __init__(self, limits: _Optional[_Union[EVMLimits, _Mapping]] = ..., tx_max_gas: _Optional[int] = ..., precompile_input_max_bytes: _Optional[int] = ...) -> None: ...
