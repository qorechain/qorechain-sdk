from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CrossVMMessageView(_message.Message):
    __slots__ = ("id", "source_vm", "target_vm", "sender", "source_contract", "target_contract", "payload_hex", "status", "created_height", "executed_height", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_VM_FIELD_NUMBER: _ClassVar[int]
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    TARGET_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_HEX_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    EXECUTED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    source_vm: str
    target_vm: str
    sender: str
    source_contract: str
    target_contract: str
    payload_hex: str
    status: str
    created_height: int
    executed_height: int
    error: str
    def __init__(self, id: _Optional[str] = ..., source_vm: _Optional[str] = ..., target_vm: _Optional[str] = ..., sender: _Optional[str] = ..., source_contract: _Optional[str] = ..., target_contract: _Optional[str] = ..., payload_hex: _Optional[str] = ..., status: _Optional[str] = ..., created_height: _Optional[int] = ..., executed_height: _Optional[int] = ..., error: _Optional[str] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("max_message_size", "max_queue_size", "queue_timeout_blocks", "enabled")
    MAX_MESSAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    MAX_QUEUE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUEUE_TIMEOUT_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    max_message_size: int
    max_queue_size: int
    queue_timeout_blocks: int
    enabled: bool
    def __init__(self, max_message_size: _Optional[int] = ..., max_queue_size: _Optional[int] = ..., queue_timeout_blocks: _Optional[int] = ..., enabled: bool = ...) -> None: ...

class QueryPendingMessagesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryPendingMessagesResponse(_message.Message):
    __slots__ = ("messages", "count")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[CrossVMMessageView]
    count: int
    def __init__(self, messages: _Optional[_Iterable[_Union[CrossVMMessageView, _Mapping]]] = ..., count: _Optional[int] = ...) -> None: ...

class QueryMessageRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class QueryMessageResponse(_message.Message):
    __slots__ = ("message", "found")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FOUND_FIELD_NUMBER: _ClassVar[int]
    message: CrossVMMessageView
    found: bool
    def __init__(self, message: _Optional[_Union[CrossVMMessageView, _Mapping]] = ..., found: bool = ...) -> None: ...
