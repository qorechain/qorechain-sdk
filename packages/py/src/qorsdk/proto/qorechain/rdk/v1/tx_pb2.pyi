from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgCreateRollup(_message.Message):
    __slots__ = ("creator", "rollup_id", "profile", "vm_type", "stake_amount")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    VM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STAKE_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    profile: str
    vm_type: str
    stake_amount: int
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ..., profile: _Optional[str] = ..., vm_type: _Optional[str] = ..., stake_amount: _Optional[int] = ...) -> None: ...

class MsgCreateRollupResponse(_message.Message):
    __slots__ = ("rollup_id",)
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    def __init__(self, rollup_id: _Optional[str] = ...) -> None: ...

class MsgSubmitBatch(_message.Message):
    __slots__ = ("sequencer", "rollup_id", "batch_index", "state_root", "prev_state_root", "tx_count", "data_hash", "proof", "withdrawals_root")
    SEQUENCER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    PREV_STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    TX_COUNT_FIELD_NUMBER: _ClassVar[int]
    DATA_HASH_FIELD_NUMBER: _ClassVar[int]
    PROOF_FIELD_NUMBER: _ClassVar[int]
    WITHDRAWALS_ROOT_FIELD_NUMBER: _ClassVar[int]
    sequencer: str
    rollup_id: str
    batch_index: int
    state_root: bytes
    prev_state_root: bytes
    tx_count: int
    data_hash: bytes
    proof: bytes
    withdrawals_root: bytes
    def __init__(self, sequencer: _Optional[str] = ..., rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., state_root: _Optional[bytes] = ..., prev_state_root: _Optional[bytes] = ..., tx_count: _Optional[int] = ..., data_hash: _Optional[bytes] = ..., proof: _Optional[bytes] = ..., withdrawals_root: _Optional[bytes] = ...) -> None: ...

class MsgSubmitBatchResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgChallengeBatch(_message.Message):
    __slots__ = ("challenger", "rollup_id", "batch_index", "proof")
    CHALLENGER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    PROOF_FIELD_NUMBER: _ClassVar[int]
    challenger: str
    rollup_id: str
    batch_index: int
    proof: bytes
    def __init__(self, challenger: _Optional[str] = ..., rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., proof: _Optional[bytes] = ...) -> None: ...

class MsgChallengeBatchResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgResolveChallenge(_message.Message):
    __slots__ = ("resolver", "rollup_id", "batch_index", "fraud_upheld")
    RESOLVER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    FRAUD_UPHELD_FIELD_NUMBER: _ClassVar[int]
    resolver: str
    rollup_id: str
    batch_index: int
    fraud_upheld: bool
    def __init__(self, resolver: _Optional[str] = ..., rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., fraud_upheld: bool = ...) -> None: ...

class MsgResolveChallengeResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgPauseRollup(_message.Message):
    __slots__ = ("creator", "rollup_id", "reason")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    reason: str
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class MsgPauseRollupResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgResumeRollup(_message.Message):
    __slots__ = ("creator", "rollup_id")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ...) -> None: ...

class MsgResumeRollupResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgStopRollup(_message.Message):
    __slots__ = ("creator", "rollup_id")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ...) -> None: ...

class MsgStopRollupResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgExecuteWithdrawal(_message.Message):
    __slots__ = ("submitter", "rollup_id", "batch_index", "withdrawal_index", "recipient", "denom", "amount", "proof")
    SUBMITTER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    WITHDRAWAL_INDEX_FIELD_NUMBER: _ClassVar[int]
    RECIPIENT_FIELD_NUMBER: _ClassVar[int]
    DENOM_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    PROOF_FIELD_NUMBER: _ClassVar[int]
    submitter: str
    rollup_id: str
    batch_index: int
    withdrawal_index: int
    recipient: str
    denom: str
    amount: int
    proof: _containers.RepeatedScalarFieldContainer[bytes]
    def __init__(self, submitter: _Optional[str] = ..., rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., withdrawal_index: _Optional[int] = ..., recipient: _Optional[str] = ..., denom: _Optional[str] = ..., amount: _Optional[int] = ..., proof: _Optional[_Iterable[bytes]] = ...) -> None: ...

class MsgExecuteWithdrawalResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
