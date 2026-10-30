from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgRegisterPQCKey(_message.Message):
    __slots__ = ("sender", "dilithium_pubkey", "ecdsa_pubkey", "key_type")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    DILITHIUM_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    ECDSA_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    KEY_TYPE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    dilithium_pubkey: bytes
    ecdsa_pubkey: bytes
    key_type: str
    def __init__(self, sender: _Optional[str] = ..., dilithium_pubkey: _Optional[bytes] = ..., ecdsa_pubkey: _Optional[bytes] = ..., key_type: _Optional[str] = ...) -> None: ...

class MsgRegisterPQCKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRegisterPQCKeyV2(_message.Message):
    __slots__ = ("sender", "public_key", "algorithm_id", "ecdsa_pubkey", "key_type", "proof_of_possession")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    ECDSA_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    KEY_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROOF_OF_POSSESSION_FIELD_NUMBER: _ClassVar[int]
    sender: str
    public_key: bytes
    algorithm_id: int
    ecdsa_pubkey: bytes
    key_type: str
    proof_of_possession: bytes
    def __init__(self, sender: _Optional[str] = ..., public_key: _Optional[bytes] = ..., algorithm_id: _Optional[int] = ..., ecdsa_pubkey: _Optional[bytes] = ..., key_type: _Optional[str] = ..., proof_of_possession: _Optional[bytes] = ...) -> None: ...

class MsgRegisterPQCKeyV2Response(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgMigratePQCKey(_message.Message):
    __slots__ = ("sender", "old_public_key", "new_public_key", "new_algorithm_id", "old_signature", "new_signature")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    OLD_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    NEW_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    NEW_ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    OLD_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    NEW_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    old_public_key: bytes
    new_public_key: bytes
    new_algorithm_id: int
    old_signature: bytes
    new_signature: bytes
    def __init__(self, sender: _Optional[str] = ..., old_public_key: _Optional[bytes] = ..., new_public_key: _Optional[bytes] = ..., new_algorithm_id: _Optional[int] = ..., old_signature: _Optional[bytes] = ..., new_signature: _Optional[bytes] = ...) -> None: ...

class MsgMigratePQCKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRotatePQCKey(_message.Message):
    __slots__ = ("sender", "old_public_key", "new_public_key", "old_signature", "new_signature")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    OLD_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    NEW_PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    OLD_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    NEW_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    old_public_key: bytes
    new_public_key: bytes
    old_signature: bytes
    new_signature: bytes
    def __init__(self, sender: _Optional[str] = ..., old_public_key: _Optional[bytes] = ..., new_public_key: _Optional[bytes] = ..., old_signature: _Optional[bytes] = ..., new_signature: _Optional[bytes] = ...) -> None: ...

class MsgRotatePQCKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgDeprecateAlgorithm(_message.Message):
    __slots__ = ("authority", "algorithm_id", "migration_blocks", "replacement_algorithm_id")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    MIGRATION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    REPLACEMENT_ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    authority: str
    algorithm_id: int
    migration_blocks: int
    replacement_algorithm_id: int
    def __init__(self, authority: _Optional[str] = ..., algorithm_id: _Optional[int] = ..., migration_blocks: _Optional[int] = ..., replacement_algorithm_id: _Optional[int] = ...) -> None: ...

class MsgDeprecateAlgorithmResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgDisableAlgorithm(_message.Message):
    __slots__ = ("authority", "algorithm_id", "reason")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    authority: str
    algorithm_id: int
    reason: str
    def __init__(self, authority: _Optional[str] = ..., algorithm_id: _Optional[int] = ..., reason: _Optional[str] = ...) -> None: ...

class MsgDisableAlgorithmResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgOpenEVMWindow(_message.Message):
    __slots__ = ("sender", "blocks", "max_txs", "max_value", "native_only", "allowed_targets")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MAX_TXS_FIELD_NUMBER: _ClassVar[int]
    MAX_VALUE_FIELD_NUMBER: _ClassVar[int]
    NATIVE_ONLY_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_TARGETS_FIELD_NUMBER: _ClassVar[int]
    sender: str
    blocks: int
    max_txs: int
    max_value: str
    native_only: bool
    allowed_targets: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, sender: _Optional[str] = ..., blocks: _Optional[int] = ..., max_txs: _Optional[int] = ..., max_value: _Optional[str] = ..., native_only: bool = ..., allowed_targets: _Optional[_Iterable[str]] = ...) -> None: ...

class MsgOpenEVMWindowResponse(_message.Message):
    __slots__ = ("expiry_height",)
    EXPIRY_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    expiry_height: int
    def __init__(self, expiry_height: _Optional[int] = ...) -> None: ...

class MsgCloseEVMWindow(_message.Message):
    __slots__ = ("sender",)
    SENDER_FIELD_NUMBER: _ClassVar[int]
    sender: str
    def __init__(self, sender: _Optional[str] = ...) -> None: ...

class MsgCloseEVMWindowResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgAuthorizeEVMDelegation(_message.Message):
    __slots__ = ("sender", "delegate", "blocks")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    DELEGATE_FIELD_NUMBER: _ClassVar[int]
    BLOCKS_FIELD_NUMBER: _ClassVar[int]
    sender: str
    delegate: str
    blocks: int
    def __init__(self, sender: _Optional[str] = ..., delegate: _Optional[str] = ..., blocks: _Optional[int] = ...) -> None: ...

class MsgAuthorizeEVMDelegationResponse(_message.Message):
    __slots__ = ("expiry_height",)
    EXPIRY_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    expiry_height: int
    def __init__(self, expiry_height: _Optional[int] = ...) -> None: ...

class MsgClearEVMDelegation(_message.Message):
    __slots__ = ("sender",)
    SENDER_FIELD_NUMBER: _ClassVar[int]
    sender: str
    def __init__(self, sender: _Optional[str] = ...) -> None: ...

class MsgClearEVMDelegationResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRegisterKEMKey(_message.Message):
    __slots__ = ("sender", "algorithm_id", "public_key")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    sender: str
    algorithm_id: int
    public_key: bytes
    def __init__(self, sender: _Optional[str] = ..., algorithm_id: _Optional[int] = ..., public_key: _Optional[bytes] = ...) -> None: ...

class MsgRegisterKEMKeyResponse(_message.Message):
    __slots__ = ("replaced",)
    REPLACED_FIELD_NUMBER: _ClassVar[int]
    replaced: bool
    def __init__(self, replaced: bool = ...) -> None: ...

class MsgRemoveKEMKey(_message.Message):
    __slots__ = ("sender",)
    SENDER_FIELD_NUMBER: _ClassVar[int]
    sender: str
    def __init__(self, sender: _Optional[str] = ...) -> None: ...

class MsgRemoveKEMKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
