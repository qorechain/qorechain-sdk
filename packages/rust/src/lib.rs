//! QoreChain SDK for Rust.
//!
//! This crate mirrors the QoreChain TypeScript, Python, and Go SDKs and
//! provides the building blocks dApp developers need to talk to a QoreChain
//! network:
//!
//! - [`networks`] — built-in network presets (testnet and mainnet, both live).
//! - [`denom`] — exact integer conversion between display and base amounts.
//! - [`address`] — bech32 / hex address conversion and validation.
//! - [`accounts`] — BIP-39 mnemonics and HD derivation of native (Cosmos-style
//!   secp256k1), EVM (secp256k1), and SVM (ed25519) accounts.
//! - [`pqc`] — post-quantum ML-DSA-87 (FIPS 204) keygen / sign / verify and the
//!   on-chain hybrid-signature extension builder.
//! - [`query`] — async REST (LCD) and JSON-RPC read clients, including the typed
//!   `qor_*` namespace.
//! - [`client`] — the top-level [`create_client`](client::create_client)
//!   factory.
//! - [`tx`] — native bank-send building/signing, REST broadcast, and end-to-end
//!   hybrid (classical + ML-DSA-87) transaction signing.
//! - [`ai`] — EVM AI pre-flight precompiles (`aiRiskScore` / `aiAnomalyCheck`)
//!   over `eth_call`, plus an advisory `simulate_with_risk_score`.
//! - [`cross_vm`] — high-level unified cross-VM call helper (build / sign /
//!   broadcast `MsgCrossVMCall`, including atomic multi-call txs).
//! - [`pqc_dx`] — high-level quantum-safe DX helper (idempotent PQC-key
//!   registration, status reads, key rotation, and a bound hybrid send path).

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod accounts;
pub mod address;
pub mod ai;
pub mod client;
pub mod cross_vm;
pub mod denom;
pub mod error;
pub mod msg;
pub mod networks;
pub mod pqc;
pub mod pqc_dx;
pub mod proto;
pub mod query;
pub mod subscribe;
pub mod tx;
pub mod utils;

pub use error::{Error, Result};

pub use networks::{
    get_network, list_networks, networks, Bech32Prefixes, CoinInfo, Endpoints, NetworkConfig,
};

pub use denom::{from_base, to_base, DEFAULT_EXPONENT};

pub use address::{bech32_to_hex, bytes_to_bech32, hex_to_bech32, is_valid_bech32, DEFAULT_PREFIX};

pub use accounts::{
    derive_evm_account, derive_native_account, derive_svm_account, generate_mnemonic,
    validate_mnemonic, Ed25519Account, Secp256k1Account,
};

pub use pqc::{
    build_hybrid_signature_extension, generate_pqc_keypair, pqc_sign, pqc_verify,
    HybridSignatureExtension, PqcKeypair, ALGORITHM_DILITHIUM5, ALGORITHM_MLKEM1024,
    HYBRID_SIG_TYPE_URL, MLDSA87_PUBLIC_KEY_LEN, MLDSA87_SECRET_KEY_LEN, MLDSA87_SIGNATURE_LEN,
};

pub use query::{JsonRpcClient, QorClient, RestClient, TypedQueryClient, QOR_METHODS};

pub use client::{create_client, Client, ClientBuilder, Fees};

pub use tx::{
    bank_send, broadcast, broadcast_and_wait, build_hybrid_tx, calculate_fee, decode_tx_error,
    estimate_fee, estimate_gas, fee_from_estimate, get_block, get_latest_block, get_tx, search_txs,
    send_messages, wait_for_tx, with_retry, BankSendParams, BroadcastMode, BuildHybridTxParams,
    BuiltTx, Coin, Fee, GasPrice, Message, QoreTxError, SendMessagesParams, TxResult,
    TxSearchResult, WaitOptions, MSG_SEND_TYPE_URL,
};

pub use subscribe::{Event, SubscribeClient, Subscription};

pub use ai::{
    AiClient, Anomaly, Preflight, PreflightTx, RiskScore, Score, AI_ANOMALY_CHECK_PRECOMPILE,
    AI_RISK_SCORE_PRECOMPILE,
};

pub use cross_vm::{
    CallOptions, CrossVm, Payload, VM_TYPES, VM_TYPE_COSMWASM, VM_TYPE_EVM, VM_TYPE_SVM,
};

pub use pqc_dx::{
    EnsureResult, HybridSendPath, MigrateKeyOptions, PqcDx, PqcStatus, DEFAULT_KEY_TYPE,
    PQC_KEY_STATUS_PRECOMPILE,
};

pub use utils::{
    format_units, hash160, is_valid_evm_address, is_valid_svm_address, keccak256, parse_units,
    ripemd160, sha256, to_checksum_address,
};
