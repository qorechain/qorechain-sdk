from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgDeployProgram(_message.Message):
    __slots__ = ("sender", "bytecode")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    BYTECODE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    bytecode: bytes
    def __init__(self, sender: _Optional[str] = ..., bytecode: _Optional[bytes] = ...) -> None: ...

class MsgDeployProgramResponse(_message.Message):
    __slots__ = ("program_id",)
    PROGRAM_ID_FIELD_NUMBER: _ClassVar[int]
    program_id: bytes
    def __init__(self, program_id: _Optional[bytes] = ...) -> None: ...

class MsgCreateAccount(_message.Message):
    __slots__ = ("sender", "owner", "space", "lamports", "salt")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    SPACE_FIELD_NUMBER: _ClassVar[int]
    LAMPORTS_FIELD_NUMBER: _ClassVar[int]
    SALT_FIELD_NUMBER: _ClassVar[int]
    sender: str
    owner: bytes
    space: int
    lamports: int
    salt: bytes
    def __init__(self, sender: _Optional[str] = ..., owner: _Optional[bytes] = ..., space: _Optional[int] = ..., lamports: _Optional[int] = ..., salt: _Optional[bytes] = ...) -> None: ...

class MsgCreateAccountResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SvmAccountMeta(_message.Message):
    __slots__ = ("address", "is_signer", "is_writable")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    IS_SIGNER_FIELD_NUMBER: _ClassVar[int]
    IS_WRITABLE_FIELD_NUMBER: _ClassVar[int]
    address: bytes
    is_signer: bool
    is_writable: bool
    def __init__(self, address: _Optional[bytes] = ..., is_signer: bool = ..., is_writable: bool = ...) -> None: ...

class SVMAuth(_message.Message):
    __slots__ = ("scheme", "pubkey", "signature", "recent_blockhash")
    SCHEME_FIELD_NUMBER: _ClassVar[int]
    PUBKEY_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    RECENT_BLOCKHASH_FIELD_NUMBER: _ClassVar[int]
    scheme: str
    pubkey: bytes
    signature: bytes
    recent_blockhash: bytes
    def __init__(self, scheme: _Optional[str] = ..., pubkey: _Optional[bytes] = ..., signature: _Optional[bytes] = ..., recent_blockhash: _Optional[bytes] = ...) -> None: ...

class MsgExecuteProgram(_message.Message):
    __slots__ = ("sender", "program_id", "accounts", "data", "auth")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    PROGRAM_ID_FIELD_NUMBER: _ClassVar[int]
    ACCOUNTS_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    AUTH_FIELD_NUMBER: _ClassVar[int]
    sender: str
    program_id: bytes
    accounts: _containers.RepeatedCompositeFieldContainer[SvmAccountMeta]
    data: bytes
    auth: SVMAuth
    def __init__(self, sender: _Optional[str] = ..., program_id: _Optional[bytes] = ..., accounts: _Optional[_Iterable[_Union[SvmAccountMeta, _Mapping]]] = ..., data: _Optional[bytes] = ..., auth: _Optional[_Union[SVMAuth, _Mapping]] = ...) -> None: ...

class MsgExecuteProgramResponse(_message.Message):
    __slots__ = ("result",)
    RESULT_FIELD_NUMBER: _ClassVar[int]
    result: bytes
    def __init__(self, result: _Optional[bytes] = ...) -> None: ...

class MsgRegisterSVMPQCKey(_message.Message):
    __slots__ = ("sender", "svm_addr", "pqc_pub_key")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SVM_ADDR_FIELD_NUMBER: _ClassVar[int]
    PQC_PUB_KEY_FIELD_NUMBER: _ClassVar[int]
    sender: str
    svm_addr: bytes
    pqc_pub_key: bytes
    def __init__(self, sender: _Optional[str] = ..., svm_addr: _Optional[bytes] = ..., pqc_pub_key: _Optional[bytes] = ...) -> None: ...

class MsgRegisterSVMPQCKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SVMParams(_message.Message):
    __slots__ = ("max_program_size", "max_account_data_size", "compute_budget_max", "lamports_per_byte", "rent_exemption_multi", "enabled", "svm_slot_offset", "default_sig_scheme", "max_cpi")
    MAX_PROGRAM_SIZE_FIELD_NUMBER: _ClassVar[int]
    MAX_ACCOUNT_DATA_SIZE_FIELD_NUMBER: _ClassVar[int]
    COMPUTE_BUDGET_MAX_FIELD_NUMBER: _ClassVar[int]
    LAMPORTS_PER_BYTE_FIELD_NUMBER: _ClassVar[int]
    RENT_EXEMPTION_MULTI_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    SVM_SLOT_OFFSET_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_SIG_SCHEME_FIELD_NUMBER: _ClassVar[int]
    MAX_CPI_FIELD_NUMBER: _ClassVar[int]
    max_program_size: int
    max_account_data_size: int
    compute_budget_max: int
    lamports_per_byte: int
    rent_exemption_multi: str
    enabled: bool
    svm_slot_offset: int
    default_sig_scheme: int
    max_cpi: int
    def __init__(self, max_program_size: _Optional[int] = ..., max_account_data_size: _Optional[int] = ..., compute_budget_max: _Optional[int] = ..., lamports_per_byte: _Optional[int] = ..., rent_exemption_multi: _Optional[str] = ..., enabled: bool = ..., svm_slot_offset: _Optional[int] = ..., default_sig_scheme: _Optional[int] = ..., max_cpi: _Optional[int] = ...) -> None: ...

class MsgUpdateParams(_message.Message):
    __slots__ = ("authority", "params")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    authority: str
    params: SVMParams
    def __init__(self, authority: _Optional[str] = ..., params: _Optional[_Union[SVMParams, _Mapping]] = ...) -> None: ...

class MsgUpdateParamsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
