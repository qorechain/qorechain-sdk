from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QuerySlotRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QuerySlotResponse(_message.Message):
    __slots__ = ("slot",)
    SLOT_FIELD_NUMBER: _ClassVar[int]
    slot: int
    def __init__(self, slot: _Optional[int] = ...) -> None: ...

class QueryAccountRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryAccountResponse(_message.Message):
    __slots__ = ("account",)
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    account: SVMAccountInfo
    def __init__(self, account: _Optional[_Union[SVMAccountInfo, _Mapping]] = ...) -> None: ...

class QueryProgramRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryProgramResponse(_message.Message):
    __slots__ = ("program",)
    PROGRAM_FIELD_NUMBER: _ClassVar[int]
    program: ProgramInfo
    def __init__(self, program: _Optional[_Union[ProgramInfo, _Mapping]] = ...) -> None: ...

class SVMAccountInfo(_message.Message):
    __slots__ = ("address", "lamports", "data_len", "data", "owner", "executable", "rent_epoch")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    LAMPORTS_FIELD_NUMBER: _ClassVar[int]
    DATA_LEN_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    EXECUTABLE_FIELD_NUMBER: _ClassVar[int]
    RENT_EPOCH_FIELD_NUMBER: _ClassVar[int]
    address: str
    lamports: int
    data_len: int
    data: bytes
    owner: str
    executable: bool
    rent_epoch: int
    def __init__(self, address: _Optional[str] = ..., lamports: _Optional[int] = ..., data_len: _Optional[int] = ..., data: _Optional[bytes] = ..., owner: _Optional[str] = ..., executable: bool = ..., rent_epoch: _Optional[int] = ...) -> None: ...

class ProgramInfo(_message.Message):
    __slots__ = ("program_address", "upgrade_authority", "deploy_slot", "last_deploy_slot", "data_account")
    PROGRAM_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    UPGRADE_AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    DEPLOY_SLOT_FIELD_NUMBER: _ClassVar[int]
    LAST_DEPLOY_SLOT_FIELD_NUMBER: _ClassVar[int]
    DATA_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    program_address: str
    upgrade_authority: str
    deploy_slot: int
    last_deploy_slot: int
    data_account: str
    def __init__(self, program_address: _Optional[str] = ..., upgrade_authority: _Optional[str] = ..., deploy_slot: _Optional[int] = ..., last_deploy_slot: _Optional[int] = ..., data_account: _Optional[str] = ...) -> None: ...
