from google.api import annotations_pb2 as _annotations_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class BridgeConfigView(_message.Message):
    __slots__ = ("min_validators", "attestation_threshold", "challenge_period_secs", "large_transfer_threshold", "enabled")
    MIN_VALIDATORS_FIELD_NUMBER: _ClassVar[int]
    ATTESTATION_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    CHALLENGE_PERIOD_SECS_FIELD_NUMBER: _ClassVar[int]
    LARGE_TRANSFER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    min_validators: int
    attestation_threshold: int
    challenge_period_secs: int
    large_transfer_threshold: str
    enabled: bool
    def __init__(self, min_validators: _Optional[int] = ..., attestation_threshold: _Optional[int] = ..., challenge_period_secs: _Optional[int] = ..., large_transfer_threshold: _Optional[str] = ..., enabled: bool = ...) -> None: ...

class ChainConfigView(_message.Message):
    __slots__ = ("chain_id", "name", "chain_type", "bridge_contract", "status", "min_confirmations", "architecture", "ibc_channel_id", "ibc_port_id")
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    CHAIN_TYPE_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MIN_CONFIRMATIONS_FIELD_NUMBER: _ClassVar[int]
    ARCHITECTURE_FIELD_NUMBER: _ClassVar[int]
    IBC_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    IBC_PORT_ID_FIELD_NUMBER: _ClassVar[int]
    chain_id: str
    name: str
    chain_type: str
    bridge_contract: str
    status: str
    min_confirmations: int
    architecture: str
    ibc_channel_id: str
    ibc_port_id: str
    def __init__(self, chain_id: _Optional[str] = ..., name: _Optional[str] = ..., chain_type: _Optional[str] = ..., bridge_contract: _Optional[str] = ..., status: _Optional[str] = ..., min_confirmations: _Optional[int] = ..., architecture: _Optional[str] = ..., ibc_channel_id: _Optional[str] = ..., ibc_port_id: _Optional[str] = ...) -> None: ...

class BridgeValidatorView(_message.Message):
    __slots__ = ("address", "supported_chains", "reputation", "active", "registered_at")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_CHAINS_FIELD_NUMBER: _ClassVar[int]
    REPUTATION_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    REGISTERED_AT_FIELD_NUMBER: _ClassVar[int]
    address: str
    supported_chains: _containers.RepeatedScalarFieldContainer[str]
    reputation: str
    active: bool
    registered_at: int
    def __init__(self, address: _Optional[str] = ..., supported_chains: _Optional[_Iterable[str]] = ..., reputation: _Optional[str] = ..., active: bool = ..., registered_at: _Optional[int] = ...) -> None: ...

class BridgeOperationView(_message.Message):
    __slots__ = ("id", "type", "source_chain", "dest_chain", "sender", "receiver", "asset", "amount", "source_tx_hash", "status")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_CHAIN_FIELD_NUMBER: _ClassVar[int]
    DEST_CHAIN_FIELD_NUMBER: _ClassVar[int]
    SENDER_FIELD_NUMBER: _ClassVar[int]
    RECEIVER_FIELD_NUMBER: _ClassVar[int]
    ASSET_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TX_HASH_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: str
    source_chain: str
    dest_chain: str
    sender: str
    receiver: str
    asset: str
    amount: str
    source_tx_hash: str
    status: str
    def __init__(self, id: _Optional[str] = ..., type: _Optional[str] = ..., source_chain: _Optional[str] = ..., dest_chain: _Optional[str] = ..., sender: _Optional[str] = ..., receiver: _Optional[str] = ..., asset: _Optional[str] = ..., amount: _Optional[str] = ..., source_tx_hash: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class QueryConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: BridgeConfigView
    def __init__(self, config: _Optional[_Union[BridgeConfigView, _Mapping]] = ...) -> None: ...

class QueryChainConfigRequest(_message.Message):
    __slots__ = ("chain_id",)
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    chain_id: str
    def __init__(self, chain_id: _Optional[str] = ...) -> None: ...

class QueryChainConfigResponse(_message.Message):
    __slots__ = ("chain",)
    CHAIN_FIELD_NUMBER: _ClassVar[int]
    chain: ChainConfigView
    def __init__(self, chain: _Optional[_Union[ChainConfigView, _Mapping]] = ...) -> None: ...

class QueryChainConfigsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryChainConfigsResponse(_message.Message):
    __slots__ = ("chains",)
    CHAINS_FIELD_NUMBER: _ClassVar[int]
    chains: _containers.RepeatedCompositeFieldContainer[ChainConfigView]
    def __init__(self, chains: _Optional[_Iterable[_Union[ChainConfigView, _Mapping]]] = ...) -> None: ...

class QueryValidatorRequest(_message.Message):
    __slots__ = ("address",)
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    address: str
    def __init__(self, address: _Optional[str] = ...) -> None: ...

class QueryValidatorResponse(_message.Message):
    __slots__ = ("validator",)
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    validator: BridgeValidatorView
    def __init__(self, validator: _Optional[_Union[BridgeValidatorView, _Mapping]] = ...) -> None: ...

class QueryValidatorsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryValidatorsResponse(_message.Message):
    __slots__ = ("validators",)
    VALIDATORS_FIELD_NUMBER: _ClassVar[int]
    validators: _containers.RepeatedCompositeFieldContainer[BridgeValidatorView]
    def __init__(self, validators: _Optional[_Iterable[_Union[BridgeValidatorView, _Mapping]]] = ...) -> None: ...

class QueryOperationRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class QueryOperationResponse(_message.Message):
    __slots__ = ("operation",)
    OPERATION_FIELD_NUMBER: _ClassVar[int]
    operation: BridgeOperationView
    def __init__(self, operation: _Optional[_Union[BridgeOperationView, _Mapping]] = ...) -> None: ...

class QueryOperationsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class QueryOperationsResponse(_message.Message):
    __slots__ = ("operations",)
    OPERATIONS_FIELD_NUMBER: _ClassVar[int]
    operations: _containers.RepeatedCompositeFieldContainer[BridgeOperationView]
    def __init__(self, operations: _Optional[_Iterable[_Union[BridgeOperationView, _Mapping]]] = ...) -> None: ...
