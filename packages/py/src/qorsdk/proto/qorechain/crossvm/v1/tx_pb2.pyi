from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from cosmos.base.v1beta1 import coin_pb2 as _coin_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgCrossVMCall(_message.Message):
    __slots__ = ("sender", "source_vm", "target_vm", "target_contract", "payload", "funds", "async_gas_limit", "async_max_factor")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    FUNDS_FIELD_NUMBER: _ClassVar[int]
    ASYNC_FIELD_NUMBER: _ClassVar[int]
    ASYNC_GAS_LIMIT_FIELD_NUMBER: _ClassVar[int]
    ASYNC_MAX_FACTOR_FIELD_NUMBER: _ClassVar[int]
    sender: str
    source_vm: str
    target_vm: str
    target_contract: str
    payload: bytes
    funds: _containers.RepeatedCompositeFieldContainer[_coin_pb2.Coin]
    async_gas_limit: int
    async_max_factor: int
    def __init__(self, sender: _Optional[str] = ..., source_vm: _Optional[str] = ..., target_vm: _Optional[str] = ..., target_contract: _Optional[str] = ..., payload: _Optional[bytes] = ..., funds: _Optional[_Iterable[_Union[_coin_pb2.Coin, _Mapping]]] = ..., async_gas_limit: _Optional[int] = ..., async_max_factor: _Optional[int] = ..., **kwargs) -> None: ...

class MsgCrossVMCallResponse(_message.Message):
    __slots__ = ("message_id", "executed", "data", "gas_used")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTED_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    GAS_USED_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    executed: bool
    data: bytes
    gas_used: int
    def __init__(self, message_id: _Optional[str] = ..., executed: bool = ..., data: _Optional[bytes] = ..., gas_used: _Optional[int] = ...) -> None: ...

class MsgProcessQueue(_message.Message):
    __slots__ = ("authority",)
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    authority: str
    def __init__(self, authority: _Optional[str] = ...) -> None: ...

class MsgProcessQueueResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgUpdateParams(_message.Message):
    __slots__ = ("authority", "max_message_size", "max_queue_size", "queue_timeout_blocks", "enabled", "bridge_allowed_targets", "bridge_target_pins", "max_pending_per_sender", "max_cosmos_tx_gas", "record_retention_blocks", "max_block_wasm_gas", "max_tx_wasm_share_bps", "max_block_level_wasm_gas", "queue_wasm_reserve_bps", "wasm_congestion_max_factor", "wasm_congestion_target_bps", "max_block_upload_bps", "max_queue_timeouts_per_block")
    AUTHORITY_FIELD_NUMBER: _ClassVar[int]
    MAX_MESSAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    MAX_QUEUE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUEUE_TIMEOUT_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_ALLOWED_TARGETS_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_TARGET_PINS_FIELD_NUMBER: _ClassVar[int]
    MAX_PENDING_PER_SENDER_FIELD_NUMBER: _ClassVar[int]
    MAX_COSMOS_TX_GAS_FIELD_NUMBER: _ClassVar[int]
    RECORD_RETENTION_BLOCKS_FIELD_NUMBER: _ClassVar[int]
    MAX_BLOCK_WASM_GAS_FIELD_NUMBER: _ClassVar[int]
    MAX_TX_WASM_SHARE_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_BLOCK_LEVEL_WASM_GAS_FIELD_NUMBER: _ClassVar[int]
    QUEUE_WASM_RESERVE_BPS_FIELD_NUMBER: _ClassVar[int]
    WASM_CONGESTION_MAX_FACTOR_FIELD_NUMBER: _ClassVar[int]
    WASM_CONGESTION_TARGET_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_BLOCK_UPLOAD_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_QUEUE_TIMEOUTS_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    authority: str
    max_message_size: int
    max_queue_size: int
    queue_timeout_blocks: int
    enabled: bool
    bridge_allowed_targets: _containers.RepeatedScalarFieldContainer[str]
    bridge_target_pins: _containers.RepeatedCompositeFieldContainer[BridgeTargetPin]
    max_pending_per_sender: int
    max_cosmos_tx_gas: int
    record_retention_blocks: int
    max_block_wasm_gas: int
    max_tx_wasm_share_bps: int
    max_block_level_wasm_gas: int
    queue_wasm_reserve_bps: int
    wasm_congestion_max_factor: int
    wasm_congestion_target_bps: int
    max_block_upload_bps: int
    max_queue_timeouts_per_block: int
    def __init__(self, authority: _Optional[str] = ..., max_message_size: _Optional[int] = ..., max_queue_size: _Optional[int] = ..., queue_timeout_blocks: _Optional[int] = ..., enabled: bool = ..., bridge_allowed_targets: _Optional[_Iterable[str]] = ..., bridge_target_pins: _Optional[_Iterable[_Union[BridgeTargetPin, _Mapping]]] = ..., max_pending_per_sender: _Optional[int] = ..., max_cosmos_tx_gas: _Optional[int] = ..., record_retention_blocks: _Optional[int] = ..., max_block_wasm_gas: _Optional[int] = ..., max_tx_wasm_share_bps: _Optional[int] = ..., max_block_level_wasm_gas: _Optional[int] = ..., queue_wasm_reserve_bps: _Optional[int] = ..., wasm_congestion_max_factor: _Optional[int] = ..., wasm_congestion_target_bps: _Optional[int] = ..., max_block_upload_bps: _Optional[int] = ..., max_queue_timeouts_per_block: _Optional[int] = ...) -> None: ...

class MsgUpdateParamsResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class BridgeTargetPin(_message.Message):
    __slots__ = ("target", "code_id", "history_len")
    TARGET_FIELD_NUMBER: _ClassVar[int]
    CODE_ID_FIELD_NUMBER: _ClassVar[int]
    HISTORY_LEN_FIELD_NUMBER: _ClassVar[int]
    target: str
    code_id: int
    history_len: int
    def __init__(self, target: _Optional[str] = ..., code_id: _Optional[int] = ..., history_len: _Optional[int] = ...) -> None: ...
