from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgUpdateQDRWConfig(_message.Message):
    __slots__ = ("authority", "enabled", "rep_min_multiplier", "rep_max_multiplier")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    REP_MIN_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    REP_MAX_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    authority: str
    enabled: bool
    rep_min_multiplier: str
    rep_max_multiplier: str
    def __init__(self, authority: _Optional[str] = ..., enabled: bool = ..., rep_min_multiplier: _Optional[str] = ..., rep_max_multiplier: _Optional[str] = ...) -> None: ...

class MsgUpdateQDRWConfigResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
