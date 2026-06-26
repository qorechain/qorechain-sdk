from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

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
    __slots__ = ("sender", "public_key", "algorithm_id", "ecdsa_pubkey", "key_type")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    ALGORITHM_ID_FIELD_NUMBER: _ClassVar[int]
    ECDSA_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    KEY_TYPE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    public_key: bytes
    algorithm_id: int
    ecdsa_pubkey: bytes
    key_type: str
    def __init__(self, sender: _Optional[str] = ..., public_key: _Optional[bytes] = ..., algorithm_id: _Optional[int] = ..., ecdsa_pubkey: _Optional[bytes] = ..., key_type: _Optional[str] = ...) -> None: ...

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
