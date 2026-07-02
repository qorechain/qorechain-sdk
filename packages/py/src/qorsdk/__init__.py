"""QoreChain Python SDK.

A typed, pip-installable mirror of the QoreChain TypeScript SDK: network presets,
denom/address utilities, HD account derivation (native / EVM / SVM), post-quantum
(ML-DSA-87) signing primitives, and read clients (REST + ``qor_`` JSON-RPC).
"""

from __future__ import annotations

from .accounts import (
    Ed25519Account,
    Secp256k1Account,
    derive_evm_account,
    derive_native_account,
    derive_svm_account,
    generate_mnemonic,
    validate_mnemonic,
)
from .address import (
    bech32_to_hex,
    bytes_to_bech32,
    hex_to_bech32,
    is_valid_bech32,
)
from .client import QoreChainClient, create_client
from .cross_vm import (
    VM_TYPES,
    CrossVmCallOptions,
    CrossVmClient,
    build_cross_vm_call,
    create_cross_vm_client,
)
from .denom import from_base, to_base
from .errors import (
    DecodedTxError,
    QoreTxError,
    decode_tx_error,
    is_tx_failure,
    tx_error_from,
)
from .fees import estimate_fee
from .gas import (
    DEFAULT_GAS_MULTIPLIER,
    DEFAULT_GAS_PRICE,
    GasPrice,
    auto_fee,
    calculate_fee,
    estimate_gas,
    simulate_gas_used,
)
from .jsonrpc import AsyncJsonRpcClient, JsonRpcClient, JsonRpcError
from .messages import (
    COSMOS_REGISTRY_TYPES,
    QORECHAIN_REGISTRY_TYPES,
    Msg,
    composer,
    decode_any,
    msg,
    qorechain_registry,
    resolve_message_type,
)
from .networks import (
    NETWORKS,
    Bech32Prefixes,
    CoinInfo,
    NetworkConfig,
    NetworkEndpoints,
    get_network,
    list_networks,
)
from .pqc import (
    ALGORITHM_DILITHIUM5,
    ALGORITHM_MLKEM1024,
    ALGORITHM_UNSPECIFIED,
    HYBRID_SIG_TYPE_URL,
    ML_DSA_87_PUBLIC_KEY_LENGTH,
    ML_DSA_87_SECRET_KEY_LENGTH,
    ML_DSA_87_SIGNATURE_LENGTH,
    PqcKeypair,
    algorithm_name,
    build_hybrid_signature_extension,
    generate_pqc_keypair,
    is_signature_algorithm,
    pqc_sign,
    pqc_verify,
)
from .pqc_dx import (
    DILITHIUM5_KEY_TYPE,
    HYBRID_KEY_TYPE,
    EnsureResult,
    PqcStatus,
    build_migrate_pqc_key,
    build_register_pqc_key,
    ensure_pqc_registered,
    get_pqc_status,
    get_pqc_status_async,
    is_pqc_registered,
    is_pqc_registered_async,
    migrate_pqc_key,
    migrate_to_hybrid,
)
from .precompiles import (
    PRECOMPILE_AI_ANOMALY_CHECK,
    PRECOMPILE_AI_RISK_SCORE,
    ai_anomaly_check,
    ai_risk_score,
    encode_ai_anomaly_check,
    encode_ai_risk_score,
    simulate_with_risk_score,
)
from .qor import QOR_METHODS, AsyncQorClient, QorClient
from .query import QueryClients, connect_query_clients
from .rest import AsyncRestClient, QoreHttpError, RestClient
from .search import (
    build_events_query,
    get_block,
    get_latest_block,
    get_tx,
    search_txs,
)
from .subscribe import SubscriptionClient, build_tx_query
from .track import (
    IncludedTx,
    broadcast_and_wait,
    wait_for_tx,
    with_retry,
)
from .tx import (
    MSG_SEND_TYPE_URL,
    BroadcastMode,
    BuiltTx,
    bank_send,
    broadcast,
    build_hybrid_tx,
    send_messages,
)
from .utils import (
    format_units,
    is_checksum_address,
    is_valid_evm_address,
    is_valid_svm_address,
    keccak256,
    keccak256_hex,
    parse_units,
    ripemd160,
    ripemd160_hex,
    sha256,
    sha256_hex,
    to_checksum_address,
)

__version__ = "0.5.1"

__all__ = [
    "__version__",
    # networks
    "NETWORKS",
    "Bech32Prefixes",
    "CoinInfo",
    "NetworkConfig",
    "NetworkEndpoints",
    "get_network",
    "list_networks",
    # denom
    "to_base",
    "from_base",
    # address
    "bech32_to_hex",
    "hex_to_bech32",
    "bytes_to_bech32",
    "is_valid_bech32",
    # accounts
    "Secp256k1Account",
    "Ed25519Account",
    "generate_mnemonic",
    "validate_mnemonic",
    "derive_native_account",
    "derive_evm_account",
    "derive_svm_account",
    # pqc
    "ALGORITHM_UNSPECIFIED",
    "ALGORITHM_DILITHIUM5",
    "ALGORITHM_MLKEM1024",
    "HYBRID_SIG_TYPE_URL",
    "ML_DSA_87_PUBLIC_KEY_LENGTH",
    "ML_DSA_87_SECRET_KEY_LENGTH",
    "ML_DSA_87_SIGNATURE_LENGTH",
    "PqcKeypair",
    "algorithm_name",
    "is_signature_algorithm",
    "generate_pqc_keypair",
    "pqc_sign",
    "pqc_verify",
    "build_hybrid_signature_extension",
    # quantum-safe DX (x/pqc key registry)
    "DILITHIUM5_KEY_TYPE",
    "HYBRID_KEY_TYPE",
    "PqcStatus",
    "EnsureResult",
    "get_pqc_status",
    "is_pqc_registered",
    "get_pqc_status_async",
    "is_pqc_registered_async",
    "build_register_pqc_key",
    "build_migrate_pqc_key",
    "ensure_pqc_registered",
    "migrate_to_hybrid",
    "migrate_pqc_key",
    # query
    "RestClient",
    "AsyncRestClient",
    "QoreHttpError",
    "JsonRpcClient",
    "AsyncJsonRpcClient",
    "JsonRpcError",
    "QorClient",
    "AsyncQorClient",
    "QOR_METHODS",
    "estimate_fee",
    # tx
    "MSG_SEND_TYPE_URL",
    "BroadcastMode",
    "BuiltTx",
    "bank_send",
    "send_messages",
    "build_hybrid_tx",
    "broadcast",
    # messages
    "Msg",
    "composer",
    "msg",
    "qorechain_registry",
    "resolve_message_type",
    "decode_any",
    "QORECHAIN_REGISTRY_TYPES",
    "COSMOS_REGISTRY_TYPES",
    # typed query clients
    "QueryClients",
    "connect_query_clients",
    # gas / auto-fee
    "GasPrice",
    "calculate_fee",
    "estimate_gas",
    "simulate_gas_used",
    "auto_fee",
    "DEFAULT_GAS_MULTIPLIER",
    "DEFAULT_GAS_PRICE",
    # errors
    "DecodedTxError",
    "QoreTxError",
    "decode_tx_error",
    "is_tx_failure",
    "tx_error_from",
    # tx tracking
    "IncludedTx",
    "wait_for_tx",
    "broadcast_and_wait",
    "with_retry",
    # search
    "get_tx",
    "get_block",
    "get_latest_block",
    "search_txs",
    "build_events_query",
    # subscriptions
    "SubscriptionClient",
    "build_tx_query",
    # utils
    "sha256",
    "sha256_hex",
    "keccak256",
    "keccak256_hex",
    "ripemd160",
    "ripemd160_hex",
    "parse_units",
    "format_units",
    "is_valid_evm_address",
    "to_checksum_address",
    "is_checksum_address",
    "is_valid_svm_address",
    # client
    "QoreChainClient",
    "create_client",
    # AI pre-flight (EVM precompiles)
    "PRECOMPILE_AI_RISK_SCORE",
    "PRECOMPILE_AI_ANOMALY_CHECK",
    "ai_risk_score",
    "ai_anomaly_check",
    "simulate_with_risk_score",
    "encode_ai_risk_score",
    "encode_ai_anomaly_check",
    # unified cross-VM call
    "VM_TYPES",
    "CrossVmCallOptions",
    "CrossVmClient",
    "build_cross_vm_call",
    "create_cross_vm_client",
]
