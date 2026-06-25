from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgGrantLicense(_message.Message):
    __slots__ = ("authority", "grantee", "feature_id", "expires_at", "metadata")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    authority: str
    grantee: str
    feature_id: str
    expires_at: int
    metadata: str
    def __init__(self, authority: _Optional[str] = ..., grantee: _Optional[str] = ..., feature_id: _Optional[str] = ..., expires_at: _Optional[int] = ..., metadata: _Optional[str] = ...) -> None: ...

class MsgGrantLicenseResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRevokeLicense(_message.Message):
    __slots__ = ("authority", "grantee", "feature_id")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    authority: str
    grantee: str
    feature_id: str
    def __init__(self, authority: _Optional[str] = ..., grantee: _Optional[str] = ..., feature_id: _Optional[str] = ...) -> None: ...

class MsgRevokeLicenseResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgSuspendLicense(_message.Message):
    __slots__ = ("authority", "grantee", "feature_id")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    authority: str
    grantee: str
    feature_id: str
    def __init__(self, authority: _Optional[str] = ..., grantee: _Optional[str] = ..., feature_id: _Optional[str] = ...) -> None: ...

class MsgSuspendLicenseResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgResumeLicense(_message.Message):
    __slots__ = ("authority", "grantee", "feature_id")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    authority: str
    grantee: str
    feature_id: str
    def __init__(self, authority: _Optional[str] = ..., grantee: _Optional[str] = ..., feature_id: _Optional[str] = ...) -> None: ...

class MsgResumeLicenseResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
