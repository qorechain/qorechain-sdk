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
//! **NONCE.** Both lanes use the per-authenticator sequence for
//! `(account, pubkey)`: a counter the chain keeps for each linked key, starting
//! at 0 and incremented by each successful execution. For `MsgExecuteEVM` it is
//! NOT the account's EVM nonce (the chain checks this counter since v3.2.0).
//! Read it with [`fetch_auth_nonce`] (chain v3.2.4); a mismatch is refused
//! with abstractaccount code 11.

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

/// The v2 digest of a `MsgExecuteEVM` (chain v3.2.3, `abstractaccount-hardening`):
///
/// ```text
/// sha256( "qorechain-evm-auth-v2"
///         ‖ LP(chain_id) ‖ LP(account) ‖ LP(pubkey)
///         ‖ LP(to) ‖ LP(value) ‖ LP(data) ‖ BE64(nonce) ‖ BE64(gas_limit) )
/// ```
///
/// v1 left the gas limit to whoever relayed the message. The chain verifies
/// exactly one form per block: v1 below the v3.2.3 upgrade, v2 from it — pick
/// with [`evm_auth_digest_version`].
///
/// # Errors
///
/// [`Error::Pqc`](crate::Error::Pqc) when `gas_limit` is zero; the chain
/// refuses it.
#[allow(clippy::too_many_arguments)]
pub fn evm_auth_sign_bytes_v2(
    chain_id: &str,
    account: &str,
    pubkey: &[u8],
    to: &str,
    value: &str,
    data: &[u8],
    nonce: u64,
    gas_limit: u64,
) -> crate::Result<[u8; 32]> {
    if gas_limit == 0 {
        return Err(crate::Error::Pqc(
            "gas_limit must be set (non-zero): the v2 digest binds it and the chain refuses 0"
                .into(),
        ));
    }
    let mut body = Vec::new();
    body.extend_from_slice(b"qorechain-evm-auth-v2");
    lp(&mut body, chain_id.as_bytes());
    lp(&mut body, account.as_bytes());
    lp(&mut body, pubkey);
    lp(&mut body, to.as_bytes());
    lp(&mut body, value.as_bytes());
    lp(&mut body, data);
    body.extend_from_slice(&be64(nonce));
    body.extend_from_slice(&be64(gas_limit));
    Ok(sha256_32(&body))
}

/// The `MsgExecuteEVM` digest the network verifies now: `"v2"` once it has
/// applied v3.2.3, `"v1"` before.
///
/// # Errors
///
/// When the node cannot be asked — never guess, the other form is refused.
pub async fn evm_auth_digest_version(
    rest: &crate::query::RestClient,
    cache_key: Option<&str>,
) -> crate::Result<&'static str> {
    let applied =
        crate::upgrades::is_upgrade_applied(rest, crate::upgrades::CHAIN_UPGRADE_V3_2_3, cache_key)
            .await?;
    Ok(if applied { "v2" } else { "v1" })
}

/// A linked key's sequence, from [`fetch_auth_nonce`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AuthNonce {
    /// The nonce the next `MsgExecuteEVM` / `MsgExecuteCosmos` from this key
    /// must carry.
    pub nonce: u64,
    /// Whether the key is currently linked (present and not revoked); the
    /// counter is kept either way.
    pub linked: bool,
}

/// An authenticator public key for [`fetch_auth_nonce`]: raw bytes, or hex
/// (`0x` optional).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthPubkey<'a> {
    /// The raw public key.
    Bytes(&'a [u8]),
    /// The public key as hex, `0x` optional.
    Hex(&'a str),
}

impl<'a> From<&'a [u8]> for AuthPubkey<'a> {
    fn from(b: &'a [u8]) -> Self {
        AuthPubkey::Bytes(b)
    }
}

impl<'a, const N: usize> From<&'a [u8; N]> for AuthPubkey<'a> {
    fn from(b: &'a [u8; N]) -> Self {
        AuthPubkey::Bytes(b)
    }
}

impl<'a> From<&'a Vec<u8>> for AuthPubkey<'a> {
    fn from(b: &'a Vec<u8>) -> Self {
        AuthPubkey::Bytes(b)
    }
}

impl<'a> From<&'a str> for AuthPubkey<'a> {
    fn from(s: &'a str) -> Self {
        AuthPubkey::Hex(s)
    }
}

impl<'a> From<&'a String> for AuthPubkey<'a> {
    fn from(s: &'a String) -> Self {
        AuthPubkey::Hex(s)
    }
}

/// The REST path of the `auth_nonce` query for `(address, pubkey)`. Bytes are
/// rendered lowercase hex; a hex key is passed as given, without its `0x`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the key is empty, not hex, or of odd length.
pub fn auth_nonce_path<'a>(address: &str, pubkey: impl Into<AuthPubkey<'a>>) -> Result<String> {
    let hex = match pubkey.into() {
        AuthPubkey::Bytes(b) => to_hex_lower(b),
        AuthPubkey::Hex(s) => s
            .strip_prefix("0x")
            .or_else(|| s.strip_prefix("0X"))
            .unwrap_or(s)
            .to_string(),
    };
    if hex.is_empty() || hex.len() % 2 != 0 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::InvalidInput(
            "fetch_auth_nonce: pubkey must be bytes or a hex string".into(),
        ));
    }
    Ok(format!(
        "/qorechain/abstractaccount/v1/auth_nonce/{address}/{hex}"
    ))
}

/// Parses an `auth_nonce` payload.
///
/// # Errors
///
/// [`Error::InvalidResponse`] when the answer carries no integer `nonce`.
pub fn parse_auth_nonce(b: &serde_json::Value) -> Result<AuthNonce> {
    let nonce = match &b["nonce"] {
        serde_json::Value::String(s) => s.trim().parse::<u64>().ok(),
        serde_json::Value::Number(n) => n.as_u64(),
        _ => None,
    }
    .ok_or_else(|| {
        Error::InvalidResponse(format!("auth_nonce query: no nonce in the answer: {b}"))
    })?;
    Ok(AuthNonce {
        nonce,
        linked: b["linked"].as_bool().unwrap_or(false),
    })
}

/// Reads the sequence a linked authenticator key must sign next
/// (`/qorechain/abstractaccount/v1/auth_nonce/{address}/{pubkey_hex}`, chain
/// v3.2.4). This is the `nonce` of [`evm_auth_sign_bytes`] /
/// [`evm_auth_sign_bytes_v2`] / [`cosmos_auth_sign_bytes`]: the key's own
/// counter, not the account's EVM nonce. A key that never executed reads 0.
///
/// `address` is the `qor1…` account the key acts for; `pubkey` the
/// authenticator public key, as bytes or hex (`0x` optional).
///
/// # Errors
///
/// [`Error::InvalidInput`] for a key that is not hex (nothing is sent),
/// transport / HTTP errors from the REST client, or [`Error::InvalidResponse`]
/// when the answer carries no nonce.
pub async fn fetch_auth_nonce<'a>(
    rest: &crate::query::RestClient,
    address: &str,
    pubkey: impl Into<AuthPubkey<'a>>,
) -> Result<AuthNonce> {
    let path = auth_nonce_path(address, pubkey)?;
    parse_auth_nonce(&rest.get(&path, &[]).await?)
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
///
/// **Deprecated for new keys:** it is not bound to the account, so one mnemonic
/// yields one key for every account. Keep using it only to recover, or rotate
/// away from, a key registered this way ([`rotate_pqc_key_msg_from_mnemonic`]).
pub fn derive_pqc_legacy(mnemonic: &str) -> PqcKeypair {
    let seed = shake256_32(mnemonic.as_bytes());
    pqc_keypair_from_seed(&seed)
}

/// Resolves `account` to the canonical form the address-bound PQC derivation and
/// the rotation message use: lower-case `qor1…` bech32.
///
/// Accepts a bech32 address in either case (all-lower or all-upper, as bech32
/// allows) or a `0x`/`0X` EVM address, which is re-encoded to its bech32 form.
/// Byte-identical to the Go SDK's resolution (`authenticator.toCosmos`): the
/// 20-byte payload is re-encoded with the `qor` prefix.
pub fn canonical_account(account: &str) -> Result<String> {
    let addr20: [u8; 20] = if account.starts_with("0x") || account.starts_with("0X") {
        let bytes = hex::decode(&account[2..])
            .map_err(|e| Error::Address(format!("invalid hex address: {e}")))?;
        <[u8; 20]>::try_from(bytes.as_slice())
            .map_err(|_| Error::Address(format!("address must be 20 bytes, got {}", bytes.len())))?
    } else {
        let (_, data) = bech32::decode(account).map_err(|e| {
            Error::Address(format!(
                "cannot resolve account \"{account}\" to a bech32 cosmos address: {e}"
            ))
        })?;
        <[u8; 20]>::try_from(data.as_slice()).map_err(|_| {
            Error::Address(format!(
                "bech32 payload must be 20 bytes, got {}",
                data.len()
            ))
        })?
    };
    Ok(crate::unified::addresses_from_20(addr20)?.cosmos)
}

/// Derives the CANONICAL (SDK / wallet-adapter) address-bound ML-DSA-87 keypair:
/// `keygen(shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32))`, where
/// `cosmos` is `account` resolved by [`canonical_account`] — so an upper-case
/// bech32 or a `0x` form of the same account yields the same key.
///
/// Fails if `account` is not a valid 20-byte account address.
pub fn try_derive_pqc_canonical(account: &str, mnemonic: &str) -> Result<PqcKeypair> {
    let cosmos = canonical_account(account)?;
    Ok(derive_pqc_canonical_raw(&cosmos, mnemonic))
}

/// Derives the CANONICAL (SDK / wallet-adapter) address-bound ML-DSA-87 keypair:
/// `keygen(shake256("qorechain:pqc:v1|" + cosmos + "|" + mnemonic, 32))`.
///
/// `account` is first resolved to its canonical lower-case `qor1…` form (see
/// [`canonical_account`]), so an upper-case bech32 or a `0x` form of the same
/// account yields the same key. An `account` that is not a valid address cannot
/// be resolved and is hashed as given (kept for compatibility); prefer
/// [`try_derive_pqc_canonical`], which returns an error instead.
pub fn derive_pqc_canonical(account: &str, mnemonic: &str) -> PqcKeypair {
    match canonical_account(account) {
        Ok(cosmos) => derive_pqc_canonical_raw(&cosmos, mnemonic),
        Err(_) => derive_pqc_canonical_raw(account, mnemonic),
    }
}

fn derive_pqc_canonical_raw(cosmos: &str, mnemonic: &str) -> PqcKeypair {
    let mut msg = Vec::new();
    msg.extend_from_slice(b"qorechain:pqc:v1|");
    msg.extend_from_slice(cosmos.as_bytes());
    msg.push(b'|');
    msg.extend_from_slice(mnemonic.as_bytes());
    let seed = shake256_32(&msg);
    pqc_keypair_from_seed(&seed)
}

fn derive_pqc_by_scheme(scheme: &str, account: &str, mnemonic: &str) -> Result<PqcKeypair> {
    match scheme {
        DERIVATION_LEGACY | "mnemonic-only" => Ok(derive_pqc_legacy(mnemonic)),
        DERIVATION_CANONICAL | "" => try_derive_pqc_canonical(account, mnemonic),
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
    // The sender and the account in the rotation sign-bytes use the canonical
    // lower-case bech32 form, so an upper-case or 0x input builds the same message
    // the canonical input does (matching the Go SDK).
    let account = canonical_account(opts.account)?;
    // The legacy derivation is deprecated for NEW keys (as in the chain CLI); it
    // stays valid as the OLD key of a rotation.
    if opts.new_derivation == DERIVATION_LEGACY || opts.new_derivation == "mnemonic-only" {
        return Err(Error::Pqc(format!(
            "the legacy (bridge) derivation is deprecated for new keys: rotate to the address-bound \
             derivation (\"{DERIVATION_CANONICAL}\"); a legacy key can still be the OLD key of a rotation"
        )));
    }
    let old_kp = derive_pqc_by_scheme(opts.old_derivation, &account, opts.mnemonic)?;
    let new_kp = derive_pqc_by_scheme(opts.new_derivation, &account, opts.mnemonic)?;
    if old_kp.public_key == new_kp.public_key {
        return Err(Error::Pqc(
            "old and new derivations produce the same key — rotation would be a no-op".into(),
        ));
    }
    let sb = rotation_sign_bytes(
        opts.chain_id,
        opts.algorithm_id,
        &account,
        &old_kp.public_key,
        &new_kp.public_key,
    );
    let old_signature = pqc_sign(&old_kp.secret_key, sb.as_bytes())?;
    let new_signature = pqc_sign(&new_kp.secret_key, sb.as_bytes())?;
    let msg = pqc_msg::rotate_pqc_key(
        &account,
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
