from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("alpha", "beta", "gamma", "delta", "min_score")
    ALPHA_FIELD_NUMBER: _ClassVar[int]
    BETA_FIELD_NUMBER: _ClassVar[int]
    GAMMA_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    LAMBDA_FIELD_NUMBER: _ClassVar[int]
    MIN_SCORE_FIELD_NUMBER: _ClassVar[int]
    alpha: str
    beta: str
    gamma: str
    delta: str
    min_score: str
    def __init__(self, alpha: _Optional[str] = ..., beta: _Optional[str] = ..., gamma: _Optional[str] = ..., delta: _Optional[str] = ..., min_score: _Optional[str] = ..., **kwargs) -> None: ...
