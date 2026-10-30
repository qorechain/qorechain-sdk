from google.api import annotations_pb2 as _annotations_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from qorsdk.proto.qorechain.abstractaccount.v1 import tx_pb2 as _tx_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QuerySpendingRulesRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QuerySpendingRulesResponse(_message.Message):
    __slots__ = ("rules", "authenticator_rules")
    RULES_FIELD_NUMBER: _ClassVar[int]
    AUTHENTICATOR_RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[_tx_pb2.SpendingRule]
    authenticator_rules: _containers.RepeatedCompositeFieldContainer[AuthenticatorRule]
    def __init__(self, rules: _Optional[_Iterable[_Union[_tx_pb2.SpendingRule, _Mapping]]] = ..., authenticator_rules: _Optional[_Iterable[_Union[AuthenticatorRule, _Mapping]]] = ...) -> None: ...

class AuthenticatorRule(_message.Message):
    __slots__ = ("scheme", "pubkey_hex", "rule")
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_HEX_FIELD_NUMBER: _ClassVar[int]
    RULE_FIELD_NUMBER: _ClassVar[int]
    scheme: str
    pubkey_hex: str
    rule: _tx_pb2.SpendingRule
    def __init__(self, scheme: _Optional[str] = ..., pubkey_hex: _Optional[str] = ..., rule: _Optional[_Union[_tx_pb2.SpendingRule, _Mapping]] = ...) -> None: ...

class QueryAuthenticatorsRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryAuthenticatorsResponse(_message.Message):
    __slots__ = ("authenticators",)
    AUTHENTICATORS_FIELD_NUMBER: _ClassVar[int]
    authenticators: _containers.RepeatedCompositeFieldContainer[AuthenticatorView]
    def __init__(self, authenticators: _Optional[_Iterable[_Union[AuthenticatorView, _Mapping]]] = ...) -> None: ...

class AuthenticatorView(_message.Message):
    __slots__ = ("scheme", "pubkey_hex", "permissions", "expiry_unix", "label", "created_at_unix", "revoked", "has_spend_rule")
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_HEX_FIELD_NUMBER: _ClassVar[int]
    PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    EXPIRY_UNIX_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_UNIX_FIELD_NUMBER: _ClassVar[int]
    REVOKED_FIELD_NUMBER: _ClassVar[int]
    HAS_SPEND_RULE_FIELD_NUMBER: _ClassVar[int]
    scheme: str
    pubkey_hex: str
    permissions: _containers.RepeatedScalarFieldContainer[str]
    expiry_unix: int
    label: str
    created_at_unix: int
    revoked: bool
    has_spend_rule: bool
    def __init__(self, scheme: _Optional[str] = ..., pubkey_hex: _Optional[str] = ..., permissions: _Optional[_Iterable[str]] = ..., expiry_unix: _Optional[int] = ..., label: _Optional[str] = ..., created_at_unix: _Optional[int] = ..., revoked: bool = ..., has_spend_rule: bool = ...) -> None: ...

class QueryAuthNonceRequest(_message.Message):
    __slots__ = ("address", "pubkey_hex")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_HEX_FIELD_NUMBER: _ClassVar[int]
    address: str
    pubkey_hex: str
    def __init__(self, address: _Optional[str] = ..., pubkey_hex: _Optional[str] = ...) -> None: ...

class QueryAuthNonceResponse(_message.Message):
    __slots__ = ("nonce", "linked")
    NONCE_FIELD_NUMBER: _ClassVar[int]
    LINKED_FIELD_NUMBER: _ClassVar[int]
    nonce: int
    linked: bool
    def __init__(self, nonce: _Optional[int] = ..., linked: bool = ...) -> None: ...

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
    __slots__ = ("address", "contract_address", "account_type", "spending_rules_count", "session_keys_count", "created_at", "owner", "authenticators_count")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    CONTRACT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SPENDING_RULES_COUNT_FIELD_NUMBER: _ClassVar[int]
    SESSION_KEYS_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    AUTHENTICATORS_COUNT_FIELD_NUMBER: _ClassVar[int]
    address: str
    contract_address: str
    account_type: str
    spending_rules_count: int
    session_keys_count: int
    created_at: int
    owner: str
    authenticators_count: int
    def __init__(self, address: _Optional[str] = ..., contract_address: _Optional[str] = ..., account_type: _Optional[str] = ..., spending_rules_count: _Optional[int] = ..., session_keys_count: _Optional[int] = ..., created_at: _Optional[int] = ..., owner: _Optional[str] = ..., authenticators_count: _Optional[int] = ...) -> None: ...

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
    __slots__ = ("schema_version", "permissions", "msg_permissions", "key_management_msgs", "lane_rules")
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
    LANE_RULES_FIELD_NUMBER: _ClassVar[int]
    schema_version: str
    permissions: _containers.RepeatedScalarFieldContainer[str]
    msg_permissions: _containers.ScalarMap[str, str]
    key_management_msgs: _containers.RepeatedScalarFieldContainer[str]
    lane_rules: _containers.RepeatedCompositeFieldContainer[LaneRule]
    def __init__(self, schema_version: _Optional[str] = ..., permissions: _Optional[_Iterable[str]] = ..., msg_permissions: _Optional[_Mapping[str, str]] = ..., key_management_msgs: _Optional[_Iterable[str]] = ..., lane_rules: _Optional[_Iterable[_Union[LaneRule, _Mapping]]] = ...) -> None: ...

class LaneRule(_message.Message):
    __slots__ = ("msg_type_url", "condition", "permission")
    MSG_TYPE_URL_FIELD_NUMBER: _ClassVar[int]
    CONDITION_FIELD_NUMBER: _ClassVar[int]
    PERMISSION_FIELD_NUMBER: _ClassVar[int]
    msg_type_url: str
    condition: str
    permission: str
    def __init__(self, msg_type_url: _Optional[str] = ..., condition: _Optional[str] = ..., permission: _Optional[str] = ...) -> None: ...
