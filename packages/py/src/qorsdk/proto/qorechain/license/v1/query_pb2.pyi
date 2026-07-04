from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LicenseView(_message.Message):
    __slots__ = ("grantee", "feature_id", "expires_at", "granted_at", "granted_by", "suspended", "metadata")
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    GRANTED_AT_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_FIELD_NUMBER: _ClassVar[int]
    SUSPENDED_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    grantee: str
    feature_id: str
    expires_at: int
    granted_at: int
    granted_by: str
    suspended: bool
    metadata: str
    def __init__(self, grantee: _Optional[str] = ..., feature_id: _Optional[str] = ..., expires_at: _Optional[int] = ..., granted_at: _Optional[int] = ..., granted_by: _Optional[str] = ..., suspended: bool = ..., metadata: _Optional[str] = ...) -> None: ...

class QueryCheckRequest(_message.Message):
    __slots__ = ("grantee", "feature_id")
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    grantee: str
    feature_id: str
    def __init__(self, grantee: _Optional[str] = ..., feature_id: _Optional[str] = ...) -> None: ...

class QueryCheckResponse(_message.Message):
    __slots__ = ("license", "active")
    LICENSE_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    license: LicenseView
    active: bool
    def __init__(self, license: _Optional[_Union[LicenseView, _Mapping]] = ..., active: bool = ...) -> None: ...

class QueryHoldersRequest(_message.Message):
    __slots__ = ("feature_id",)
    FEATURE_ID_FIELD_NUMBER: _ClassVar[int]
    feature_id: str
    def __init__(self, feature_id: _Optional[str] = ...) -> None: ...

class QueryHoldersResponse(_message.Message):
    __slots__ = ("licenses",)
    LICENSES_FIELD_NUMBER: _ClassVar[int]
    licenses: _containers.RepeatedCompositeFieldContainer[LicenseView]
    def __init__(self, licenses: _Optional[_Iterable[_Union[LicenseView, _Mapping]]] = ...) -> None: ...

class QueryListRequest(_message.Message):
    __slots__ = ("grantee",)
    GRANTEE_FIELD_NUMBER: _ClassVar[int]
    grantee: str
    def __init__(self, grantee: _Optional[str] = ...) -> None: ...

class QueryListResponse(_message.Message):
    __slots__ = ("licenses",)
    LICENSES_FIELD_NUMBER: _ClassVar[int]
    licenses: _containers.RepeatedCompositeFieldContainer[LicenseView]
    def __init__(self, licenses: _Optional[_Iterable[_Union[LicenseView, _Mapping]]] = ...) -> None: ...
