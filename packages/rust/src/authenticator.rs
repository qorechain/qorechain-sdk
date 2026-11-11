//! v3.1.85 authenticator sign-bytes and key-rotation helpers.
//!
//! These mirror `@qorechain/wallet-adapter`'s `authenticator.js` byte-for-byte
//! and rebuild the exact digests the chain re-derives in
//! `x/abstractaccount/types/{evm,cosmos}_sign.go` and `x/pqc` key rotation. A
//! linked external key (a Phantom ed25519 key, or a secp256k1 key) can spend from
//! the ONE unified PQC-required account under least-privilege, spend-limited,
//! revocable terms - via a relayer - WITHOUT that external key ever producing an
//! ML-DSA co-signature:
//!
//! - **EVM lane** ([`evm_auth_sign_bytes`]) - `MsgExecuteEVM`: an EVM
//!   call/transfer from the account's `0x` address.
//! - **Native lane** ([`cosmos_auth_sign_bytes`]) - `MsgExecuteCosmos`: a bank
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

/// `BE64(n)` - `n` as 8 big-endian bytes.
fn be64(n: u64) -> [u8; 8] {
    n.to_be_bytes()
}

/// `LP(b)` - length-prefixed field: `BE64(len(b)) ‖ b`.
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
/// exactly one form per block: v1 below the v3.2.3 upgrade, v2 from it - pick
/// with [`evm_auth_digest_version`].
///
/// # Errors
///
/// [`Error::Pqc`](crate::Error::Pqc) when `gas_limit` is zero; the chain
/// refuses it. [`Error::InvalidInput`](crate::Error::InvalidInput) when it is
/// above the EVM gas cap ([`crate::tx::DEFAULT_EVM_TX_MAX_GAS`], chain v3.2.8).
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
    // From chain v3.2.8 an EVM gas limit above the cap is refused.
    crate::tx::validate_evm_gas_limit(gas_limit, None)?;
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
/// When the node cannot be asked - never guess, the other form is refused.
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
/// `cosmos` is `account` resolved by [`canonical_account`] - so an upper-case
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
            "old and new derivations produce the same key - rotation would be a no-op".into(),
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

// ---- authenticator link possession proof (chain v3.2.8) ----

/// The first line of the text a key signs to prove it may be linked
/// ([`authenticator_link_message`]).
pub const AUTHENTICATOR_LINK_HEADER: &str = "QoreChain authenticator link v1";

/// The `ed25519` authenticator scheme.
pub const SCHEME_ED25519: &str = "ed25519";
/// The `secp256k1` authenticator scheme (a 33-byte compressed key, or a 20-byte
/// Ethereum address for MetaMask-style links).
pub const SCHEME_SECP256K1: &str = "secp256k1";

/// The text the key being linked signs for `MsgRegisterAuthenticator.possession_proof`
/// (required from chain v3.2.8):
///
/// ```text
/// QoreChain authenticator link v1
/// chain: <chain_id>
/// account: <account_address>
/// scheme: <scheme>
/// key: <lowercase hex of pubkey>
/// ```
///
/// Lines are joined with `"\n"`, with no trailing newline. `account_address` is
/// the message's `account_address` and `pubkey` exactly the bytes put in its
/// `pubkey` field: a 32-byte ed25519 key, a 33-byte compressed secp256k1 key, or
/// the 20-byte Ethereum address of a MetaMask-style link.
///
/// How the chain checks the proof, per key:
/// - ed25519: an ed25519 signature over these UTF-8 bytes (a wallet's
///   `signMessage(text)`).
/// - secp256k1, 33-byte key: a 64-byte `r || s` (low-S) ECDSA signature over
///   `sha256(text)`.
/// - secp256k1, 20-byte address: an EIP-191 `personal_sign` of the text, 65
///   bytes `r || s || v` with `v` 27/28 (0/1 also accepted).
///
/// A browser wallet signs this text itself; the `authenticator_link_proof_*`
/// helpers sign it from a local private key.
pub fn authenticator_link_message(
    chain_id: &str,
    account_address: &str,
    scheme: &str,
    pubkey: &[u8],
) -> String {
    format!(
        "{AUTHENTICATOR_LINK_HEADER}\nchain: {chain_id}\naccount: {account_address}\nscheme: {scheme}\nkey: {}",
        to_hex_lower(pubkey)
    )
}

/// A key to link plus its possession proof, from the
/// `authenticator_link_proof_*` helpers. Pass the three fields to
/// [`crate::msg::abstractaccount::register_authenticator`] or
/// [`crate::msg::abstractaccount::link_authenticator_msgs`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatorLinkProof {
    /// The scheme (`"ed25519"` or `"secp256k1"`).
    pub scheme: String,
    /// The bytes to put in `MsgRegisterAuthenticator.pubkey`.
    pub pubkey: Vec<u8>,
    /// The signature to put in `MsgRegisterAuthenticator.possession_proof`.
    pub possession_proof: Vec<u8>,
}

/// Signs the link text for an ed25519 key given its 32-byte seed (private key),
/// as a Phantom-style wallet would with `signMessage`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the seed is not 32 bytes.
pub fn authenticator_link_proof_ed25519(
    seed: &[u8],
    chain_id: &str,
    account_address: &str,
) -> Result<AuthenticatorLinkProof> {
    use ed25519_dalek::Signer;
    let seed: [u8; 32] = seed.try_into().map_err(|_| {
        Error::InvalidInput(format!(
            "ed25519 link proof: the seed must be 32 bytes, got {}",
            seed.len()
        ))
    })?;
    let key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let pubkey = key.verifying_key().to_bytes().to_vec();
    let text = authenticator_link_message(chain_id, account_address, SCHEME_ED25519, &pubkey);
    let sig = key.sign(text.as_bytes());
    Ok(AuthenticatorLinkProof {
        scheme: SCHEME_ED25519.into(),
        pubkey,
        possession_proof: sig.to_bytes().to_vec(),
    })
}

fn secp_signing_key(private_key: &[u8], what: &str) -> Result<k256::ecdsa::SigningKey> {
    k256::ecdsa::SigningKey::from_slice(private_key)
        .map_err(|e| Error::InvalidInput(format!("{what}: invalid secp256k1 private key: {e}")))
}

/// Signs the link text for a secp256k1 key in its 33-byte compressed form: a
/// 64-byte `r || s` (low-S) signature over `sha256(text)`.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the private key is not a valid secp256k1 scalar.
pub fn authenticator_link_proof_secp256k1(
    private_key: &[u8],
    chain_id: &str,
    account_address: &str,
) -> Result<AuthenticatorLinkProof> {
    use k256::ecdsa::signature::hazmat::PrehashSigner;
    let key = secp_signing_key(private_key, "secp256k1 link proof")?;
    let pubkey = key
        .verifying_key()
        .to_encoded_point(true)
        .as_bytes()
        .to_vec();
    let text = authenticator_link_message(chain_id, account_address, SCHEME_SECP256K1, &pubkey);
    let digest = sha256_32(text.as_bytes());
    let sig: k256::ecdsa::Signature = key
        .sign_prehash(&digest)
        .map_err(|e| Error::InvalidInput(format!("secp256k1 link proof: {e}")))?;
    let sig = sig.normalize_s().unwrap_or(sig);
    Ok(AuthenticatorLinkProof {
        scheme: SCHEME_SECP256K1.into(),
        pubkey,
        possession_proof: sig.to_bytes().to_vec(),
    })
}

/// The EIP-191 `personal_sign` digest of `text`:
/// `keccak256("\x19Ethereum Signed Message:\n" + len(text) + text)`.
pub fn eip191_digest(text: &[u8]) -> [u8; 32] {
    use sha3::Keccak256;
    let mut h = Keccak256::new();
    Digest::update(
        &mut h,
        format!("\x19Ethereum Signed Message:\n{}", text.len()).as_bytes(),
    );
    Digest::update(&mut h, text);
    h.finalize().into()
}

fn eth_address_of(key: &k256::ecdsa::VerifyingKey) -> [u8; 20] {
    use sha3::Keccak256;
    let point = key.to_encoded_point(false);
    let hash = Keccak256::digest(&point.as_bytes()[1..]);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..]);
    out
}

/// Signs the link text for a MetaMask-style link: the `pubkey` is the 20-byte
/// Ethereum address of the secp256k1 key and the proof an EIP-191
/// `personal_sign` of the text, 65 bytes `r || s || v` with `v` 27/28.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the private key is not a valid secp256k1 scalar.
pub fn authenticator_link_proof_eip191(
    private_key: &[u8],
    chain_id: &str,
    account_address: &str,
) -> Result<AuthenticatorLinkProof> {
    let key = secp_signing_key(private_key, "EIP-191 link proof")?;
    let pubkey = eth_address_of(key.verifying_key()).to_vec();
    let text = authenticator_link_message(chain_id, account_address, SCHEME_SECP256K1, &pubkey);
    let digest = eip191_digest(text.as_bytes());
    let (sig, recid) = key
        .sign_prehash_recoverable(&digest)
        .map_err(|e| Error::InvalidInput(format!("EIP-191 link proof: {e}")))?;
    let mut proof = sig.to_bytes().to_vec();
    proof.push(27 + recid.to_byte());
    Ok(AuthenticatorLinkProof {
        scheme: SCHEME_SECP256K1.into(),
        pubkey,
        possession_proof: proof,
    })
}

/// Checks a possession proof the way the chain does from v3.2.8 (see
/// [`authenticator_link_message`]), so a wrong proof is caught before it is
/// broadcast.
///
/// # Errors
///
/// [`Error::InvalidInput`] naming what does not match: an empty proof, a key of
/// the wrong length (a 65-byte uncompressed secp256k1 key is refused), a
/// scheme other than `ed25519` / `secp256k1`, or a signature that does not
/// verify.
pub fn verify_authenticator_link_proof(
    chain_id: &str,
    account_address: &str,
    scheme: &str,
    pubkey: &[u8],
    possession_proof: &[u8],
) -> Result<()> {
    use k256::ecdsa::signature::hazmat::PrehashVerifier;
    let bad = |m: String| Error::InvalidInput(format!("authenticator link proof: {m}"));
    if possession_proof.is_empty() {
        return Err(bad(missing_proof_hint()));
    }
    let text = authenticator_link_message(chain_id, account_address, scheme, pubkey);
    match (scheme, pubkey.len()) {
        (SCHEME_ED25519, 32) => {
            let key_bytes: [u8; 32] = pubkey.try_into().expect("length checked");
            let key = ed25519_dalek::VerifyingKey::from_bytes(&key_bytes)
                .map_err(|e| bad(format!("invalid ed25519 key: {e}")))?;
            let sig = ed25519_dalek::Signature::from_slice(possession_proof)
                .map_err(|_| bad("an ed25519 proof is 64 bytes".into()))?;
            key.verify_strict(text.as_bytes(), &sig)
                .map_err(|_| bad("the ed25519 signature does not verify".into()))
        }
        (SCHEME_SECP256K1, 33) => {
            let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(pubkey)
                .map_err(|e| bad(format!("invalid secp256k1 key: {e}")))?;
            let sig = k256::ecdsa::Signature::from_slice(possession_proof)
                .map_err(|_| bad("a secp256k1 proof is 64 bytes r || s".into()))?;
            if sig.normalize_s().is_some() {
                return Err(bad("the secp256k1 signature is not low-S".into()));
            }
            key.verify_prehash(&sha256_32(text.as_bytes()), &sig)
                .map_err(|_| bad("the secp256k1 signature does not verify".into()))
        }
        (SCHEME_SECP256K1, 20) => {
            if possession_proof.len() != 65 {
                return Err(bad("an EIP-191 proof is 65 bytes r || s || v".into()));
            }
            let v = possession_proof[64];
            let rec = match v {
                27 | 28 => v - 27,
                0 | 1 => v,
                _ => return Err(bad(format!("EIP-191 v must be 27/28 (or 0/1), got {v}"))),
            };
            let sig = k256::ecdsa::Signature::from_slice(&possession_proof[..64])
                .map_err(|_| bad("invalid EIP-191 signature".into()))?;
            let recid = k256::ecdsa::RecoveryId::from_byte(rec)
                .ok_or_else(|| bad("invalid EIP-191 recovery id".into()))?;
            let key = k256::ecdsa::VerifyingKey::recover_from_prehash(
                &eip191_digest(text.as_bytes()),
                &sig,
                recid,
            )
            .map_err(|_| bad("the EIP-191 signature does not recover a key".into()))?;
            if eth_address_of(&key).as_slice() != pubkey {
                return Err(bad(
                    "the EIP-191 signature was made by another address".into(),
                ));
            }
            Ok(())
        }
        (SCHEME_SECP256K1, 65) => Err(bad(
            "an uncompressed 65-byte secp256k1 key is refused; link the 33-byte compressed key"
                .into(),
        )),
        (SCHEME_ED25519 | SCHEME_SECP256K1, n) => Err(bad(format!(
            "a {scheme} key of {n} bytes cannot be linked (ed25519: 32; secp256k1: 33, or a 20-byte Ethereum address)"
        ))),
        _ => Err(bad(format!(
            "unknown scheme {scheme:?} (use \"ed25519\" or \"secp256k1\")"
        ))),
    }
}

/// How to make a possession proof, for the error a missing one returns.
pub(crate) fn missing_proof_hint() -> String {
    "possession_proof is required from chain v3.2.8: sign \
     authenticator_link_message(chain_id, account_address, scheme, pubkey) with the key being \
     linked (or use authenticator_link_proof_ed25519 / _secp256k1 / _eip191)"
        .into()
}
