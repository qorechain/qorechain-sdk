from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ConfigView(_message.Message):
    __slots__ = ("enabled", "max_session_keys", "max_spending_rules", "default_session_ttl")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    MAX_SESSION_KEYS_FIELD_NUMBER: _ClassVar[int]
    MAX_SPENDING_RULES_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_SESSION_TTL_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    max_session_keys: int
    max_spending_rules: int
    default_session_ttl: int
    def __init__(self, enabled: bool = ..., max_session_keys: _Optional[int] = ..., max_spending_rules: _Optional[int] = ..., default_session_ttl: _Optional[int] = ...) -> None: ...

class AccountView(_message.Message):
    __slots__ = ("address", "contract_address", "account_type", "spending_rules_count", "session_keys_count", "created_at", "owner")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    CONTRACT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SPENDING_RULES_COUNT_FIELD_NUMBER: _ClassVar[int]
    SESSION_KEYS_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    address: str
    contract_address: str
    account_type: str
    spending_rules_count: int
    session_keys_count: int
    created_at: int
    owner: str
    def __init__(self, address: _Optional[str] = ..., contract_address: _Optional[str] = ..., account_type: _Optional[str] = ..., spending_rules_count: _Optional[int] = ..., session_keys_count: _Optional[int] = ..., created_at: _Optional[int] = ..., owner: _Optional[str] = ...) -> None: ...

class QueryConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: ConfigView
    def __init__(self, config: _Optional[_Union[ConfigView, _Mapping]] = ...) -> None: ...

class QueryAccountRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryAccountResponse(_message.Message):
    __slots__ = ("account",)
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    account: AccountView
    def __init__(self, account: _Optional[_Union[AccountView, _Mapping]] = ...) -> None: ...

class QueryAccountsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryAccountsResponse(_message.Message):
    __slots__ = ("accounts",)
    ACCOUNTS_FIELD_NUMBER: _ClassVar[int]
    accounts: _containers.RepeatedCompositeFieldContainer[AccountView]
    def __init__(self, accounts: _Optional[_Iterable[_Union[AccountView, _Mapping]]] = ...) -> None: ...

class QueryPermissionSchemaRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryPermissionSchemaResponse(_message.Message):
    __slots__ = ("schema_version", "permissions", "msg_permissions", "key_management_msgs")
    class MsgPermissionsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    SCHEMA_VERSION_FIELD_NUMBER: _ClassVar[int]
    PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    MSG_PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    KEY_MANAGEMENT_MSGS_FIELD_NUMBER: _ClassVar[int]
    schema_version: str
    permissions: _containers.RepeatedScalarFieldContainer[str]
    msg_permissions: _containers.ScalarMap[str, str]
    key_management_msgs: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, schema_version: _Optional[str] = ..., permissions: _Optional[_Iterable[str]] = ..., msg_permissions: _Optional[_Mapping[str, str]] = ..., key_management_msgs: _Optional[_Iterable[str]] = ...) -> None: ...
