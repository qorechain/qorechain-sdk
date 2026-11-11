from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf import any_pb2 as _any_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class QueryTextualSignDocRequest(_message.Message):
    __slots__ = ("tx_bytes", "tx_json", "signer_address", "public_key", "account_number", "sequence")
    TX_BYTES_FIELD_NUMBER: _ClassVar[int]
    TX_JSON_FIELD_NUMBER: _ClassVar[int]
    SIGNER_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    PUBLIC_KEY_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    tx_bytes: bytes
    tx_json: str
    signer_address: str
    public_key: _any_pb2.Any
    account_number: int
    sequence: int
    def __init__(self, tx_bytes: _Optional[bytes] = ..., tx_json: _Optional[str] = ..., signer_address: _Optional[str] = ..., public_key: _Optional[_Union[_any_pb2.Any, _Mapping]] = ..., account_number: _Optional[int] = ..., sequence: _Optional[int] = ...) -> None: ...

class TextualScreen(_message.Message):
    __slots__ = ("title", "content", "indent", "expert")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    INDENT_FIELD_NUMBER: _ClassVar[int]
    EXPERT_FIELD_NUMBER: _ClassVar[int]
    title: str
    content: str
    indent: int
    expert: bool
    def __init__(self, title: _Optional[str] = ..., content: _Optional[str] = ..., indent: _Optional[int] = ..., expert: bool = ...) -> None: ...

class QueryTextualSignDocResponse(_message.Message):
    __slots__ = ("sign_bytes", "screens", "chain_id", "ledger_compatible", "ledger_issue", "body_bytes", "auth_info_bytes")
    SIGN_BYTES_FIELD_NUMBER: _ClassVar[int]
    SCREENS_FIELD_NUMBER: _ClassVar[int]
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    LEDGER_COMPATIBLE_FIELD_NUMBER: _ClassVar[int]
    LEDGER_ISSUE_FIELD_NUMBER: _ClassVar[int]
    BODY_BYTES_FIELD_NUMBER: _ClassVar[int]
    AUTH_INFO_BYTES_FIELD_NUMBER: _ClassVar[int]
    sign_bytes: bytes
    screens: _containers.RepeatedCompositeFieldContainer[TextualScreen]
    chain_id: str
    ledger_compatible: bool
    ledger_issue: str
    body_bytes: bytes
    auth_info_bytes: bytes
    def __init__(self, sign_bytes: _Optional[bytes] = ..., screens: _Optional[_Iterable[_Union[TextualScreen, _Mapping]]] = ..., chain_id: _Optional[str] = ..., ledger_compatible: bool = ..., ledger_issue: _Optional[str] = ..., body_bytes: _Optional[bytes] = ..., auth_info_bytes: _Optional[bytes] = ...) -> None: ...
