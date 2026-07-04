from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ParamsView(_message.Message):
    __slots__ = ("swap_fee_bps", "protocol_fee_bps", "min_liquidity", "max_pools_per_creator", "lp_token_decimals", "pool_creation_fee", "max_swap_impact_bps", "enabled")
    SWAP_FEE_BPS_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FEE_BPS_FIELD_NUMBER: _ClassVar[int]
    MIN_LIQUIDITY_FIELD_NUMBER: _ClassVar[int]
    MAX_POOLS_PER_CREATOR_FIELD_NUMBER: _ClassVar[int]
    LP_TOKEN_DECIMALS_FIELD_NUMBER: _ClassVar[int]
    POOL_CREATION_FEE_FIELD_NUMBER: _ClassVar[int]
    MAX_SWAP_IMPACT_BPS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    swap_fee_bps: int
    protocol_fee_bps: int
    min_liquidity: str
    max_pools_per_creator: int
    lp_token_decimals: int
    pool_creation_fee: str
    max_swap_impact_bps: int
    enabled: bool
    def __init__(self, swap_fee_bps: _Optional[int] = ..., protocol_fee_bps: _Optional[int] = ..., min_liquidity: _Optional[str] = ..., max_pools_per_creator: _Optional[int] = ..., lp_token_decimals: _Optional[int] = ..., pool_creation_fee: _Optional[str] = ..., max_swap_impact_bps: _Optional[int] = ..., enabled: bool = ...) -> None: ...

class PoolView(_message.Message):
    __slots__ = ("id", "pool_type", "creator", "token_a", "token_b", "reserve_a", "reserve_b", "lp_supply", "lp_denom", "created_at", "status", "weighted_avg_price", "amplification_coefficient")
    ID_FIELD_NUMBER: _ClassVar[int]
    POOL_TYPE_FIELD_NUMBER: _ClassVar[int]
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    TOKEN_A_FIELD_NUMBER: _ClassVar[int]
    TOKEN_B_FIELD_NUMBER: _ClassVar[int]
    RESERVE_A_FIELD_NUMBER: _ClassVar[int]
    RESERVE_B_FIELD_NUMBER: _ClassVar[int]
    LP_SUPPLY_FIELD_NUMBER: _ClassVar[int]
    LP_DENOM_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    WEIGHTED_AVG_PRICE_FIELD_NUMBER: _ClassVar[int]
    AMPLIFICATION_COEFFICIENT_FIELD_NUMBER: _ClassVar[int]
    id: int
    pool_type: str
    creator: str
    token_a: str
    token_b: str
    reserve_a: str
    reserve_b: str
    lp_supply: str
    lp_denom: str
    created_at: int
    status: str
    weighted_avg_price: str
    amplification_coefficient: int
    def __init__(self, id: _Optional[int] = ..., pool_type: _Optional[str] = ..., creator: _Optional[str] = ..., token_a: _Optional[str] = ..., token_b: _Optional[str] = ..., reserve_a: _Optional[str] = ..., reserve_b: _Optional[str] = ..., lp_supply: _Optional[str] = ..., lp_denom: _Optional[str] = ..., created_at: _Optional[int] = ..., status: _Optional[str] = ..., weighted_avg_price: _Optional[str] = ..., amplification_coefficient: _Optional[int] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("params",)
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    params: ParamsView
    def __init__(self, params: _Optional[_Union[ParamsView, _Mapping]] = ...) -> None: ...

class QueryPoolRequest(_message.Message):
    __slots__ = ("pool_id",)
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    pool_id: int
    def __init__(self, pool_id: _Optional[int] = ...) -> None: ...

class QueryPoolResponse(_message.Message):
    __slots__ = ("pool",)
    POOL_FIELD_NUMBER: _ClassVar[int]
    pool: PoolView
    def __init__(self, pool: _Optional[_Union[PoolView, _Mapping]] = ...) -> None: ...

class QueryPoolsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryPoolsResponse(_message.Message):
    __slots__ = ("pools",)
    POOLS_FIELD_NUMBER: _ClassVar[int]
    pools: _containers.RepeatedCompositeFieldContainer[PoolView]
    def __init__(self, pools: _Optional[_Iterable[_Union[PoolView, _Mapping]]] = ...) -> None: ...

class QueryPoolByDenomsRequest(_message.Message):
    __slots__ = ("denom_a", "denom_b")
    DENOM_A_FIELD_NUMBER: _ClassVar[int]
    DENOM_B_FIELD_NUMBER: _ClassVar[int]
    denom_a: str
    denom_b: str
    def __init__(self, denom_a: _Optional[str] = ..., denom_b: _Optional[str] = ...) -> None: ...

class QueryPoolByDenomsResponse(_message.Message):
    __slots__ = ("pool",)
    POOL_FIELD_NUMBER: _ClassVar[int]
    pool: PoolView
    def __init__(self, pool: _Optional[_Union[PoolView, _Mapping]] = ...) -> None: ...

class QueryLPBalanceRequest(_message.Message):
    __slots__ = ("pool_id", "address")
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    pool_id: int
    address: str
    def __init__(self, pool_id: _Optional[int] = ..., address: _Optional[str] = ...) -> None: ...

class QueryLPBalanceResponse(_message.Message):
    __slots__ = ("balance",)
    BALANCE_FIELD_NUMBER: _ClassVar[int]
    balance: str
    def __init__(self, balance: _Optional[str] = ...) -> None: ...

class QueryQuoteExactInRequest(_message.Message):
    __slots__ = ("pool_id", "denom_in", "amount_in")
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    DENOM_IN_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_IN_FIELD_NUMBER: _ClassVar[int]
    pool_id: int
    denom_in: str
    amount_in: str
    def __init__(self, pool_id: _Optional[int] = ..., denom_in: _Optional[str] = ..., amount_in: _Optional[str] = ...) -> None: ...

class QueryQuoteExactInResponse(_message.Message):
    __slots__ = ("amount_out", "fee")
    AMOUNT_OUT_FIELD_NUMBER: _ClassVar[int]
    FEE_FIELD_NUMBER: _ClassVar[int]
    amount_out: str
    fee: str
    def __init__(self, amount_out: _Optional[str] = ..., fee: _Optional[str] = ...) -> None: ...

class QueryQuoteExactOutRequest(_message.Message):
    __slots__ = ("pool_id", "denom_out", "amount_out")
    POOL_ID_FIELD_NUMBER: _ClassVar[int]
    DENOM_OUT_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_OUT_FIELD_NUMBER: _ClassVar[int]
    pool_id: int
    denom_out: str
    amount_out: str
    def __init__(self, pool_id: _Optional[int] = ..., denom_out: _Optional[str] = ..., amount_out: _Optional[str] = ...) -> None: ...

class QueryQuoteExactOutResponse(_message.Message):
    __slots__ = ("amount_in", "fee")
    AMOUNT_IN_FIELD_NUMBER: _ClassVar[int]
    FEE_FIELD_NUMBER: _ClassVar[int]
    amount_in: str
    fee: str
    def __init__(self, amount_in: _Optional[str] = ..., fee: _Optional[str] = ...) -> None: ...
