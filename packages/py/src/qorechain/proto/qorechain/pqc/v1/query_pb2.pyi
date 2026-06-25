from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QueryAccountRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryAccountResponse(_message.Message):
    __slots__ = ("found", "account")
    FOUND_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    found: bool
    account: PQCAccountView
    def __init__(self, found: bool = ..., account: _Optional[_Union[PQCAccountView, _Mapping]] = ...) -> None: ...

class PQCAccountView(_message.Message):
    __slots__ = ("address", "public_key", "algorithm_id", "algorithm_name", "ecdsa_pubkey", "key_type", "created_at_height", "migration_public_key", "migration_algorithm_id")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_NAME_FIELD_NUMBER: _ClassVar[int]
    ECDSA_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    KEY_TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    MIGRATION_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    MIGRATION_ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    address: str
    public_key: bytes
    algorithm_id: int
    algorithm_name: str
    ecdsa_pubkey: bytes
    key_type: str
    created_at_height: int
    migration_public_key: bytes
    migration_algorithm_id: int
    def __init__(self, address: _Optional[str] = ..., public_key: _Optional[bytes] = ..., algorithm_id: _Optional[int] = ..., algorithm_name: _Optional[str] = ..., ecdsa_pubkey: _Optional[bytes] = ..., key_type: _Optional[str] = ..., created_at_height: _Optional[int] = ..., migration_public_key: _Optional[bytes] = ..., migration_algorithm_id: _Optional[int] = ...) -> None: ...
