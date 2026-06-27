from cosmos.msg.v1 import msg_pb2 as _msg_pb2
from cosmos_proto import cosmos_pb2 as _cosmos_pb2
from gogoproto import gogo_pb2 as _gogo_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MsgUpdateChainConfig(_message.Message):
    __slots__ = ("admin", "chain_id", "bridge_contract", "confirmations_required", "architecture", "status", "verifier", "lock_event_sig")
    ADMIN_FIELD_NUMBER: _ClassVar[int]
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    BRIDGE_CONTRACT_FIELD_NUMBER: _ClassVar[int]
    CONFIRMATIONS_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    ARCHITECTURE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    VERIFIER_FIELD_NUMBER: _ClassVar[int]
    LOCK_EVENT_SIG_FIELD_NUMBER: _ClassVar[int]
    admin: str
    chain_id: str
    bridge_contract: str
    confirmations_required: int
    architecture: str
    status: str
    verifier: str
    lock_event_sig: str
    def __init__(self, admin: _Optional[str] = ..., chain_id: _Optional[str] = ..., bridge_contract: _Optional[str] = ..., confirmations_required: _Optional[int] = ..., architecture: _Optional[str] = ..., status: _Optional[str] = ..., verifier: _Optional[str] = ..., lock_event_sig: _Optional[str] = ...) -> None: ...

class MsgUpdateChainConfigResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MsgSetVerifierBootstrap(_message.Message):
    __slots__ = ("admin", "chain_id", "wormhole", "ed25519", "bls", "bitcoin", "starknet_state_root")
    ADMIN_FIELD_NUMBER: _ClassVar[int]
    CHAIN_ID_FIELD_NUMBER: _ClassVar[int]
    WORMHOLE_FIELD_NUMBER: _ClassVar[int]
    ED25519_FIELD_NUMBER: _ClassVar[int]
    BLS_FIELD_NUMBER: _ClassVar[int]
    BITCOIN_FIELD_NUMBER: _ClassVar[int]
    STARKNET_STATE_ROOT_FIELD_NUMBER: _ClassVar[int]
    admin: str
    chain_id: str
    wormhole: WormholeGuardianSet
    ed25519: ValidatorQuorum
    bls: ValidatorQuorum
    bitcoin: BitcoinCheckpoint
    starknet_state_root: bytes
    def __init__(self, admin: _Optional[str] = ..., chain_id: _Optional[str] = ..., wormhole: _Optional[_Union[WormholeGuardianSet, _Mapping]] = ..., ed25519: _Optional[_Union[ValidatorQuorum, _Mapping]] = ..., bls: _Optional[_Union[ValidatorQuorum, _Mapping]] = ..., bitcoin: _Optional[_Union[BitcoinCheckpoint, _Mapping]] = ..., starknet_state_root: _Optional[bytes] = ...) -> None: ...

class MsgSetVerifierBootstrapResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class WormholeGuardianSet(_message.Message):
    __slots__ = ("addresses", "quorum")
    ADDRESSES_FIELD_NUMBER: _ClassVar[int]
    QUORUM_FIELD_NUMBER: _ClassVar[int]
    addresses: _containers.RepeatedScalarFieldContainer[bytes]
    quorum: int
    def __init__(self, addresses: _Optional[_Iterable[bytes]] = ..., quorum: _Optional[int] = ...) -> None: ...

class ValidatorQuorum(_message.Message):
    __slots__ = ("pubkeys", "threshold")
    PUBKEYS_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    pubkeys: _containers.RepeatedScalarFieldContainer[bytes]
    threshold: int
    def __init__(self, pubkeys: _Optional[_Iterable[bytes]] = ..., threshold: _Optional[int] = ...) -> None: ...

class BitcoinCheckpoint(_message.Message):
    __slots__ = ("block_hash", "min_confs")
    BLOCK_HASH_FIELD_NUMBER: _ClassVar[int]
    MIN_CONFS_FIELD_NUMBER: _ClassVar[int]
    block_hash: bytes
    min_confs: int
    def __init__(self, block_hash: _Optional[bytes] = ..., min_confs: _Optional[int] = ...) -> None: ...

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

class MsgUpdateEthLightClient(_message.Message):
    __slots__ = ("relayer", "update")
    RELAYER_FIELD_NUMBER: _ClassVar[int]
    UPDATE_FIELD_NUMBER: _ClassVar[int]
    relayer: str
    update: bytes
    def __init__(self, relayer: _Optional[str] = ..., update: _Optional[bytes] = ...) -> None: ...

class MsgUpdateEthLightClientResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
