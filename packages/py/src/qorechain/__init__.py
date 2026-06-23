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
from .denom import from_base, to_base
from .fees import estimate_fee
from .jsonrpc import AsyncJsonRpcClient, JsonRpcClient, JsonRpcError
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
from .qor import QOR_METHODS, AsyncQorClient, QorClient
from .rest import AsyncRestClient, QoreHttpError, RestClient

__version__ = "0.1.0"

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
    # client
    "QoreChainClient",
    "create_client",
]
