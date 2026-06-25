from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MsgBridgeDeposit(_message.Message):
    __slots__ = ("sender", "source_chain", "source_tx_hash", "asset", "amount", "bridge_validator_sigs", "pqc_commitment")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_CHAIN_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TX_HASH_FIELD_NUMBER: _ClassVar[int]
    ASSET_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_VALIDATOR_SIGS_FIELD_NUMBER: _ClassVar[int]
    PQC_COMMITMENT_FIELD_NUMBER: _ClassVar[int]
    sender: str
    source_chain: str
    source_tx_hash: str
    asset: str
    amount: str
    bridge_validator_sigs: bytes
    pqc_commitment: bytes
    def __init__(self, sender: _Optional[str] = ..., source_chain: _Optional[str] = ..., source_tx_hash: _Optional[str] = ..., asset: _Optional[str] = ..., amount: _Optional[str] = ..., bridge_validator_sigs: _Optional[bytes] = ..., pqc_commitment: _Optional[bytes] = ...) -> None: ...

class MsgBridgeDepositResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgBridgeWithdraw(_message.Message):
    __slots__ = ("sender", "destination_chain", "destination_address", "asset", "amount")
    SENDER_FIELD_NUMBER: _ClassVar[int]
    DESTINATION_CHAIN_FIELD_NUMBER: _ClassVar[int]
    DESTINATION_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    ASSET_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    sender: str
    destination_chain: str
    destination_address: str
    asset: str
    amount: str
    def __init__(self, sender: _Optional[str] = ..., destination_chain: _Optional[str] = ..., destination_address: _Optional[str] = ..., asset: _Optional[str] = ..., amount: _Optional[str] = ...) -> None: ...

class MsgBridgeWithdrawResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgRegisterBridgeValidator(_message.Message):
    __slots__ = ("validator_address", "pqc_pubkey", "supported_chains")
    VALIDATOR_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    PQC_PUBKEY_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_CHAINS_FIELD_NUMBER: _ClassVar[int]
    validator_address: str
    pqc_pubkey: bytes
    supported_chains: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, validator_address: _Optional[str] = ..., pqc_pubkey: _Optional[bytes] = ..., supported_chains: _Optional[_Iterable[str]] = ...) -> None: ...

class MsgRegisterBridgeValidatorResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgBridgeAttestation(_message.Message):
    __slots__ = ("validator", "chain", "event_type", "operation_id", "tx_hash", "amount", "asset", "proof", "pqc_signature")
    VALIDATOR_FIELD_NUMBER: _ClassVar[int]
    CHAIN_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    OPERATION_ID_FIELD_NUMBER: _ClassVar[int]
    TX_HASH_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    ASSET_FIELD_NUMBER: _ClassVar[int]
    PROOF_FIELD_NUMBER: _ClassVar[int]
    PQC_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    validator: str
    chain: str
    event_type: str
    operation_id: str
    tx_hash: str
    amount: str
    asset: str
    proof: bytes
    pqc_signature: bytes
    def __init__(self, validator: _Optional[str] = ..., chain: _Optional[str] = ..., event_type: _Optional[str] = ..., operation_id: _Optional[str] = ..., tx_hash: _Optional[str] = ..., amount: _Optional[str] = ..., asset: _Optional[str] = ..., proof: _Optional[bytes] = ..., pqc_signature: _Optional[bytes] = ...) -> None: ...

class MsgBridgeAttestationResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
