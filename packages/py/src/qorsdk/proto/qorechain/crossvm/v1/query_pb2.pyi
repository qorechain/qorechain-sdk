from google.api import annotations_pb2 as _annotations_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from cosmos.base.query.v1beta1 import pagination_pb2 as _pagination_pb2
from qorsdk.proto.qorechain.crossvm.v1 import tx_pb2 as _tx_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CrossVMMessageView(_message.Message):
    __slots__ = ("id", "source_vm", "target_vm", "sender", "source_contract", "target_contract", "payload_hex", "status", "created_height", "executed_height", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_VM_FIELD_NUMBER: _ClassVar[int]
    TARGET_VM_FIELD_NUMBER: _ClassVar[int]
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    TARGET_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_HEX_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    EXECUTED_HEIGHT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    source_vm: str
    target_vm: str
    sender: str
    source_contract: str
    target_contract: str
    payload_hex: str
    status: str
    created_height: int
    executed_height: int
    error: str
    def __init__(self, id: _Optional[str] = ..., source_vm: _Optional[str] = ..., target_vm: _Optional[str] = ..., sender: _Optional[str] = ..., source_contract: _Optional[str] = ..., target_contract: _Optional[str] = ..., payload_hex: _Optional[str] = ..., status: _Optional[str] = ..., created_height: _Optional[int] = ..., executed_height: _Optional[int] = ..., error: _Optional[str] = ...) -> None: ...

class QueryParamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryParamsResponse(_message.Message):
    __slots__ = ("max_message_size", "max_queue_size", "queue_timeout_blocks", "enabled", "bridge_allowed_targets", "bridge_target_pins", "max_pending_per_sender", "max_cosmos_tx_gas", "record_retention_blocks", "max_block_wasm_gas", "max_tx_wasm_share_bps", "max_block_level_wasm_gas", "queue_wasm_reserve_bps", "wasm_congestion_max_factor", "wasm_congestion_target_bps", "wasm_congestion_factor_micro", "max_block_upload_bps", "max_queue_timeouts_per_block")
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
    WASM_CONGESTION_FACTOR_MICRO_FIELD_NUMBER: _ClassVar[int]
    MAX_BLOCK_UPLOAD_BPS_FIELD_NUMBER: _ClassVar[int]
    MAX_QUEUE_TIMEOUTS_PER_BLOCK_FIELD_NUMBER: _ClassVar[int]
    max_message_size: int
    max_queue_size: int
    queue_timeout_blocks: int
    enabled: bool
    bridge_allowed_targets: _containers.RepeatedScalarFieldContainer[str]
    bridge_target_pins: _containers.RepeatedCompositeFieldContainer[_tx_pb2.BridgeTargetPin]
    max_pending_per_sender: int
    max_cosmos_tx_gas: int
    record_retention_blocks: int
    max_block_wasm_gas: int
    max_tx_wasm_share_bps: int
    max_block_level_wasm_gas: int
    queue_wasm_reserve_bps: int
    wasm_congestion_max_factor: int
    wasm_congestion_target_bps: int
    wasm_congestion_factor_micro: int
    max_block_upload_bps: int
    max_queue_timeouts_per_block: int
    def __init__(self, max_message_size: _Optional[int] = ..., max_queue_size: _Optional[int] = ..., queue_timeout_blocks: _Optional[int] = ..., enabled: bool = ..., bridge_allowed_targets: _Optional[_Iterable[str]] = ..., bridge_target_pins: _Optional[_Iterable[_Union[_tx_pb2.BridgeTargetPin, _Mapping]]] = ..., max_pending_per_sender: _Optional[int] = ..., max_cosmos_tx_gas: _Optional[int] = ..., record_retention_blocks: _Optional[int] = ..., max_block_wasm_gas: _Optional[int] = ..., max_tx_wasm_share_bps: _Optional[int] = ..., max_block_level_wasm_gas: _Optional[int] = ..., queue_wasm_reserve_bps: _Optional[int] = ..., wasm_congestion_max_factor: _Optional[int] = ..., wasm_congestion_target_bps: _Optional[int] = ..., wasm_congestion_factor_micro: _Optional[int] = ..., max_block_upload_bps: _Optional[int] = ..., max_queue_timeouts_per_block: _Optional[int] = ...) -> None: ...

class QueryPendingMessagesRequest(_message.Message):
    __slots__ = ("pagination",)
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    pagination: _pagination_pb2.PageRequest
    def __init__(self, pagination: _Optional[_Union[_pagination_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class QueryPendingMessagesResponse(_message.Message):
    __slots__ = ("messages", "count", "pagination")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[CrossVMMessageView]
    count: int
    pagination: _pagination_pb2.PageResponse
    def __init__(self, messages: _Optional[_Iterable[_Union[CrossVMMessageView, _Mapping]]] = ..., count: _Optional[int] = ..., pagination: _Optional[_Union[_pagination_pb2.PageResponse, _Mapping]] = ...) -> None: ...

class QueryMessageRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class QueryMessageResponse(_message.Message):
    __slots__ = ("message", "found")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FOUND_FIELD_NUMBER: _ClassVar[int]
    message: CrossVMMessageView
    found: bool
    def __init__(self, message: _Optional[_Union[CrossVMMessageView, _Mapping]] = ..., found: bool = ...) -> None: ...
