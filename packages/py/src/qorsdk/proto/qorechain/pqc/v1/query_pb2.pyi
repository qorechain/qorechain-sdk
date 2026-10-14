from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QueryEVMDelegationConsentRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryEVMDelegationConsentResponse(_message.Message):
    __slots__ = ("found", "live", "delegate", "granted_height", "expiry_height", "current_delegate", "nonce")
    FOUND_FIELD_NUMBER: _ClassVar[int]
    LIVE_FIELD_NUMBER: _ClassVar[int]
    DELEGATE_FIELD_NUMBER: _ClassVar[int]
    GRANTED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    EXPIRY_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    CURRENT_DELEGATE_FIELD_NUMBER: _ClassVar[int]
    NONCE_FIELD_NUMBER: _ClassVar[int]
    found: bool
    live: bool
    delegate: str
    granted_height: int
    expiry_height: int
    current_delegate: str
    nonce: int
    def __init__(self, found: bool = ..., live: bool = ..., delegate: _Optional[str] = ..., granted_height: _Optional[int] = ..., expiry_height: _Optional[int] = ..., current_delegate: _Optional[str] = ..., nonce: _Optional[int] = ...) -> None: ...

class QueryEVMWindowRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryEVMWindowResponse(_message.Message):
    __slots__ = ("found", "live", "opened_height", "expiry_height", "max_txs", "used_txs", "max_value", "used_value", "remaining_blocks", "remaining_txs", "remaining_value")
    FOUND_FIELD_NUMBER: _ClassVar[int]
    LIVE_FIELD_NUMBER: _ClassVar[int]
    OPENED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    EXPIRY_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    MAX_TXS_FIELD_NUMBER: _ClassVar[int]
    USED_TXS_FIELD_NUMBER: _ClassVar[int]
    MAX_VALUE_FIELD_NUMBER: _ClassVar[int]
    USED_VALUE_FIELD_NUMBER: _ClassVar[int]
    REMAINING_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    REMAINING_TXS_FIELD_NUMBER: _ClassVar[int]
    REMAINING_VALUE_FIELD_NUMBER: _ClassVar[int]
    found: bool
    live: bool
    opened_height: int
    expiry_height: int
    max_txs: int
    used_txs: int
    max_value: str
    used_value: str
    remaining_blocks: int
    remaining_txs: int
    remaining_value: str
    def __init__(self, found: bool = ..., live: bool = ..., opened_height: _Optional[int] = ..., expiry_height: _Optional[int] = ..., max_txs: _Optional[int] = ..., used_txs: _Optional[int] = ..., max_value: _Optional[str] = ..., used_value: _Optional[str] = ..., remaining_blocks: _Optional[int] = ..., remaining_txs: _Optional[int] = ..., remaining_value: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("address", "public_key", "algorithm_id", "algorithm_name", "ecdsa_pubkey", "key_type", "created_at_height", "migration_public_key", "migration_algorithm_id", "classical_key_source")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_NAME_FIELD_NUMBER: _ClassVar[int]
    ECDSA_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    KEY_TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    MIGRATION_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    MIGRATION_ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    CLASSICAL_KEY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    address: str
    public_key: bytes
    algorithm_id: int
    algorithm_name: str
    ecdsa_pubkey: bytes
    key_type: str
    created_at_height: int
    migration_public_key: bytes
    migration_algorithm_id: int
    classical_key_source: str
    def __init__(self, address: _Optional[str] = ..., public_key: _Optional[bytes] = ..., algorithm_id: _Optional[int] = ..., algorithm_name: _Optional[str] = ..., ecdsa_pubkey: _Optional[bytes] = ..., key_type: _Optional[str] = ..., created_at_height: _Optional[int] = ..., migration_public_key: _Optional[bytes] = ..., migration_algorithm_id: _Optional[int] = ..., classical_key_source: _Optional[str] = ...) -> None: ...
