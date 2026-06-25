from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgRegisterSidechain(_message.Message):
    __slots__ = ("creator", "layer_id", "description", "target_block_time_ms", "max_transactions_per_block", "min_validators", "settlement_interval_blocks", "supported_vm_types", "supported_domains")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TARGET_BLOCK_TIME_MS_FIELD_NUMBER: _ClassVar[int]
    MAX_TRANSACTIONS_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    MIN_VALIDATORS_FIELD_NUMBER: _ClassVar[int]
    SETTLEMENT_INTERVAL_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_VM_TYPES_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_DOMAINS_FIELD_NUMBER: _ClassVar[int]
    creator: str
    layer_id: str
    description: str
    target_block_time_ms: int
    max_transactions_per_block: int
    min_validators: int
    settlement_interval_blocks: int
    supported_vm_types: _containers.RepeatedScalarFieldContainer[str]
    supported_domains: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, creator: _Optional[str] = ..., layer_id: _Optional[str] = ..., description: _Optional[str] = ..., target_block_time_ms: _Optional[int] = ..., max_transactions_per_block: _Optional[int] = ..., min_validators: _Optional[int] = ..., settlement_interval_blocks: _Optional[int] = ..., supported_vm_types: _Optional[_Iterable[str]] = ..., supported_domains: _Optional[_Iterable[str]] = ...) -> None: ...

class MsgRegisterSidechainResponse(_message.Message):
    __slots__ = ("layer_id", "chain_id", "status")
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    layer_id: str
    chain_id: str
    status: str
    def __init__(self, layer_id: _Optional[str] = ..., chain_id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class MsgRegisterPaychain(_message.Message):
    __slots__ = ("creator", "layer_id", "description", "max_transactions_per_block", "settlement_interval_blocks", "base_fee_multiplier")
    CREATOR_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MAX_TRANSACTIONS_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    SETTLEMENT_INTERVAL_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    BASE_FEE_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
    creator: str
    layer_id: str
    description: str
    max_transactions_per_block: int
    settlement_interval_blocks: int
    base_fee_multiplier: str
    def __init__(self, creator: _Optional[str] = ..., layer_id: _Optional[str] = ..., description: _Optional[str] = ..., max_transactions_per_block: _Optional[int] = ..., settlement_interval_blocks: _Optional[int] = ..., base_fee_multiplier: _Optional[str] = ...) -> None: ...

class MsgRegisterPaychainResponse(_message.Message):
    __slots__ = ("layer_id", "status")
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    layer_id: str
    status: str
    def __init__(self, layer_id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class MsgAnchorState(_message.Message):
    __slots__ = ("relayer", "layer_id", "layer_height", "state_root", "validator_set_hash", "pqc_aggregate_signature", "transaction_count", "compressed_state_proof")
    RELAYER_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    LAYER_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    VALIDATOR_SET_HASH_FIELD_NUMBER: _ClassVar[int]
    PQC_AGGREGATE_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    TRANSACTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMPRESSED_STATE_PROOF_FIELD_NUMBER: _ClassVar[int]
    relayer: str
    layer_id: str
    layer_height: int
    state_root: bytes
    validator_set_hash: bytes
    pqc_aggregate_signature: bytes
    transaction_count: int
    compressed_state_proof: bytes
    def __init__(self, relayer: _Optional[str] = ..., layer_id: _Optional[str] = ..., layer_height: _Optional[int] = ..., state_root: _Optional[bytes] = ..., validator_set_hash: _Optional[bytes] = ..., pqc_aggregate_signature: _Optional[bytes] = ..., transaction_count: _Optional[int] = ..., compressed_state_proof: _Optional[bytes] = ...) -> None: ...

class MsgAnchorStateResponse(_message.Message):
    __slots__ = ("main_chain_height", "accepted")
    MAIN_CHAIN_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    main_chain_height: int
    accepted: bool
    def __init__(self, main_chain_height: _Optional[int] = ..., accepted: bool = ...) -> None: ...

class MsgRouteTransaction(_message.Message):
    __slots__ = ("sender", "transaction_payload", "preferred_layer", "max_latency_ms", "max_fee")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    TRANSACTION_PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    PREFERRED_LAYER_FIELD_NUMBER: _ClassVar[int]
    MAX_LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    MAX_FEE_FIELD_NUMBER: _ClassVar[int]
    sender: str
    transaction_payload: bytes
    preferred_layer: str
    max_latency_ms: int
    max_fee: str
    def __init__(self, sender: _Optional[str] = ..., transaction_payload: _Optional[bytes] = ..., preferred_layer: _Optional[str] = ..., max_latency_ms: _Optional[int] = ..., max_fee: _Optional[str] = ...) -> None: ...

class MsgRouteTransactionResponse(_message.Message):
    __slots__ = ("selected_layer", "reason", "cross_layer_message_id")
    SELECTED_LAYER_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    CROSS_LAYER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    selected_layer: str
    reason: str
    cross_layer_message_id: str
    def __init__(self, selected_layer: _Optional[str] = ..., reason: _Optional[str] = ..., cross_layer_message_id: _Optional[str] = ...) -> None: ...

class MsgUpdateLayerStatus(_message.Message):
    __slots__ = ("authority", "layer_id", "new_status", "reason")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_STATUS_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    authority: str
    layer_id: str
    new_status: str
    reason: str
    def __init__(self, authority: _Optional[str] = ..., layer_id: _Optional[str] = ..., new_status: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class MsgUpdateLayerStatusResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgChallengeAnchor(_message.Message):
    __slots__ = ("challenger", "layer_id", "anchor_height", "fraud_proof", "challenge_reason")
    CHALLENGER_FIELD_NUMBER: _ClassVar[int]
    LAYER_ID_FIELD_NUMBER: _ClassVar[int]
    ANCHOR_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    FRAUD_PROOF_FIELD_NUMBER: _ClassVar[int]
    CHALLENGE_REASON_FIELD_NUMBER: _ClassVar[int]
    challenger: str
    layer_id: str
    anchor_height: int
    fraud_proof: bytes
    challenge_reason: str
    def __init__(self, challenger: _Optional[str] = ..., layer_id: _Optional[str] = ..., anchor_height: _Optional[int] = ..., fraud_proof: _Optional[bytes] = ..., challenge_reason: _Optional[str] = ...) -> None: ...

class MsgChallengeAnchorResponse(_message.Message):
    __slots__ = ("challenge_accepted", "resolution")
    CHALLENGE_ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    challenge_accepted: bool
    resolution: str
    def __init__(self, challenge_accepted: bool = ..., resolution: _Optional[str] = ...) -> None: ...
