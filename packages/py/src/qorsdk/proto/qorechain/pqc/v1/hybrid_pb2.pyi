from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class PQCHybridSignature(_message.Message):
    __slots__ = ("algorithm_id", "pqc_signature", "pqc_public_key")
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    PQC_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    PQC_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    algorithm_id: int
    pqc_signature: bytes
    pqc_public_key: bytes
    def __init__(self, algorithm_id: _Optional[int] = ..., pqc_signature: _Optional[bytes] = ..., pqc_public_key: _Optional[bytes] = ...) -> None: ...
