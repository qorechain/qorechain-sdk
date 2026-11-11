from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

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

class ReputationRecord(_message.Message):
    __slots__ = ("consensus_address", "operator_address", "stake_score", "performance_score", "contribution_score", "time_score", "composite_score", "last_updated_height", "uptime_blocks", "proposed_blocks", "missed_blocks", "slashing_events", "community_votes", "joined_at_height", "gov_participation", "inactive_since")
    CONSENSUS_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    OPERATOR_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    STAKE_SCORE_FIELD_NUMBER: _ClassVar[int]
    PERFORMANCE_SCORE_FIELD_NUMBER: _ClassVar[int]
    CONTRIBUTION_SCORE_FIELD_NUMBER: _ClassVar[int]
    TIME_SCORE_FIELD_NUMBER: _ClassVar[int]
    COMPOSITE_SCORE_FIELD_NUMBER: _ClassVar[int]
    LAST_UPDATED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    UPTIME_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    PROPOSED_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MISSED_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    SLASHING_EVENTS_FIELD_NUMBER: _ClassVar[int]
    COMMUNITY_VOTES_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    GOV_PARTICIPATION_FIELD_NUMBER: _ClassVar[int]
    INACTIVE_SINCE_FIELD_NUMBER: _ClassVar[int]
    consensus_address: str
    operator_address: str
    stake_score: str
    performance_score: str
    contribution_score: str
    time_score: str
    composite_score: str
    last_updated_height: int
    uptime_blocks: int
    proposed_blocks: int
    missed_blocks: int
    slashing_events: int
    community_votes: int
    joined_at_height: int
    gov_participation: str
    inactive_since: int
    def __init__(self, consensus_address: _Optional[str] = ..., operator_address: _Optional[str] = ..., stake_score: _Optional[str] = ..., performance_score: _Optional[str] = ..., contribution_score: _Optional[str] = ..., time_score: _Optional[str] = ..., composite_score: _Optional[str] = ..., last_updated_height: _Optional[int] = ..., uptime_blocks: _Optional[int] = ..., proposed_blocks: _Optional[int] = ..., missed_blocks: _Optional[int] = ..., slashing_events: _Optional[int] = ..., community_votes: _Optional[int] = ..., joined_at_height: _Optional[int] = ..., gov_participation: _Optional[str] = ..., inactive_since: _Optional[int] = ...) -> None: ...

class QueryReputationRequest(_message.Message):
    __slots__ = ("validator_address",)
    VALIDATOR_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    validator_address: str
    def __init__(self, validator_address: _Optional[str] = ...) -> None: ...

class QueryReputationResponse(_message.Message):
    __slots__ = ("reputation",)
    REPUTATION_FIELD_NUMBER: _ClassVar[int]
    reputation: ReputationRecord
    def __init__(self, reputation: _Optional[_Union[ReputationRecord, _Mapping]] = ...) -> None: ...

class QueryReputationsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryReputationsResponse(_message.Message):
    __slots__ = ("reputations",)
    REPUTATIONS_FIELD_NUMBER: _ClassVar[int]
    reputations: _containers.RepeatedCompositeFieldContainer[ReputationRecord]
    def __init__(self, reputations: _Optional[_Iterable[_Union[ReputationRecord, _Mapping]]] = ...) -> None: ...
