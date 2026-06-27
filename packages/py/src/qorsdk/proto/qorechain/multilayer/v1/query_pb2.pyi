from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ParamsView(_message.Message):
    __slots__ = ("max_sidechains", "max_paychains", "min_anchor_interval", "max_anchor_interval", "default_challenge_period", "min_sidechain_stake", "min_paychain_stake", "routing_enabled", "routing_confidence_threshold", "cross_layer_fee_bundling")
    MAX_SIDECHAINS_FIELD_NUMBER: _ClassVar[int]
    MAX_PAYCHAINS_FIELD_NUMBER: _ClassVar[int]
    MIN_ANCHOR_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    MAX_ANCHOR_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CHALLENGE_PERIOD_FIELD_NUMBER: _ClassVar[int]
    MIN_SIDECHAIN_STAKE_FIELD_NUMBER: _ClassVar[int]
    MIN_PAYCHAIN_STAKE_FIELD_NUMBER: _ClassVar[int]
    ROUTING_ENABLED_FIELD_NUMBER: _ClassVar[int]
    ROUTING_CONFIDENCE_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    CROSS_LAYER_FEE_BUNDLING_FIELD_NUMBER: _ClassVar[int]
    max_sidechains: int
    max_paychains: int
    min_anchor_interval: int
    max_anchor_interval: int
    default_challenge_period: int
    min_sidechain_stake: str
    min_paychain_stake: str
    routing_enabled: bool
    routing_confidence_threshold: str
    cross_layer_fee_bundling: bool
    def __init__(self, max_sidechains: _Optional[int] = ..., max_paychains: _Optional[int] = ..., min_anchor_interval: _Optional[int] = ..., max_anchor_interval: _Optional[int] = ..., default_challenge_period: _Optional[int] = ..., min_sidechain_stake: _Optional[str] = ..., min_paychain_stake: _Optional[str] = ..., routing_enabled: bool = ..., routing_confidence_threshold: _Optional[str] = ..., cross_layer_fee_bundling: bool = ...) -> None: ...

class LayerView(_message.Message):
    __slots__ = ("layer_id", "layer_type", "status", "chain_id", "description", "target_block_time_ms", "max_transactions_per_block", "min_validators", "settlement_interval_blocks", "challenge_period_seconds")
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    LAYER_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TARGET_BLOCK_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    MAX_TRANSACTIONS_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    MIN_VALIDATORS_FIELD_NUMBER: _ClassVar[int]
    SETTLEMENT_INTERVAL_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    CHALLENGE_PERIOD_SECONDS_FIELD_NUMBER: _ClassVar[int]
    layer_id: str
    layer_type: str
    status: str
    chain_id: str
    description: str
    target_block_time_ms: int
    max_transactions_per_block: int
    min_validators: int
    settlement_interval_blocks: int
    challenge_period_seconds: int
    def __init__(self, layer_id: _Optional[str] = ..., layer_type: _Optional[str] = ..., status: _Optional[str] = ..., chain_id: _Optional[str] = ..., description: _Optional[str] = ..., target_block_time_ms: _Optional[int] = ..., max_transactions_per_block: _Optional[int] = ..., min_validators: _Optional[int] = ..., settlement_interval_blocks: _Optional[int] = ..., challenge_period_seconds: _Optional[int] = ...) -> None: ...

class RoutingStatsView(_message.Message):
    __slots__ = ("total_routed", "routed_to_main", "routed_to_sidechains", "routed_to_paychains", "average_gas_savings_percent", "average_latency_improvement_percent")
    TOTAL_ROUTED_FIELD_NUMBER: _ClassVar[int]
    ROUTED_TO_MAIN_FIELD_NUMBER: _ClassVar[int]
    ROUTED_TO_SIDECHAINS_FIELD_NUMBER: _ClassVar[int]
    ROUTED_TO_PAYCHAINS_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_GAS_SAVINGS_PERCENT_FIELD_NUMBER: _ClassVar[int]
    AVERAGE_LATENCY_IMPROVEMENT_PERCENT_FIELD_NUMBER: _ClassVar[int]
    total_routed: int
    routed_to_main: int
    routed_to_sidechains: int
    routed_to_paychains: int
    average_gas_savings_percent: str
    average_latency_improvement_percent: str
    def __init__(self, total_routed: _Optional[int] = ..., routed_to_main: _Optional[int] = ..., routed_to_sidechains: _Optional[int] = ..., routed_to_paychains: _Optional[int] = ..., average_gas_savings_percent: _Optional[str] = ..., average_latency_improvement_percent: _Optional[str] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("params",)
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    params: ParamsView
    def __init__(self, params: _Optional[_Union[ParamsView, _Mapping]] = ...) -> None: ...

class QueryLayerRequest(_message.Message):
    __slots__ = ("layer_id",)
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    layer_id: str
    def __init__(self, layer_id: _Optional[str] = ...) -> None: ...

class QueryLayerResponse(_message.Message):
    __slots__ = ("layer",)
    LAYER_FIELD_NUMBER: _ClassVar[int]
    layer: LayerView
    def __init__(self, layer: _Optional[_Union[LayerView, _Mapping]] = ...) -> None: ...

class QueryLayersRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryLayersResponse(_message.Message):
    __slots__ = ("layers",)
    LAYERS_FIELD_NUMBER: _ClassVar[int]
    layers: _containers.RepeatedCompositeFieldContainer[LayerView]
    def __init__(self, layers: _Optional[_Iterable[_Union[LayerView, _Mapping]]] = ...) -> None: ...

class QueryRoutingStatsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryRoutingStatsView(_message.Message):
    __slots__ = ("stats",)
    STATS_FIELD_NUMBER: _ClassVar[int]
    stats: RoutingStatsView
    def __init__(self, stats: _Optional[_Union[RoutingStatsView, _Mapping]] = ...) -> None: ...
