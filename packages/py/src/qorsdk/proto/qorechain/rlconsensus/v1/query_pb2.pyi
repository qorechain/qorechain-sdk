from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class QueryObservationRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryObservationResponse(_message.Message):
    __slots__ = ("height", "values")
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    VALUES_FIELD_NUMBER: _ClassVar[int]
    height: int
    values: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, height: _Optional[int] = ..., values: _Optional[_Iterable[str]] = ...) -> None: ...

class QueryRewardRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryRewardResponse(_message.Message):
    __slots__ = ("height", "total_reward", "throughput_delta", "finality_delta", "decentralization_delta", "mev_estimate", "failed_tx_ratio")
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_REWARD_FIELD_NUMBER: _ClassVar[int]
    THROUGHPUT_DELTA_FIELD_NUMBER: _ClassVar[int]
    FINALITY_DELTA_FIELD_NUMBER: _ClassVar[int]
    DECENTRALIZATION_DELTA_FIELD_NUMBER: _ClassVar[int]
    MEV_ESTIMATE_FIELD_NUMBER: _ClassVar[int]
    FAILED_TX_RATIO_FIELD_NUMBER: _ClassVar[int]
    height: int
    total_reward: str
    throughput_delta: str
    finality_delta: str
    decentralization_delta: str
    mev_estimate: str
    failed_tx_ratio: str
    def __init__(self, height: _Optional[int] = ..., total_reward: _Optional[str] = ..., throughput_delta: _Optional[str] = ..., finality_delta: _Optional[str] = ..., decentralization_delta: _Optional[str] = ..., mev_estimate: _Optional[str] = ..., failed_tx_ratio: _Optional[str] = ...) -> None: ...

class QueryPolicyRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryPolicyResponse(_message.Message):
    __slots__ = ("epoch", "updated_at", "weight_count")
    EPOCH_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_COUNT_FIELD_NUMBER: _ClassVar[int]
    epoch: int
    updated_at: int
    weight_count: int
    def __init__(self, epoch: _Optional[int] = ..., updated_at: _Optional[int] = ..., weight_count: _Optional[int] = ...) -> None: ...

class QueryAgentStatusRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryAgentStatusResponse(_message.Message):
    __slots__ = ("mode", "current_epoch", "total_steps", "last_observation_at", "last_action_at", "circuit_breaker_active", "blocks_since_revert")
    MODE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_EPOCH_FIELD_NUMBER: _ClassVar[int]
    TOTAL_STEPS_FIELD_NUMBER: _ClassVar[int]
    LAST_OBSERVATION_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTION_AT_FIELD_NUMBER: _ClassVar[int]
    CIRCUIT_BREAKER_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    BLOCKS_SINCE_REVERT_FIELD_NUMBER: _ClassVar[int]
    mode: str
    current_epoch: int
    total_steps: int
    last_observation_at: int
    last_action_at: int
    circuit_breaker_active: bool
    blocks_since_revert: int
    def __init__(self, mode: _Optional[str] = ..., current_epoch: _Optional[int] = ..., total_steps: _Optional[int] = ..., last_observation_at: _Optional[int] = ..., last_action_at: _Optional[int] = ..., circuit_breaker_active: bool = ..., blocks_since_revert: _Optional[int] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("enabled", "observation_interval", "agent_mode", "max_change_conservative", "max_change_autonomous", "circuit_breaker_window", "circuit_breaker_threshold", "reward_weight_throughput", "reward_weight_finality", "reward_weight_decentralization", "reward_weight_mev", "reward_weight_failed_txs", "default_block_time_ms", "default_base_gas_price", "default_validator_set_size")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    OBSERVATION_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    AGENT_MODE_FIELD_NUMBER: _ClassVar[int]
    MAX_CHANGE_CONSERVATIVE_FIELD_NUMBER: _ClassVar[int]
    MAX_CHANGE_AUTONOMOUS_FIELD_NUMBER: _ClassVar[int]
    CIRCUIT_BREAKER_WINDOW_FIELD_NUMBER: _ClassVar[int]
    CIRCUIT_BREAKER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    REWARD_WEIGHT_THROUGHPUT_FIELD_NUMBER: _ClassVar[int]
    REWARD_WEIGHT_FINALITY_FIELD_NUMBER: _ClassVar[int]
    REWARD_WEIGHT_DECENTRALIZATION_FIELD_NUMBER: _ClassVar[int]
    REWARD_WEIGHT_MEV_FIELD_NUMBER: _ClassVar[int]
    REWARD_WEIGHT_FAILED_TXS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BLOCK_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BASE_GAS_PRICE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VALIDATOR_SET_SIZE_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    observation_interval: int
    agent_mode: str
    max_change_conservative: str
    max_change_autonomous: str
    circuit_breaker_window: int
    circuit_breaker_threshold: str
    reward_weight_throughput: str
    reward_weight_finality: str
    reward_weight_decentralization: str
    reward_weight_mev: str
    reward_weight_failed_txs: str
    default_block_time_ms: int
    default_base_gas_price: str
    default_validator_set_size: int
    def __init__(self, enabled: bool = ..., observation_interval: _Optional[int] = ..., agent_mode: _Optional[str] = ..., max_change_conservative: _Optional[str] = ..., max_change_autonomous: _Optional[str] = ..., circuit_breaker_window: _Optional[int] = ..., circuit_breaker_threshold: _Optional[str] = ..., reward_weight_throughput: _Optional[str] = ..., reward_weight_finality: _Optional[str] = ..., reward_weight_decentralization: _Optional[str] = ..., reward_weight_mev: _Optional[str] = ..., reward_weight_failed_txs: _Optional[str] = ..., default_block_time_ms: _Optional[int] = ..., default_base_gas_price: _Optional[str] = ..., default_validator_set_size: _Optional[int] = ...) -> None: ...
