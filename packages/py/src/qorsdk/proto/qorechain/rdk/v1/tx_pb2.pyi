from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgCreateRollup(_message.Message):
    __slots__ = ("creator", "rollup_id", "profile", "vm_type", "stake_amount", "verification_key", "sequencing", "execution_vm", "privacy")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    PROFILE_FIELD_NUMBER: _ClassVar[int]
    VM_TYPE_FIELD_NUMBER: _ClassVar[int]
    STAKE_AMOUNT_FIELD_NUMBER: _ClassVar[int]
    VERIFICATION_KEY_FIELD_NUMBER: _ClassVar[int]
    SEQUENCING_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_VM_FIELD_NUMBER: _ClassVar[int]
    PRIVACY_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    profile: str
    vm_type: str
    stake_amount: int
    verification_key: bytes
    sequencing: str
    execution_vm: str
    privacy: str
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ..., profile: _Optional[str] = ..., vm_type: _Optional[str] = ..., stake_amount: _Optional[int] = ..., verification_key: _Optional[bytes] = ..., sequencing: _Optional[str] = ..., execution_vm: _Optional[str] = ..., privacy: _Optional[str] = ...) -> None: ...

class MsgCreateRollupResponse(_message.Message):
    __slots__ = ("rollup_id",)
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    rollup_id: str
    def __init__(self, rollup_id: _Optional[str] = ...) -> None: ...

class MsgSubmitBatch(_message.Message):
    __slots__ = ("sequencer", "rollup_id", "batch_index", "state_root", "prev_state_root", "tx_count", "data_hash", "proof", "withdrawals_root", "anchor_signature", "validator_set_hash", "inbox_end")
    SEQUENCER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    BATCH_INDEX_FIELD_NUMBER: _ClassVar[int]
    STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    PREV_STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    TX_COUNT_FIELD_NUMBER: _ClassVar[int]
    DATA_HASH_FIELD_NUMBER: _ClassVar[int]
    PROOF_FIELD_NUMBER: _ClassVar[int]
    WITHDRAWALS_ROOT_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_SET_HASH_FIELD_NUMBER: _ClassVar[int]
    INBOX_END_FIELD_NUMBER: _ClassVar[int]
    sequencer: str
    rollup_id: str
    batch_index: int
    state_root: bytes
    prev_state_root: bytes
    tx_count: int
    data_hash: bytes
    proof: bytes
    withdrawals_root: bytes
    anchor_signature: bytes
    validator_set_hash: bytes
    inbox_end: int
    def __init__(self, sequencer: _Optional[str] = ..., rollup_id: _Optional[str] = ..., batch_index: _Optional[int] = ..., state_root: _Optional[bytes] = ..., prev_state_root: _Optional[bytes] = ..., tx_count: _Optional[int] = ..., data_hash: _Optional[bytes] = ..., proof: _Optional[bytes] = ..., withdrawals_root: _Optional[bytes] = ..., anchor_signature: _Optional[bytes] = ..., validator_set_hash: _Optional[bytes] = ..., inbox_end: _Optional[int] = ...) -> None: ...

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

class MsgUpdateParams(_message.Message):
    __slots__ = ("authority", "max_rollups", "min_stake_for_rollup", "rollup_creation_burn_rate", "default_challenge_window", "max_da_blob_size", "blob_retention_blocks", "max_batches_per_block", "finalized_batch_retention_blocks", "max_posted_data_bytes", "max_posted_data_bytes_per_block", "posted_data_fee_per_byte", "posted_data_retention_blocks", "min_submitter_bond")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    MAX_ROLLUPS_FIELD_NUMBER: _ClassVar[int]
    MIN_STAKE_FOR_ROLLUP_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_CREATION_BURN_RATE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CHALLENGE_WINDOW_FIELD_NUMBER: _ClassVar[int]
    MAX_DA_BLOB_SIZE_FIELD_NUMBER: _ClassVar[int]
    BLOB_RETENTION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MAX_BATCHES_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    FINALIZED_BATCH_RETENTION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MAX_POSTED_DATA_BYTES_FIELD_NUMBER: _ClassVar[int]
    MAX_POSTED_DATA_BYTES_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    POSTED_DATA_FEE_PER_BYTE_FIELD_NUMBER: _ClassVar[int]
    POSTED_DATA_RETENTION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MIN_SUBMITTER_BOND_FIELD_NUMBER: _ClassVar[int]
    authority: str
    max_rollups: int
    min_stake_for_rollup: int
    rollup_creation_burn_rate: str
    default_challenge_window: int
    max_da_blob_size: int
    blob_retention_blocks: int
    max_batches_per_block: int
    finalized_batch_retention_blocks: int
    max_posted_data_bytes: int
    max_posted_data_bytes_per_block: int
    posted_data_fee_per_byte: int
    posted_data_retention_blocks: int
    min_submitter_bond: int
    def __init__(self, authority: _Optional[str] = ..., max_rollups: _Optional[int] = ..., min_stake_for_rollup: _Optional[int] = ..., rollup_creation_burn_rate: _Optional[str] = ..., default_challenge_window: _Optional[int] = ..., max_da_blob_size: _Optional[int] = ..., blob_retention_blocks: _Optional[int] = ..., max_batches_per_block: _Optional[int] = ..., finalized_batch_retention_blocks: _Optional[int] = ..., max_posted_data_bytes: _Optional[int] = ..., max_posted_data_bytes_per_block: _Optional[int] = ..., posted_data_fee_per_byte: _Optional[int] = ..., posted_data_retention_blocks: _Optional[int] = ..., min_submitter_bond: _Optional[int] = ...) -> None: ...

class MsgUpdateParamsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgSetVerificationKey(_message.Message):
    __slots__ = ("creator", "rollup_id", "verification_key", "proof_system")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    VERIFICATION_KEY_FIELD_NUMBER: _ClassVar[int]
    PROOF_SYSTEM_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    verification_key: bytes
    proof_system: str
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ..., verification_key: _Optional[bytes] = ..., proof_system: _Optional[str] = ...) -> None: ...

class MsgSetVerificationKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgUpdateVerificationKey(_message.Message):
    __slots__ = ("authority", "rollup_id", "verification_key", "proof_system")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    VERIFICATION_KEY_FIELD_NUMBER: _ClassVar[int]
    PROOF_SYSTEM_FIELD_NUMBER: _ClassVar[int]
    authority: str
    rollup_id: str
    verification_key: bytes
    proof_system: str
    def __init__(self, authority: _Optional[str] = ..., rollup_id: _Optional[str] = ..., verification_key: _Optional[bytes] = ..., proof_system: _Optional[str] = ...) -> None: ...

class MsgUpdateVerificationKeyResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgPostRollupData(_message.Message):
    __slots__ = ("poster", "rollup_id", "data")
    POSTER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    poster: str
    rollup_id: str
    data: bytes
    def __init__(self, poster: _Optional[str] = ..., rollup_id: _Optional[str] = ..., data: _Optional[bytes] = ...) -> None: ...

class MsgPostRollupDataResponse(_message.Message):
    __slots__ = ("sequence", "data_hash")
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    DATA_HASH_FIELD_NUMBER: _ClassVar[int]
    sequence: int
    data_hash: bytes
    def __init__(self, sequence: _Optional[int] = ..., data_hash: _Optional[bytes] = ...) -> None: ...

class MsgSetRollupSequencing(_message.Message):
    __slots__ = ("authority", "rollup_id", "sequencing")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCING_FIELD_NUMBER: _ClassVar[int]
    authority: str
    rollup_id: str
    sequencing: str
    def __init__(self, authority: _Optional[str] = ..., rollup_id: _Optional[str] = ..., sequencing: _Optional[str] = ...) -> None: ...

class MsgSetRollupSequencingResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgDepositToRollup(_message.Message):
    __slots__ = ("depositor", "rollup_id", "account", "amount")
    DEPOSITOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    depositor: str
    rollup_id: str
    account: bytes
    amount: int
    def __init__(self, depositor: _Optional[str] = ..., rollup_id: _Optional[str] = ..., account: _Optional[bytes] = ..., amount: _Optional[int] = ...) -> None: ...

class MsgDepositToRollupResponse(_message.Message):
    __slots__ = ("sequence",)
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    sequence: int
    def __init__(self, sequence: _Optional[int] = ...) -> None: ...

class MsgBondRollupSubmitter(_message.Message):
    __slots__ = ("submitter", "rollup_id", "amount")
    SUBMITTER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    submitter: str
    rollup_id: str
    amount: int
    def __init__(self, submitter: _Optional[str] = ..., rollup_id: _Optional[str] = ..., amount: _Optional[int] = ...) -> None: ...

class MsgBondRollupSubmitterResponse(_message.Message):
    __slots__ = ("bond",)
    BOND_FIELD_NUMBER: _ClassVar[int]
    bond: int
    def __init__(self, bond: _Optional[int] = ...) -> None: ...

class MsgUnbondRollupSubmitter(_message.Message):
    __slots__ = ("submitter", "rollup_id")
    SUBMITTER_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    submitter: str
    rollup_id: str
    def __init__(self, submitter: _Optional[str] = ..., rollup_id: _Optional[str] = ...) -> None: ...

class MsgUnbondRollupSubmitterResponse(_message.Message):
    __slots__ = ("returned",)
    RETURNED_FIELD_NUMBER: _ClassVar[int]
    returned: int
    def __init__(self, returned: _Optional[int] = ...) -> None: ...

class MsgSetRollupMembers(_message.Message):
    __slots__ = ("creator", "rollup_id", "members")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    ROLLUP_ID_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    creator: str
    rollup_id: str
    members: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, creator: _Optional[str] = ..., rollup_id: _Optional[str] = ..., members: _Optional[_Iterable[str]] = ...) -> None: ...

class MsgSetRollupMembersResponse(_message.Message):
    __slots__ = ("epoch",)
    EPOCH_FIELD_NUMBER: _ClassVar[int]
    epoch: int
    def __init__(self, epoch: _Optional[int] = ...) -> None: ...
