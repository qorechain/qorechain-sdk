from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from cosmos.base.v1beta1 import coin_pb2 as _coin_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgCrossVMCall(_message.Message):
    __slots__ = ("sender", "source_vm", "target_vm", "target_contract", "payload", "funds")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    FUNDS_FIELD_NUMBER: _ClassVar[int]
    sender: str
    source_vm: str
    target_vm: str
    target_contract: str
    payload: bytes
    funds: _containers.RepeatedCompositeFieldContainer[_coin_pb2.Coin]
    def __init__(self, sender: _Optional[str] = ..., source_vm: _Optional[str] = ..., target_vm: _Optional[str] = ..., target_contract: _Optional[str] = ..., payload: _Optional[bytes] = ..., funds: _Optional[_Iterable[_Union[_coin_pb2.Coin, _Mapping]]] = ...) -> None: ...

class MsgCrossVMCallResponse(_message.Message):
    __slots__ = ("message_id",)
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    def __init__(self, message_id: _Optional[str] = ...) -> None: ...

class MsgProcessQueue(_message.Message):
    __slots__ = ("authority",)
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    authority: str
    def __init__(self, authority: _Optional[str] = ...) -> None: ...

class MsgProcessQueueResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
