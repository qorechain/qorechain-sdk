from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PQCMultisigSignature(_message.Message):
    __slots__ = ("algorithm_id", "bitmap", "signatures")
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    BITMAP_FIELD_NUMBER: _ClassVar[int]
    SIGNATURES_FIELD_NUMBER: _ClassVar[int]
    algorithm_id: int
    bitmap: bytes
    signatures: _containers.RepeatedScalarFieldContainer[bytes]
    def __init__(self, algorithm_id: _Optional[int] = ..., bitmap: _Optional[bytes] = ..., signatures: _Optional[_Iterable[bytes]] = ...) -> None: ...

class MsgRegisterPQCMultisig(_message.Message):
    __slots__ = ("sender", "algorithm_id", "threshold", "public_keys", "proofs_of_possession")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEYS_FIELD_NUMBER: _ClassVar[int]
    PROOFS_OF_POSSESSION_FIELD_NUMBER: _ClassVar[int]
    sender: str
    algorithm_id: int
    threshold: int
    public_keys: _containers.RepeatedScalarFieldContainer[bytes]
    proofs_of_possession: _containers.RepeatedScalarFieldContainer[bytes]
    def __init__(self, sender: _Optional[str] = ..., algorithm_id: _Optional[int] = ..., threshold: _Optional[int] = ..., public_keys: _Optional[_Iterable[bytes]] = ..., proofs_of_possession: _Optional[_Iterable[bytes]] = ...) -> None: ...

class MsgRegisterPQCMultisigResponse(_message.Message):
    __slots__ = ("version",)
    VERSION_FIELD_NUMBER: _ClassVar[int]
    version: int
    def __init__(self, version: _Optional[int] = ...) -> None: ...

class QueryMultisigRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryMultisigResponse(_message.Message):
    __slots__ = ("found", "multisig")
    FOUND_FIELD_NUMBER: _ClassVar[int]
    MULTISIG_FIELD_NUMBER: _ClassVar[int]
    found: bool
    multisig: PQCMultisigView
    def __init__(self, found: bool = ..., multisig: _Optional[_Union[PQCMultisigView, _Mapping]] = ...) -> None: ...

class PQCMultisigView(_message.Message):
    __slots__ = ("address", "algorithm_id", "algorithm_name", "threshold", "public_keys", "created_at_height", "updated_at_height", "version", "members")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_NAME_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEYS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    address: str
    algorithm_id: int
    algorithm_name: str
    threshold: int
    public_keys: _containers.RepeatedScalarFieldContainer[bytes]
    created_at_height: int
    updated_at_height: int
    version: int
    members: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, address: _Optional[str] = ..., algorithm_id: _Optional[int] = ..., algorithm_name: _Optional[str] = ..., threshold: _Optional[int] = ..., public_keys: _Optional[_Iterable[bytes]] = ..., created_at_height: _Optional[int] = ..., updated_at_height: _Optional[int] = ..., version: _Optional[int] = ..., members: _Optional[_Iterable[str]] = ...) -> None: ...
