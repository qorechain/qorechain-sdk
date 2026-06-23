//! BIP-39 mnemonics and hierarchical-deterministic (HD) derivation of QoreChain
//! accounts in all three supported schemes:
//!
//! 1. native — Cosmos-style secp256k1, BIP-44 path `m/44'/118'/0'/0/{index}`,
//!    address = `bech32("qor", ripemd160(sha256(compressed_pubkey)))`.
//! 2. evm — secp256k1, BIP-44 path `m/44'/60'/0'/0/{index}`, address =
//!    `"0x"` + last 20 bytes of `keccak256(uncompressed_pubkey[1..])`, rendered
//!    with an EIP-55 mixed-case checksum.
//! 3. svm — ed25519, SLIP-0010 path `m/44'/501'/{index}'/0'` (all hardened, the
//!    Solana standard), address = `base58(32-byte ed25519 public key)`.
//!
//! Secret material is returned explicitly from the derive functions and is never
//! logged. The mnemonic is always validated (word list **and** checksum) before
//! any key is derived, to avoid the fund-loss footgun of deriving from a typo'd
//! phrase.

use crate::error::{Error, Result};
use bip39::Mnemonic;
use ed25519_dalek::SigningKey;
use hmac::{Hmac, Mac};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::{NonZeroScalar, Scalar, SecretKey};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256, Sha512};
use sha3::Keccak256;

type HmacSha512 = Hmac<Sha512>;

/// The bech32 human-readable prefix for native QoreChain account addresses.
pub const NATIVE_PREFIX: &str = "qor";

/// Marks a child index as hardened.
const HARDENED_OFFSET: u32 = 0x8000_0000;

// SLIP-0044 coin types.
const COIN_TYPE_NATIVE: u32 = 118; // Cosmos
const COIN_TYPE_EVM: u32 = 60; // Ethereum
const COIN_TYPE_SVM: u32 = 501; // Solana

/// A secp256k1-based account (native or EVM). Treat `private_key` as a secret.
#[derive(Debug, Clone)]
pub struct Secp256k1Account {
    /// Account scheme: `"native"` or `"evm"`.
    pub account_type: String,
    /// Encoded address (bech32 for native, EIP-55 hex for EVM).
    pub address: String,
    /// 33-byte compressed public key.
    pub public_key: Vec<u8>,
    /// 32-byte private key.
    pub private_key: Vec<u8>,
}

/// An ed25519-based (SVM/Solana) account. Treat `secret_key` as a secret.
#[derive(Debug, Clone)]
pub struct Ed25519Account {
    /// Account scheme: `"svm"`.
    pub account_type: String,
    /// base58-encoded 32-byte public key.
    pub address: String,
    /// 32-byte ed25519 public key.
    pub public_key: Vec<u8>,
    /// 64-byte Solana-style secret key (`private_seed32 || public_key32`).
    pub secret_key: Vec<u8>,
}

/// Generates a fresh BIP-39 mnemonic.
///
/// `strength` is entropy in bits: `128` -> 12 words, `256` -> 24 words.
pub fn generate_mnemonic(strength: usize) -> Result<String> {
    let word_count = match strength {
        128 => 12,
        256 => 24,
        _ => {
            return Err(Error::Derivation(format!(
                "unsupported strength: {strength} (use 128 or 256)"
            )))
        }
    };
    let mut entropy = [0u8; 32];
    getrandom_bytes(&mut entropy[..strength / 8])?;
    let mnemonic = Mnemonic::from_entropy(&entropy[..strength / 8])
        .map_err(|e| Error::Derivation(e.to_string()))?;
    debug_assert_eq!(mnemonic.word_count(), word_count);
    Ok(mnemonic.to_string())
}

/// Validates a BIP-39 mnemonic against the English word list **and** checksum.
pub fn validate_mnemonic(mnemonic: &str) -> bool {
    Mnemonic::parse_normalized(mnemonic).is_ok()
}

/// Validates a mnemonic and derives its BIP-39 seed (empty passphrase). The
/// error deliberately omits the mnemonic text.
fn seed_from_mnemonic(mnemonic: &str) -> Result<[u8; 64]> {
    let parsed = Mnemonic::parse_normalized(mnemonic).map_err(|_| Error::InvalidMnemonic)?;
    Ok(parsed.to_seed_normalized(""))
}

// --- secp256k1 BIP-32 ---

/// A minimal BIP-32 HD node over secp256k1. Only seed-master + CKDpriv are
/// implemented, which is sufficient for BIP-44 paths.
struct Secp256k1Node {
    key: [u8; 32],
    chain_code: [u8; 32],
}

impl Secp256k1Node {
    fn master(seed: &[u8]) -> Result<Self> {
        let mut mac =
            HmacSha512::new_from_slice(b"Bitcoin seed").expect("HMAC accepts any key len");
        mac.update(seed);
        let sum = mac.finalize().into_bytes();
        let mut key = [0u8; 32];
        let mut chain_code = [0u8; 32];
        key.copy_from_slice(&sum[..32]);
        chain_code.copy_from_slice(&sum[32..]);
        // Reject an invalid (zero / >= order) master key.
        SecretKey::from_slice(&key)
            .map_err(|_| Error::Derivation("invalid master key derived from seed".into()))?;
        Ok(Self { key, chain_code })
    }

    fn secret(&self) -> SecretKey {
        SecretKey::from_slice(&self.key).expect("node key is always a valid scalar")
    }

    fn compressed_pubkey(&self) -> Vec<u8> {
        self.secret()
            .public_key()
            .to_encoded_point(true)
            .as_bytes()
            .to_vec()
    }

    fn uncompressed_pubkey(&self) -> Vec<u8> {
        self.secret()
            .public_key()
            .to_encoded_point(false)
            .as_bytes()
            .to_vec()
    }

    /// BIP-32 CKDpriv. Add [`HARDENED_OFFSET`] to `index` for a hardened child.
    fn derive_child(&self, index: u32) -> Result<Self> {
        let mut data: Vec<u8> = Vec::with_capacity(37);
        if index >= HARDENED_OFFSET {
            data.push(0x00);
            data.extend_from_slice(&self.key);
        } else {
            data.extend_from_slice(&self.compressed_pubkey());
        }
        data.extend_from_slice(&index.to_be_bytes());

        let mut mac =
            HmacSha512::new_from_slice(&self.chain_code).expect("HMAC accepts any key len");
        mac.update(&data);
        let sum = mac.finalize().into_bytes();

        let il = &sum[..32];
        let mut chain_code = [0u8; 32];
        chain_code.copy_from_slice(&sum[32..]);

        // il must be a valid scalar (< curve order); reject otherwise.
        let il_scalar = scalar_from_bytes(il).ok_or_else(|| {
            Error::Derivation("derived key is invalid (IL >= n), try next index".into())
        })?;

        let parent = self.secret().to_nonzero_scalar();
        let child = il_scalar + *parent.as_ref();
        let child_nz = Option::<NonZeroScalar>::from(NonZeroScalar::new(child))
            .ok_or_else(|| Error::Derivation("derived key is zero, try next index".into()))?;

        let key: [u8; 32] = child_nz.to_bytes().into();
        Ok(Self { key, chain_code })
    }

    fn derive_path(&self, segments: &[u32]) -> Result<Self> {
        let mut cur = Self {
            key: self.key,
            chain_code: self.chain_code,
        };
        for &seg in segments {
            cur = cur.derive_child(seg)?;
        }
        Ok(cur)
    }
}

/// Parses 32 big-endian bytes into a curve scalar, returning `None` if the value
/// is >= the curve order (BIP-32 says to try the next index in that case).
fn scalar_from_bytes(b: &[u8]) -> Option<Scalar> {
    use k256::elliptic_curve::PrimeField;
    let mut arr = k256::FieldBytes::default();
    arr.copy_from_slice(b);
    Option::<Scalar>::from(Scalar::from_repr(arr))
}

// --- ed25519 SLIP-0010 ---

/// A minimal SLIP-0010 HD node over ed25519 (hardened-only).
struct Ed25519Node {
    key: [u8; 32],
    chain_code: [u8; 32],
}

impl Ed25519Node {
    fn master(seed: &[u8]) -> Self {
        let mut mac =
            HmacSha512::new_from_slice(b"ed25519 seed").expect("HMAC accepts any key len");
        mac.update(seed);
        let sum = mac.finalize().into_bytes();
        let mut key = [0u8; 32];
        let mut chain_code = [0u8; 32];
        key.copy_from_slice(&sum[..32]);
        chain_code.copy_from_slice(&sum[32..]);
        Self { key, chain_code }
    }

    fn derive_child(&self, index: u32) -> Self {
        let hardened = index | HARDENED_OFFSET;
        let mut data: Vec<u8> = Vec::with_capacity(37);
        data.push(0x00);
        data.extend_from_slice(&self.key);
        data.extend_from_slice(&hardened.to_be_bytes());

        let mut mac =
            HmacSha512::new_from_slice(&self.chain_code).expect("HMAC accepts any key len");
        mac.update(&data);
        let sum = mac.finalize().into_bytes();
        let mut key = [0u8; 32];
        let mut chain_code = [0u8; 32];
        key.copy_from_slice(&sum[..32]);
        chain_code.copy_from_slice(&sum[32..]);
        Self { key, chain_code }
    }

    fn derive_path(&self, segments: &[u32]) -> Self {
        let mut cur = Self {
            key: self.key,
            chain_code: self.chain_code,
        };
        for &seg in segments {
            cur = cur.derive_child(seg);
        }
        cur
    }
}

/// Derives a native QoreChain account (Cosmos-style secp256k1).
///
/// Path: `m/44'/118'/0'/0/{index}`. The address is the bech32 (`qor`) encoding
/// of `ripemd160(sha256(compressed_public_key))`.
pub fn derive_native_account(mnemonic: &str, index: u32) -> Result<Secp256k1Account> {
    let seed = seed_from_mnemonic(mnemonic)?;
    let master = Secp256k1Node::master(&seed)?;
    let node = master.derive_path(&[
        44 + HARDENED_OFFSET,
        COIN_TYPE_NATIVE + HARDENED_OFFSET,
        HARDENED_OFFSET,
        0,
        index,
    ])?;

    let compressed = node.compressed_pubkey();
    let sha = Sha256::digest(&compressed);
    let hash = Ripemd160::digest(sha);
    let address = crate::address::bytes_to_bech32(&hash, NATIVE_PREFIX)?;

    Ok(Secp256k1Account {
        account_type: "native".into(),
        address,
        public_key: compressed,
        private_key: node.key.to_vec(),
    })
}

/// Derives an EVM account from a mnemonic.
///
/// Path: `m/44'/60'/0'/0/{index}`. The address is the last 20 bytes of
/// `keccak256(uncompressed_public_key[1..])`, EIP-55 checksummed.
pub fn derive_evm_account(mnemonic: &str, index: u32) -> Result<Secp256k1Account> {
    let seed = seed_from_mnemonic(mnemonic)?;
    let master = Secp256k1Node::master(&seed)?;
    let node = master.derive_path(&[
        44 + HARDENED_OFFSET,
        COIN_TYPE_EVM + HARDENED_OFFSET,
        HARDENED_OFFSET,
        0,
        index,
    ])?;

    let uncompressed = node.uncompressed_pubkey();
    let digest = Keccak256::digest(&uncompressed[1..]); // drop the 0x04 prefix
    let addr_bytes = &digest[digest.len() - 20..];

    Ok(Secp256k1Account {
        account_type: "evm".into(),
        address: to_eip55(addr_bytes),
        public_key: node.compressed_pubkey(),
        private_key: node.key.to_vec(),
    })
}

/// Derives an SVM (Solana-style ed25519) account from a mnemonic.
///
/// Path: `m/44'/501'/{index}'/0'` — all segments hardened (SLIP-0010 for
/// ed25519 supports hardened keys only). The address is the base58 encoding of
/// the 32-byte public key. The returned `secret_key` is the 64-byte Solana form
/// (`private_seed32 || public_key32`).
pub fn derive_svm_account(mnemonic: &str, index: u32) -> Result<Ed25519Account> {
    let seed = seed_from_mnemonic(mnemonic)?;
    let master = Ed25519Node::master(&seed);
    let node = master.derive_path(&[44, COIN_TYPE_SVM, index, 0]);

    let signing = SigningKey::from_bytes(&node.key);
    let public_key = signing.verifying_key().to_bytes().to_vec();
    let mut secret_key = node.key.to_vec();
    secret_key.extend_from_slice(&public_key);

    Ok(Ed25519Account {
        account_type: "svm".into(),
        address: bs58::encode(&public_key).into_string(),
        public_key,
        secret_key,
    })
}

/// Renders 20 address bytes as a `0x`-prefixed EIP-55 mixed-case checksum
/// address.
fn to_eip55(addr: &[u8]) -> String {
    let lower = hex::encode(addr);
    let hash = Keccak256::digest(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, c) in lower.chars().enumerate() {
        if c.is_ascii_digit() {
            out.push(c);
            continue;
        }
        let byte = hash[i / 2];
        let nibble = if i % 2 == 0 { byte >> 4 } else { byte & 0x0f };
        if nibble >= 8 {
            out.push(c.to_ascii_uppercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// Fills `buf` with cryptographically secure random bytes.
fn getrandom_bytes(buf: &mut [u8]) -> Result<()> {
    use rand_core::RngCore;
    rand_core::OsRng
        .try_fill_bytes(buf)
        .map_err(|e| Error::Derivation(format!("RNG failure: {e}")))
}
