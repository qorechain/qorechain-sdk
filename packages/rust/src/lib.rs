//! QoreChain SDK for Rust.
//!
//! This crate mirrors the QoreChain TypeScript, Python, and Go SDKs and
//! provides the building blocks dApp developers need to talk to a QoreChain
//! network:
//!
//! - [`networks`] — built-in network presets (testnet is live; mainnet is a
//!   not-yet-live placeholder).
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

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod accounts;
pub mod address;
pub mod client;
pub mod denom;
pub mod error;
pub mod networks;
pub mod pqc;
pub mod query;
pub mod tx;

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

pub use query::{JsonRpcClient, QorClient, RestClient, QOR_METHODS};

pub use client::{create_client, Client, ClientBuilder, Fees};

pub use tx::{
    bank_send, broadcast, build_hybrid_tx, fee_from_estimate, BankSendParams, BroadcastMode,
    BuildHybridTxParams, BuiltTx, Coin, Fee, Message, MSG_SEND_TYPE_URL,
};
