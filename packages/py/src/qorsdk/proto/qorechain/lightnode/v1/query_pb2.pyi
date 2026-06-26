from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LightNodeView(_message.Message):
    __slots__ = ("address", "node_type", "version", "capabilities", "status", "registered_at", "last_heartbeat", "total_heartbeats", "expected_heartbeats", "delegated_stake", "accumulated_rewards", "initial_heartbeat_interval")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    REGISTERED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_HEARTBEAT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_HEARTBEATS_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_HEARTBEATS_FIELD_NUMBER: _ClassVar[int]
    DELEGATED_STAKE_FIELD_NUMBER: _ClassVar[int]
    ACCUMULATED_REWARDS_FIELD_NUMBER: _ClassVar[int]
    INITIAL_HEARTBEAT_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    address: str
    node_type: str
    version: str
    capabilities: _containers.RepeatedScalarFieldContainer[str]
    status: str
    registered_at: int
    last_heartbeat: int
    total_heartbeats: int
    expected_heartbeats: int
    delegated_stake: str
    accumulated_rewards: str
    initial_heartbeat_interval: int
    def __init__(self, address: _Optional[str] = ..., node_type: _Optional[str] = ..., version: _Optional[str] = ..., capabilities: _Optional[_Iterable[str]] = ..., status: _Optional[str] = ..., registered_at: _Optional[int] = ..., last_heartbeat: _Optional[int] = ..., total_heartbeats: _Optional[int] = ..., expected_heartbeats: _Optional[int] = ..., delegated_stake: _Optional[str] = ..., accumulated_rewards: _Optional[str] = ..., initial_heartbeat_interval: _Optional[int] = ...) -> None: ...

class QueryLightNodeRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryLightNodeResponse(_message.Message):
    __slots__ = ("node", "found")
    NODE_FIELD_NUMBER: _ClassVar[int]
    FOUND_FIELD_NUMBER: _ClassVar[int]
    node: LightNodeView
    found: bool
    def __init__(self, node: _Optional[_Union[LightNodeView, _Mapping]] = ..., found: bool = ...) -> None: ...

class QueryLightNodesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryLightNodesResponse(_message.Message):
    __slots__ = ("nodes",)
    NODES_FIELD_NUMBER: _ClassVar[int]
    nodes: _containers.RepeatedCompositeFieldContainer[LightNodeView]
    def __init__(self, nodes: _Optional[_Iterable[_Union[LightNodeView, _Mapping]]] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("registration_fee", "heartbeat_interval", "min_delegated_stake", "reward_share", "min_uptime_for_rewards", "max_light_nodes", "heartbeat_grace_period")
    REGISTRATION_FEE_FIELD_NUMBER: _ClassVar[int]
    HEARTBEAT_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    MIN_DELEGATED_STAKE_FIELD_NUMBER: _ClassVar[int]
    REWARD_SHARE_FIELD_NUMBER: _ClassVar[int]
    MIN_UPTIME_FOR_REWARDS_FIELD_NUMBER: _ClassVar[int]
    MAX_LIGHT_NODES_FIELD_NUMBER: _ClassVar[int]
    HEARTBEAT_GRACE_PERIOD_FIELD_NUMBER: _ClassVar[int]
    registration_fee: str
    heartbeat_interval: int
    min_delegated_stake: str
    reward_share: str
    min_uptime_for_rewards: str
    max_light_nodes: int
    heartbeat_grace_period: int
    def __init__(self, registration_fee: _Optional[str] = ..., heartbeat_interval: _Optional[int] = ..., min_delegated_stake: _Optional[str] = ..., reward_share: _Optional[str] = ..., min_uptime_for_rewards: _Optional[str] = ..., max_light_nodes: _Optional[int] = ..., heartbeat_grace_period: _Optional[int] = ...) -> None: ...

class QueryRewardsRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryRewardsResponse(_message.Message):
    __slots__ = ("accumulated_rewards",)
    ACCUMULATED_REWARDS_FIELD_NUMBER: _ClassVar[int]
    accumulated_rewards: str
    def __init__(self, accumulated_rewards: _Optional[str] = ...) -> None: ...

class QueryStatsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryStatsResponse(_message.Message):
    __slots__ = ("total_registered", "total_active", "total_rewards", "last_reward_height")
    TOTAL_REGISTERED_FIELD_NUMBER: _ClassVar[int]
    TOTAL_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_REWARDS_FIELD_NUMBER: _ClassVar[int]
    LAST_REWARD_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    total_registered: int
    total_active: int
    total_rewards: str
    last_reward_height: int
    def __init__(self, total_registered: _Optional[int] = ..., total_active: _Optional[int] = ..., total_rewards: _Optional[str] = ..., last_reward_height: _Optional[int] = ...) -> None: ...
