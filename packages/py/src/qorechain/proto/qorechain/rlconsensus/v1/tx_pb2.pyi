from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgSetAgentMode(_message.Message):
    __slots__ = ("authority", "mode")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    authority: str
    mode: int
    def __init__(self, authority: _Optional[str] = ..., mode: _Optional[int] = ...) -> None: ...

class MsgSetAgentModeResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgResumeAgent(_message.Message):
    __slots__ = ("authority",)
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    authority: str
    def __init__(self, authority: _Optional[str] = ...) -> None: ...

class MsgResumeAgentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgUpdatePolicy(_message.Message):
    __slots__ = ("authority", "weights_json")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    WEIGHTS_JSON_FIELD_NUMBER: _ClassVar[int]
    authority: str
    weights_json: str
    def __init__(self, authority: _Optional[str] = ..., weights_json: _Optional[str] = ...) -> None: ...

class MsgUpdatePolicyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgUpdateRewardWeights(_message.Message):
    __slots__ = ("authority", "throughput", "finality", "decentralization", "mev", "failed_txs")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    THROUGHPUT_FIELD_NUMBER: _ClassVar[int]
    FINALITY_FIELD_NUMBER: _ClassVar[int]
    DECENTRALIZATION_FIELD_NUMBER: _ClassVar[int]
    MEV_FIELD_NUMBER: _ClassVar[int]
    FAILED_TXS_FIELD_NUMBER: _ClassVar[int]
    authority: str
    throughput: str
    finality: str
    decentralization: str
    mev: str
    failed_txs: str
    def __init__(self, authority: _Optional[str] = ..., throughput: _Optional[str] = ..., finality: _Optional[str] = ..., decentralization: _Optional[str] = ..., mev: _Optional[str] = ..., failed_txs: _Optional[str] = ...) -> None: ...

class MsgUpdateRewardWeightsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
