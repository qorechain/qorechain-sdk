from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class QueryConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryConfigResponse(_message.Message):
    __slots__ = ("use_reputation_weighting", "min_reputation_score", "pool_classification_interval", "pool_weight_rpos", "pool_weight_dpos", "pool_min_delegation_dpos", "pool_rep_percentile_rpos", "bonding_alpha", "bonding_beta", "bonding_phase_multiplier", "slashing_base_rate", "slashing_escalation_factor", "slashing_max_penalty", "slashing_decay_halflife", "qdrw_enabled", "qdrw_xqore_multiplier", "qdrw_rep_min_multiplier", "qdrw_rep_max_multiplier")
    USE_REPUTATION_WEIGHTING_FIELD_NUMBER: _ClassVar[int]
    MIN_REPUTATION_SCORE_FIELD_NUMBER: _ClassVar[int]
    POOL_CLASSIFICATION_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    POOL_WEIGHT_RPOS_FIELD_NUMBER: _ClassVar[int]
    POOL_WEIGHT_DPOS_FIELD_NUMBER: _ClassVar[int]
    POOL_MIN_DELEGATION_DPOS_FIELD_NUMBER: _ClassVar[int]
    POOL_REP_PERCENTILE_RPOS_FIELD_NUMBER: _ClassVar[int]
    BONDING_ALPHA_FIELD_NUMBER: _ClassVar[int]
    BONDING_BETA_FIELD_NUMBER: _ClassVar[int]
    BONDING_PHASE_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    SLASHING_BASE_RATE_FIELD_NUMBER: _ClassVar[int]
    SLASHING_ESCALATION_FACTOR_FIELD_NUMBER: _ClassVar[int]
    SLASHING_MAX_PENALTY_FIELD_NUMBER: _ClassVar[int]
    SLASHING_DECAY_HALFLIFE_FIELD_NUMBER: _ClassVar[int]
    QDRW_ENABLED_FIELD_NUMBER: _ClassVar[int]
    QDRW_XQORE_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    QDRW_REP_MIN_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    QDRW_REP_MAX_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    use_reputation_weighting: bool
    min_reputation_score: float
    pool_classification_interval: int
    pool_weight_rpos: str
    pool_weight_dpos: str
    pool_min_delegation_dpos: int
    pool_rep_percentile_rpos: int
    bonding_alpha: str
    bonding_beta: str
    bonding_phase_multiplier: str
    slashing_base_rate: str
    slashing_escalation_factor: str
    slashing_max_penalty: str
    slashing_decay_halflife: int
    qdrw_enabled: bool
    qdrw_xqore_multiplier: str
    qdrw_rep_min_multiplier: str
    qdrw_rep_max_multiplier: str
    def __init__(self, use_reputation_weighting: bool = ..., min_reputation_score: _Optional[float] = ..., pool_classification_interval: _Optional[int] = ..., pool_weight_rpos: _Optional[str] = ..., pool_weight_dpos: _Optional[str] = ..., pool_min_delegation_dpos: _Optional[int] = ..., pool_rep_percentile_rpos: _Optional[int] = ..., bonding_alpha: _Optional[str] = ..., bonding_beta: _Optional[str] = ..., bonding_phase_multiplier: _Optional[str] = ..., slashing_base_rate: _Optional[str] = ..., slashing_escalation_factor: _Optional[str] = ..., slashing_max_penalty: _Optional[str] = ..., slashing_decay_halflife: _Optional[int] = ..., qdrw_enabled: bool = ..., qdrw_xqore_multiplier: _Optional[str] = ..., qdrw_rep_min_multiplier: _Optional[str] = ..., qdrw_rep_max_multiplier: _Optional[str] = ...) -> None: ...
