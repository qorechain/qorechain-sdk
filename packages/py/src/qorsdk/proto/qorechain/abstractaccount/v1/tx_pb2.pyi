from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from cosmos.base.v1beta1 import coin_pb2 as _coin_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SpendingRule(_message.Message):
    __slots__ = ("id", "daily_limit", "per_tx_limit", "allowed_denoms", "enabled")
    ID_FIELD_NUMBER: _ClassVar[int]
    DAILY_LIMIT_FIELD_NUMBER: _ClassVar[int]
    PER_TX_LIMIT_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_DENOMS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    id: str
    daily_limit: int
    per_tx_limit: int
    allowed_denoms: _containers.RepeatedScalarFieldContainer[str]
    enabled: bool
    def __init__(self, id: _Optional[str] = ..., daily_limit: _Optional[int] = ..., per_tx_limit: _Optional[int] = ..., allowed_denoms: _Optional[_Iterable[str]] = ..., enabled: bool = ...) -> None: ...

class MsgCreateAbstractAccount(_message.Message):
    __slots__ = ("owner", "account_type")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_TYPE_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_type: str
    def __init__(self, owner: _Optional[str] = ..., account_type: _Optional[str] = ...) -> None: ...

class MsgCreateAbstractAccountResponse(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class MsgUpdateSpendingRules(_message.Message):
    __slots__ = ("owner", "account_address", "rules")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    RULES_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_address: str
    rules: _containers.RepeatedCompositeFieldContainer[SpendingRule]
    def __init__(self, owner: _Optional[str] = ..., account_address: _Optional[str] = ..., rules: _Optional[_Iterable[_Union[SpendingRule, _Mapping]]] = ...) -> None: ...

class MsgUpdateSpendingRulesResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRegisterAuthenticator(_message.Message):
    __slots__ = ("owner", "account_address", "scheme", "pubkey", "permissions", "expiry_unix", "label")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_FIELD_NUMBER: _ClassVar[int]
    PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    EXPIRY_UNIX_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_address: str
    scheme: str
    pubkey: bytes
    permissions: _containers.RepeatedScalarFieldContainer[str]
    expiry_unix: int
    label: str
    def __init__(self, owner: _Optional[str] = ..., account_address: _Optional[str] = ..., scheme: _Optional[str] = ..., pubkey: _Optional[bytes] = ..., permissions: _Optional[_Iterable[str]] = ..., expiry_unix: _Optional[int] = ..., label: _Optional[str] = ...) -> None: ...

class MsgRegisterAuthenticatorResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRevokeAuthenticator(_message.Message):
    __slots__ = ("owner", "account_address", "scheme", "pubkey")
    OWNER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_FIELD_NUMBER: _ClassVar[int]
    owner: str
    account_address: str
    scheme: str
    pubkey: bytes
    def __init__(self, owner: _Optional[str] = ..., account_address: _Optional[str] = ..., scheme: _Optional[str] = ..., pubkey: _Optional[bytes] = ...) -> None: ...

class MsgRevokeAuthenticatorResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgExecuteEVM(_message.Message):
    __slots__ = ("relayer", "account", "scheme", "pubkey", "signature", "to", "value", "data", "gas_limit", "nonce")
    RELAYER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    GAS_LIMIT_FIELD_NUMBER: _ClassVar[int]
    NONCE_FIELD_NUMBER: _ClassVar[int]
    relayer: str
    account: str
    scheme: str
    pubkey: bytes
    signature: bytes
    to: str
    value: str
    data: bytes
    gas_limit: int
    nonce: int
    def __init__(self, relayer: _Optional[str] = ..., account: _Optional[str] = ..., scheme: _Optional[str] = ..., pubkey: _Optional[bytes] = ..., signature: _Optional[bytes] = ..., to: _Optional[str] = ..., value: _Optional[str] = ..., data: _Optional[bytes] = ..., gas_limit: _Optional[int] = ..., nonce: _Optional[int] = ...) -> None: ...

class MsgExecuteEVMResponse(_message.Message):
    __slots__ = ("success", "ret", "gas_used", "vm_error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    RET_FIELD_NUMBER: _ClassVar[int]
    GAS_USED_FIELD_NUMBER: _ClassVar[int]
    VM_ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    ret: bytes
    gas_used: int
    vm_error: str
    def __init__(self, success: bool = ..., ret: _Optional[bytes] = ..., gas_used: _Optional[int] = ..., vm_error: _Optional[str] = ...) -> None: ...

class MsgExecuteCosmos(_message.Message):
    __slots__ = ("relayer", "account", "scheme", "pubkey", "signature", "to", "amount", "nonce")
    RELAYER_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    TO_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    NONCE_FIELD_NUMBER: _ClassVar[int]
    relayer: str
    account: str
    scheme: str
    pubkey: bytes
    signature: bytes
    to: str
    amount: _containers.RepeatedCompositeFieldContainer[_coin_pb2.Coin]
    nonce: int
    def __init__(self, relayer: _Optional[str] = ..., account: _Optional[str] = ..., scheme: _Optional[str] = ..., pubkey: _Optional[bytes] = ..., signature: _Optional[bytes] = ..., to: _Optional[str] = ..., amount: _Optional[_Iterable[_Union[_coin_pb2.Coin, _Mapping]]] = ..., nonce: _Optional[int] = ...) -> None: ...

class MsgExecuteCosmosResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: bool = ...) -> None: ...
