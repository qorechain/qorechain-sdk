from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ParamsView(_message.Message):
    __slots__ = ("max_rollups", "min_stake_for_rollup", "rollup_creation_burn_rate", "default_challenge_window", "max_da_blob_size", "blob_retention_blocks", "max_batches_per_block")
    MAX_ROLLUPS_FIELD_NUMBER: _ClassVar[int]
    MIN_STAKE_FOR_ROLLUP_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_CREATION_BURN_RATE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CHALLENGE_WINDOW_FIELD_NUMBER: _ClassVar[int]
    MAX_DA_BLOB_SIZE_FIELD_NUMBER: _ClassVar[int]
    BLOB_RETENTION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MAX_BATCHES_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    max_rollups: int
    min_stake_for_rollup: int
    rollup_creation_burn_rate: str
    default_challenge_window: int
    max_da_blob_size: int
    blob_retention_blocks: int
    max_batches_per_block: int
    def __init__(self, max_rollups: _Optional[int] = ..., min_stake_for_rollup: _Optional[int] = ..., rollup_creation_burn_rate: _Optional[str] = ..., default_challenge_window: _Optional[int] = ..., max_da_blob_size: _Optional[int] = ..., blob_retention_blocks: _Optional[int] = ..., max_batches_per_block: _Optional[int] = ...) -> None: ...

class RollupView(_message.Message):
    __slots__ = ("rollup_id", "creator", "profile", "settlement_mode", "da_backend", "block_time_ms", "max_tx_per_block", "vm_type", "status", "stake_amount", "layer_id", "created_height")
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    SETTLEMENT_MODE_FIELD_NUMBER: _ClassVar[int]
    DA_BACKEND_FIELD_NUMBER: _ClassVar[int]
    BLOCK_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    MAX_TX_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    VM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STAKE_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    creator: str
    profile: str
    settlement_mode: str
    da_backend: str
    block_time_ms: int
    max_tx_per_block: int
    vm_type: str
    status: str
    stake_amount: int
    layer_id: str
    created_height: int
    def __init__(self, rollup_id: _Optional[str] = ..., creator: _Optional[str] = ..., profile: _Optional[str] = ..., settlement_mode: _Optional[str] = ..., da_backend: _Optional[str] = ..., block_time_ms: _Optional[int] = ..., max_tx_per_block: _Optional[int] = ..., vm_type: _Optional[str] = ..., status: _Optional[str] = ..., stake_amount: _Optional[int] = ..., layer_id: _Optional[str] = ..., created_height: _Optional[int] = ...) -> None: ...

class BatchView(_message.Message):
    __slots__ = ("rollup_id", "batch_index", "state_root", "prev_state_root", "tx_count", "data_hash", "proof_type", "status", "submitted_at", "finalized_at", "withdrawals_root")
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    PREV_STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    TX_COUNT_FIELD_NUMBER: _ClassVar[int]
    DATA_HASH_FIELD_NUMBER: _ClassVar[int]
    PROOF_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SUBMITTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINALIZED_AT_FIELD_NUMBER: _ClassVar[int]
    WITHDRAWALS_ROOT_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    batch_index: int
    state_root: str
    prev_state_root: str
    tx_count: int
    data_hash: str
    proof_type: str
    status: str
    submitted_at: int
    finalized_at: int
    withdrawals_root: str
    def __init__(self, rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., state_root: _Optional[str] = ..., prev_state_root: _Optional[str] = ..., tx_count: _Optional[int] = ..., data_hash: _Optional[str] = ..., proof_type: _Optional[str] = ..., status: _Optional[str] = ..., submitted_at: _Optional[int] = ..., finalized_at: _Optional[int] = ..., withdrawals_root: _Optional[str] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("params",)
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    params: ParamsView
    def __init__(self, params: _Optional[_Union[ParamsView, _Mapping]] = ...) -> None: ...

class QueryRollupRequest(_message.Message):
    __slots__ = ("rollup_id",)
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    def __init__(self, rollup_id: _Optional[str] = ...) -> None: ...

class QueryRollupResponse(_message.Message):
    __slots__ = ("rollup",)
    ROLLUP_FIELD_NUMBER: _ClassVar[int]
    rollup: RollupView
    def __init__(self, rollup: _Optional[_Union[RollupView, _Mapping]] = ...) -> None: ...

class QueryRollupsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryRollupsResponse(_message.Message):
    __slots__ = ("rollups",)
    ROLLUPS_FIELD_NUMBER: _ClassVar[int]
    rollups: _containers.RepeatedCompositeFieldContainer[RollupView]
    def __init__(self, rollups: _Optional[_Iterable[_Union[RollupView, _Mapping]]] = ...) -> None: ...

class QueryBatchRequest(_message.Message):
    __slots__ = ("rollup_id", "batch_index")
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    batch_index: int
    def __init__(self, rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ...) -> None: ...

class QueryBatchResponse(_message.Message):
    __slots__ = ("batch",)
    BATCH_FIELD_NUMBER: _ClassVar[int]
    batch: BatchView
    def __init__(self, batch: _Optional[_Union[BatchView, _Mapping]] = ...) -> None: ...

class QueryLatestBatchRequest(_message.Message):
    __slots__ = ("rollup_id",)
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    def __init__(self, rollup_id: _Optional[str] = ...) -> None: ...

class QueryLatestBatchResponse(_message.Message):
    __slots__ = ("batch",)
    BATCH_FIELD_NUMBER: _ClassVar[int]
    batch: BatchView
    def __init__(self, batch: _Optional[_Union[BatchView, _Mapping]] = ...) -> None: ...
