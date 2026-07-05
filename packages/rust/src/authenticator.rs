//! v3.1.85 authenticator sign-bytes and key-rotation helpers.
//!
//! These mirror `@qorechain/wallet-adapter`'s `authenticator.js` byte-for-byte
//! and rebuild the exact digests the chain re-derives in
//! `x/abstractaccount/types/{evm,cosmos}_sign.go` and `x/pqc` key rotation. A
//! linked external key (a Phantom ed25519 key, or a secp256k1 key) can spend from
//! the ONE unified PQC-required account under least-privilege, spend-limited,
//! revocable terms — via a relayer — WITHOUT that external key ever producing an
//! ML-DSA co-signature:
//!
//! - **EVM lane** ([`evm_auth_sign_bytes`]) — `MsgExecuteEVM`: an EVM
//!   call/transfer from the account's `0x` address.
//! - **Native lane** ([`cosmos_auth_sign_bytes`]) — `MsgExecuteCosmos`: a bank
//!   send from the account (Cosmos).
//!
//! The relayer submits + pays fees (its own hybrid-PQC signature satisfies the
//! ante on the envelope); the authenticator's signature over the
//! domain-separated, replay-bound sign-bytes IS the authorization. A digest
//! mismatch is rejected on-chain (codespace `abstractaccount`, code 11 replay /
//! 10 permission / 5 spending-limit / 6 session-expired).
//!
//! **NONCE.** EVM = the account's CURRENT EVM nonce
//! (`eth_getTransactionCount(account0x)`); because the relayer is a DIFFERENT
//! account than the owner, the relayer envelope does NOT bump the account's nonce,
//! so use the current value as-is (no `+1`). Cosmos = the per-authenticator
//! sequence for `(account, pubkey)` — a store counter distinct from the account's
//! own sequence, incremented on each successful Native-lane spend.

use crate::error::{Error, Result};
use crate::msg::pqc as pqc_msg;
use crate::pqc::{pqc_keypair_from_seed, pqc_sign, PqcKeypair};
use crate::proto::qorechain::pqc::v1 as pb;
use sha2::{Digest, Sha256};
use sha3::digest::{ExtendableOutput, Update, XofReader};
use sha3::Shake256;

// ---- byte helpers (match the chain's binary.BigEndian + length-prefix framing) ----

/// `BE64(n)` — `n` as 8 big-endian bytes.
fn be64(n: u64) -> [u8; 8] {
    n.to_be_bytes()
}

/// `LP(b)` — length-prefixed field: `BE64(len(b)) ‖ b`.
fn lp(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&be64(bytes.len() as u64));
    out.extend_from_slice(bytes);
}

fn sha256_32(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, bytes);
    hasher.finalize().into()
}

fn shake256_32(data: &[u8]) -> [u8; 32] {
    let mut hasher = Shake256::default();
    Update::update(&mut hasher, data);
    let mut reader = hasher.finalize_xof();
    let mut out = [0u8; 32];
    reader.read(&mut out);
    out
}

fn to_hex_lower(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

// ---- sign-bytes (the digest an authenticator signs) ----

/// Rebuilds the 32-byte digest the chain re-derives for a `MsgExecuteEVM`
/// (`types.EVMAuthSignBytes`):
///
/// ```text
/// sha256( "qorechain-evm-auth-v1"
///         ‖ LP(chain_id) ‖ LP(account) ‖ LP(pubkey)
///         ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce) )
/// ```
///
/// `to` is the `0x`-hex recipient string, `value` the decimal wei (aqor) string,
/// `data` the raw calldata, `pubkey` the authenticator's raw public key (32 bytes
/// for ed25519). Returns the 32 bytes the wallet signs.
pub fn evm_auth_sign_bytes(
    chain_id: &str,
    account: &str,
    pubkey: &[u8],
    to: &str,
    value: &str,
    data: &[u8],
    nonce: u64,
) -> [u8; 32] {
    let mut body = Vec::new();
    body.extend_from_slice(b"qorechain-evm-auth-v1");
    lp(&mut body, chain_id.as_bytes());
    lp(&mut body, account.as_bytes());
    lp(&mut body, pubkey);
    lp(&mut body, to.as_bytes());
    lp(&mut body, value.as_bytes());
    lp(&mut body, data);
    body.extend_from_slice(&be64(nonce));
    sha256_32(&body)
}

/// Rebuilds the 32-byte digest the chain re-derives for a `MsgExecuteCosmos`
/// (`types.CosmosAuthSignBytes`):
///
/// ```text
/// sha256( "qorechain-cosmos-auth-v1"
///         ‖ LP(chain_id) ‖ LP(account) ‖ LP(pubkey)
///         ‖ LP(to) ‖ LP(amount) ‖ BE64(nonce) )
/// ```
///
/// `to` is the bech32 recipient, `amount` the CANONICAL `sdk.Coins` string
/// (sorted, e.g. `"100uqor"`). Returns the 32 bytes the wallet signs.
pub fn cosmos_auth_sign_bytes(
    chain_id: &str,
    account: &str,
    pubkey: &[u8],
    to: &str,
    amount: &str,
    nonce: u64,
) -> [u8; 32] {
    let mut body = Vec::new();
    body.extend_from_slice(b"qorechain-cosmos-auth-v1");
    lp(&mut body, chain_id.as_bytes());
    lp(&mut body, account.as_bytes());
    lp(&mut body, pubkey);
    lp(&mut body, to.as_bytes());
    lp(&mut body, amount.as_bytes());
    body.extend_from_slice(&be64(nonce));
    sha256_32(&body)
}

/// Returns the domain-separated STRING both the old and the new key sign for a
/// `MsgRotatePQCKey` (`types.RotationSignBytes`):
///
/// ```text
/// "qorechain-pqc-rotate-v1|<chain_id>|<algorithm_id>|<account>|<old_hex>|<new_hex>"
/// ```
///
/// `old_hex`/`new_hex` are lowercase hex of the public keys. Sign the UTF-8 bytes
/// of this string.
pub fn rotation_sign_bytes(
    chain_id: &str,
    algorithm_id: u32,
    account: &str,
    old_pub: &[u8],
    new_pub: &[u8],
) -> String {
    format!(
        "qorechain-pqc-rotate-v1|{chain_id}|{algorithm_id}|{account}|{}|{}",
        to_hex_lower(old_pub),
        to_hex_lower(new_pub),
    )
}

// ---- key rotation (legacy → canonical migration) ----

/// The LEGACY derivation scheme: `shake256(mnemonic)` (chain-bridge / faucet-api).
pub const DERIVATION_LEGACY: &str = "bridge";
/// The CANONICAL derivation scheme: `shake256("qorechain:pqc:v1|<account>|<mnemonic>")`
/// (SDK / wallet-adapter, address-bound).
pub const DERIVATION_CANONICAL: &str = "adapter";

/// Derives the LEGACY (chain-bridge) ML-DSA-87 keypair for a mnemonic:
/// `keygen(shake256(mnemonic, 32))`. This is the key a backend (chain-bridge /
/// faucet-api) registered before the address-bound derivation existed.
pub fn derive_pqc_legacy(mnemonic: &str) -> PqcKeypair {
    let seed = shake256_32(mnemonic.as_bytes());
    pqc_keypair_from_seed(&seed)
}

/// Derives the CANONICAL (SDK / wallet-adapter) address-bound ML-DSA-87 keypair:
/// `keygen(shake256("qorechain:pqc:v1|" + account + "|" + mnemonic, 32))`.
pub fn derive_pqc_canonical(account: &str, mnemonic: &str) -> PqcKeypair {
    let mut msg = Vec::new();
    msg.extend_from_slice(b"qorechain:pqc:v1|");
    msg.extend_from_slice(account.as_bytes());
    msg.push(b'|');
    msg.extend_from_slice(mnemonic.as_bytes());
    let seed = shake256_32(&msg);
    pqc_keypair_from_seed(&seed)
}

fn derive_pqc_by_scheme(scheme: &str, account: &str, mnemonic: &str) -> Result<PqcKeypair> {
    match scheme {
        DERIVATION_LEGACY | "mnemonic-only" => Ok(derive_pqc_legacy(mnemonic)),
        DERIVATION_CANONICAL | "" => Ok(derive_pqc_canonical(account, mnemonic)),
        other => Err(Error::Pqc(format!(
            "unknown derivation \"{other}\" (use adapter|bridge)"
        ))),
    }
}

/// The result of [`rotate_pqc_key_msg_from_mnemonic`]: the dual-signed
/// `MsgRotatePQCKey` plus both derived keypairs (so the caller can broadcast the
/// message hybrid-cosigned with the OLD key, still registered until the rotation
/// lands).
#[derive(Debug, Clone)]
pub struct RotateFromMnemonic {
    /// The dual-signed `MsgRotatePQCKey`.
    pub msg: pb::MsgRotatePqcKey,
    /// The OLD-derivation keypair (the currently-registered key).
    pub old_keypair: PqcKeypair,
    /// The NEW-derivation keypair (the key being rotated to).
    pub new_keypair: PqcKeypair,
}

/// Options for [`rotate_pqc_key_msg_from_mnemonic`].
#[derive(Debug, Clone)]
pub struct RotateFromMnemonicOptions<'a> {
    /// The account (bech32) whose PQC key is rotated; also `sender` of the msg.
    pub account: &'a str,
    /// The mnemonic both derivations share.
    pub mnemonic: &'a str,
    /// The chain-id bound into the rotation sign-bytes.
    pub chain_id: &'a str,
    /// The algorithm id (1 = ML-DSA-87 / Dilithium-5). Defaults via [`Default`].
    pub algorithm_id: u32,
    /// The derivation to rotate FROM. Defaults to [`DERIVATION_LEGACY`].
    pub old_derivation: &'a str,
    /// The derivation to rotate TO. Defaults to [`DERIVATION_CANONICAL`].
    pub new_derivation: &'a str,
}

impl<'a> RotateFromMnemonicOptions<'a> {
    /// A default legacy→canonical rotation for `account`/`mnemonic`/`chain_id`
    /// (algorithm 1, `bridge` → `adapter`).
    pub fn new(account: &'a str, mnemonic: &'a str, chain_id: &'a str) -> Self {
        Self {
            account,
            mnemonic,
            chain_id,
            algorithm_id: 1,
            old_derivation: DERIVATION_LEGACY,
            new_derivation: DERIVATION_CANONICAL,
        }
    }
}

/// Builds a dual-signed `MsgRotatePQCKey` that rotates an account's ML-DSA-87 key
/// (SAME algorithm) from one derivation to another.
///
/// The canonical use is migrating a LEGACY chain-bridge key (`shake256(mnemonic)`)
/// to the canonical address-bound key
/// (`shake256("qorechain:pqc:v1|addr|mnemonic")`), so a wallet whose key was
/// registered by a backend can move to the standard derivation. Both keys
/// dual-sign the domain-separated rotation bytes (deterministic ML-DSA-87). The
/// returned message must be broadcast BY the account, hybrid-cosigned with the OLD
/// key (still the registered key until the rotation lands).
///
/// Fails if the two derivations produce the same public key (a no-op rotation).
pub fn rotate_pqc_key_msg_from_mnemonic(
    opts: &RotateFromMnemonicOptions<'_>,
) -> Result<RotateFromMnemonic> {
    let old_kp = derive_pqc_by_scheme(opts.old_derivation, opts.account, opts.mnemonic)?;
    let new_kp = derive_pqc_by_scheme(opts.new_derivation, opts.account, opts.mnemonic)?;
    if old_kp.public_key == new_kp.public_key {
        return Err(Error::Pqc(
            "old and new derivations produce the same key — rotation would be a no-op".into(),
        ));
    }
    let sb = rotation_sign_bytes(
        opts.chain_id,
        opts.algorithm_id,
        opts.account,
        &old_kp.public_key,
        &new_kp.public_key,
    );
    let old_signature = pqc_sign(&old_kp.secret_key, sb.as_bytes())?;
    let new_signature = pqc_sign(&new_kp.secret_key, sb.as_bytes())?;
    let msg = pqc_msg::rotate_pqc_key(
        opts.account,
        old_kp.public_key.clone(),
        new_kp.public_key.clone(),
        old_signature,
        new_signature,
    );
    Ok(RotateFromMnemonic {
        msg,
        old_keypair: old_kp,
        new_keypair: new_kp,
    })
}
