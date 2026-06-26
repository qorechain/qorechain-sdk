from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from cosmos.base.v1beta1 import coin_pb2 as _coin_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgCreatePool(_message.Message):
    __slots__ = ("creator", "pool_type", "initial_deposit_a", "initial_deposit_b", "amplification_coefficient")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    POOL_TYPE_FIELD_NUMBER: _ClassVar[int]
    INITIAL_DEPOSIT_A_FIELD_NUMBER: _ClassVar[int]
    INITIAL_DEPOSIT_B_FIELD_NUMBER: _ClassVar[int]
    AMPLIFICATION_COEFFICIENT_FIELD_NUMBER: _ClassVar[int]
    creator: str
    pool_type: str
    initial_deposit_a: _coin_pb2.Coin
    initial_deposit_b: _coin_pb2.Coin
    amplification_coefficient: int
    def __init__(self, creator: _Optional[str] = ..., pool_type: _Optional[str] = ..., initial_deposit_a: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., initial_deposit_b: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., amplification_coefficient: _Optional[int] = ...) -> None: ...

class MsgCreatePoolResponse(_message.Message):
    __slots__ = ("pool_id",)
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    pool_id: int
    def __init__(self, pool_id: _Optional[int] = ...) -> None: ...

class MsgAddLiquidity(_message.Message):
    __slots__ = ("sender", "pool_id", "amount_a", "amount_b", "min_lp_out")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_A_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_B_FIELD_NUMBER: _ClassVar[int]
    MIN_LP_OUT_FIELD_NUMBER: _ClassVar[int]
    sender: str
    pool_id: int
    amount_a: _coin_pb2.Coin
    amount_b: _coin_pb2.Coin
    min_lp_out: str
    def __init__(self, sender: _Optional[str] = ..., pool_id: _Optional[int] = ..., amount_a: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., amount_b: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., min_lp_out: _Optional[str] = ...) -> None: ...

class MsgAddLiquidityResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRemoveLiquidity(_message.Message):
    __slots__ = ("sender", "pool_id", "lp_amount", "min_amount_a", "min_amount_b")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    LP_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    MIN_AMOUNT_A_FIELD_NUMBER: _ClassVar[int]
    MIN_AMOUNT_B_FIELD_NUMBER: _ClassVar[int]
    sender: str
    pool_id: int
    lp_amount: str
    min_amount_a: str
    min_amount_b: str
    def __init__(self, sender: _Optional[str] = ..., pool_id: _Optional[int] = ..., lp_amount: _Optional[str] = ..., min_amount_a: _Optional[str] = ..., min_amount_b: _Optional[str] = ...) -> None: ...

class MsgRemoveLiquidityResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgSwapExactIn(_message.Message):
    __slots__ = ("sender", "pool_id", "token_in", "denom_out", "min_out")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    TOKEN_IN_FIELD_NUMBER: _ClassVar[int]
    DENOM_OUT_FIELD_NUMBER: _ClassVar[int]
    MIN_OUT_FIELD_NUMBER: _ClassVar[int]
    sender: str
    pool_id: int
    token_in: _coin_pb2.Coin
    denom_out: str
    min_out: str
    def __init__(self, sender: _Optional[str] = ..., pool_id: _Optional[int] = ..., token_in: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., denom_out: _Optional[str] = ..., min_out: _Optional[str] = ...) -> None: ...

class MsgSwapExactInResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgSwapExactOut(_message.Message):
    __slots__ = ("sender", "pool_id", "denom_in", "token_out", "max_in")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    DENOM_IN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_OUT_FIELD_NUMBER: _ClassVar[int]
    MAX_IN_FIELD_NUMBER: _ClassVar[int]
    sender: str
    pool_id: int
    denom_in: str
    token_out: _coin_pb2.Coin
    max_in: str
    def __init__(self, sender: _Optional[str] = ..., pool_id: _Optional[int] = ..., denom_in: _Optional[str] = ..., token_out: _Optional[_Union[_coin_pb2.Coin, _Mapping]] = ..., max_in: _Optional[str] = ...) -> None: ...

class MsgSwapExactOutResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgPausePool(_message.Message):
    __slots__ = ("authority", "pool_id", "reason")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    authority: str
    pool_id: int
    reason: str
    def __init__(self, authority: _Optional[str] = ..., pool_id: _Optional[int] = ..., reason: _Optional[str] = ...) -> None: ...

class MsgPausePoolResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgResumePool(_message.Message):
    __slots__ = ("authority", "pool_id")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    authority: str
    pool_id: int
    def __init__(self, authority: _Optional[str] = ..., pool_id: _Optional[int] = ...) -> None: ...

class MsgResumePoolResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
