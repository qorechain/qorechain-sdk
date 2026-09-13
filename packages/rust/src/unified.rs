//! Unified eth-native QoreChain wallet.
//!
//! One eth-native secp256k1 keypair yields the SAME 20-byte account rendered as
//! all THREE QoreChain address encodings, so a wallet never "has funds on the
//! native lane but not the EVM lane" again. The 20 bytes are the Ethereum
//! derivation `keccak256(uncompressed_pubkey[1..])[12..]`, so the key is natively
//! spendable on the EVM lane; the native (`qor1…`) and SVM (base58) forms are
//! just other encodings of those same 20 bytes — the chain reads one balance for
//! the account, visible under all three.
//!
//! The account also carries a deterministic ML-DSA-87 (Dilithium-5) PQC keypair
//! for the on-chain hybrid ante, seeded from `{cosmos address, mnemonic}` so it
//! is recoverable without extra secret storage.
//!
//! This is ADDITIVE: the coin-118 native derivation in [`crate::accounts`] is
//! unchanged. Use this module when you want one identity shared across all lanes
//! and eth_secp256k1 signing ([`crate::sign_eth`]).

use crate::accounts::{derive_eth_key, NATIVE_PREFIX};
use crate::address::bytes_to_bech32;
use crate::error::Result;
use crate::pqc::{pqc_keypair_from_seed, PqcKeypair};
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::SecretKey;
use sha3::digest::{ExtendableOutput, Update, XofReader};
use sha3::{Keccak256, Shake256};

/// The bech32 human-readable prefix for the unified account's native form.
pub const HRP: &str = NATIVE_PREFIX;

/// A unified eth-native QoreChain account.
///
/// The single secp256k1 keypair is rendered in all three address encodings, plus
/// a deterministic ML-DSA-87 keypair for the hybrid ante. Treat `private_key`
/// and `pqc.secret_key` as secrets.
#[derive(Debug, Clone)]
pub struct UnifiedAccount {
    /// 32-byte secp256k1 private key.
    pub private_key: [u8; 32],
    /// 33-byte compressed secp256k1 public key.
    pub public_key: Vec<u8>,
    /// The 20-byte account address (`keccak256(pubkey)[12..]`).
    pub address_bytes: [u8; 20],
    /// The native (bech32 `qor…`) encoding of the 20-byte address.
    pub cosmos: String,
    /// The EVM (EIP-55 `0x…`) encoding of the 20-byte address.
    pub evm: String,
    /// The SVM (base58 of `addr20 ‖ 12 zero bytes`) encoding.
    pub svm: String,
    /// The account's deterministic ML-DSA-87 (Dilithium-5) keypair.
    pub pqc: PqcKeypair,
}

/// The three address encodings of a 20-byte account (no key material).
#[derive(Debug, Clone)]
pub struct UnifiedAddresses {
    /// The 20-byte account address.
    pub address_bytes: [u8; 20],
    /// The native (bech32 `qor…`) form.
    pub cosmos: String,
    /// The EVM (EIP-55 `0x…`) form.
    pub evm: String,
    /// The SVM (base58 of `addr20 ‖ 12 zero bytes`) form.
    pub svm: String,
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    use sha3::Digest;
    let out = Keccak256::digest(data);
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

fn shake256_32(data: &[u8]) -> [u8; 32] {
    let mut hasher = Shake256::default();
    hasher.update(data);
    let mut reader = hasher.finalize_xof();
    let mut out = [0u8; 32];
    reader.read(&mut out);
    out
}

/// Renders 20 address bytes as a `0x`-prefixed EIP-55 mixed-case checksum address.
fn to_eip55(addr20: &[u8; 20]) -> String {
    let lower = hex::encode(addr20);
    let hash = keccak256(lower.as_bytes());
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

/// Derives the three encodings of a 20-byte account address.
///
/// - `cosmos` = bech32(`qor`, addr20)
/// - `evm`    = EIP-55(addr20)
/// - `svm`    = base58(addr20 ‖ 12 zero bytes) — the unified 32-byte SVM address
pub fn addresses_from_20(addr20: [u8; 20]) -> Result<UnifiedAddresses> {
    let cosmos = bytes_to_bech32(&addr20, HRP)?;
    let evm = to_eip55(&addr20);
    let mut svm_bytes = [0u8; 32];
    svm_bytes[..20].copy_from_slice(&addr20);
    let svm = bs58::encode(&svm_bytes).into_string();
    Ok(UnifiedAddresses {
        address_bytes: addr20,
        cosmos,
        evm,
        svm,
    })
}

/// Convenience: the three address encodings of an existing account, resolved
/// from any one of its `cosmos` (bech32), `evm`/`hex` (20-byte hex) forms.
///
/// Pass exactly one of the three; the first non-`None` argument wins in the
/// order `evm`, `hex`, `cosmos`.
pub fn qore_addresses(
    cosmos: Option<&str>,
    evm: Option<&str>,
    hex_addr: Option<&str>,
) -> Result<UnifiedAddresses> {
    let addr20 = if let Some(e) = evm {
        hex20_from_str(e)?
    } else if let Some(h) = hex_addr {
        hex20_from_str(h)?
    } else if let Some(c) = cosmos {
        let (_, data) =
            bech32::decode(c).map_err(|e| crate::error::Error::Address(e.to_string()))?;
        <[u8; 20]>::try_from(data.as_slice())
            .map_err(|_| crate::error::Error::Address("bech32 data must be 20 bytes".into()))?
    } else {
        return Err(crate::error::Error::Address(
            "provide one of {cosmos, evm, hex}".into(),
        ));
    };
    addresses_from_20(addr20)
}

fn hex20_from_str(s: &str) -> Result<[u8; 20]> {
    let trimmed = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(trimmed).map_err(|e| crate::error::Error::Address(e.to_string()))?;
    <[u8; 20]>::try_from(bytes.as_slice())
        .map_err(|_| crate::error::Error::Address("address must be 20 bytes".into()))
}

/// Derives the PQC seed for a unified account: `shake256("qorechain:pqc:v1|" +
/// cosmos + "|" + secret, 32)`, then seeds ML-DSA-87 keygen.
fn derive_pqc(cosmos: &str, secret: &str) -> PqcKeypair {
    let mut msg = Vec::new();
    msg.extend_from_slice(b"qorechain:pqc:v1|");
    msg.extend_from_slice(cosmos.as_bytes());
    msg.push(b'|');
    msg.extend_from_slice(secret.as_bytes());
    let seed = shake256_32(&msg);
    pqc_keypair_from_seed(&seed)
}

/// Builds a [`UnifiedAccount`] from a compressed/uncompressed secp256k1 pubkey,
/// a private key, and the `secret` string mixed into the PQC seed.
fn build_account(
    private_key: [u8; 32],
    compressed: Vec<u8>,
    uncompressed: &[u8],
    pqc_secret: &str,
) -> Result<UnifiedAccount> {
    // Ethereum address = last 20 bytes of keccak256 of the 64-byte pubkey body
    // (drop the 0x04 prefix).
    let digest = keccak256(&uncompressed[1..]);
    let mut addr20 = [0u8; 20];
    addr20.copy_from_slice(&digest[12..]);

    let enc = addresses_from_20(addr20)?;
    let pqc = derive_pqc(&enc.cosmos, pqc_secret);

    Ok(UnifiedAccount {
        private_key,
        public_key: compressed,
        address_bytes: addr20,
        cosmos: enc.cosmos,
        evm: enc.evm,
        svm: enc.svm,
        pqc,
    })
}

/// Derives the public keys (compressed 33B, uncompressed 65B) from a 32-byte
/// secp256k1 private key.
fn pubkeys_from_private(private_key: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>)> {
    let sk = SecretKey::from_slice(private_key)
        .map_err(|e| crate::error::Error::Derivation(format!("invalid private key: {e}")))?;
    let pk = sk.public_key();
    let compressed = pk.to_encoded_point(true).as_bytes().to_vec();
    let uncompressed = pk.to_encoded_point(false).as_bytes().to_vec();
    Ok((compressed, uncompressed))
}

/// Derives a unified eth-native account from a BIP-39 mnemonic at HD path
/// `m/44'/60'/0'/0/{index}`.
///
/// The PQC seed mixes the derived `cosmos` address with the `mnemonic`.
pub fn derive_unified_account(mnemonic: &str, index: u32) -> Result<UnifiedAccount> {
    let (private_key, compressed, uncompressed) = derive_eth_key(mnemonic, index)?;
    build_account(private_key, compressed, &uncompressed, mnemonic)
}

/// Builds a unified account directly from a 32-byte secp256k1 seed used as the
/// private key.
///
/// The PQC seed mixes the derived `cosmos` address with the `"seed:"`-prefixed
/// lowercase-hex encoding of the 32-byte private key (so a raw-seed account's PQC
/// key is still deterministic and recoverable from the seed alone).
///
/// # Safety of the seed
///
/// `seed32` **is** the account's spend key — everything else here is a rendering
/// of it. It MUST be real secret entropy: a CSPRNG draw, or a value derived from
/// one (a BIP-39 mnemonic via [`derive_unified_account`], an HSM, a KDF over a
/// secret the user alone holds).
///
/// It must NEVER be a wallet signature, or a hash of one, or any other value a
/// third party can ask a wallet, a service, or the user's browser to produce. A
/// wallet signature is a bearer secret: it is deterministic for a given message,
/// and any page that gets the wallet to sign that message receives the same bytes
/// — so whoever obtains them would hold this account's spend key. Link external
/// wallet keys through the authenticator lanes (`MsgRegisterAuthenticator` +
/// `MsgExecuteCosmos` / `MsgExecuteEVM`) instead, where an external signature
/// authorizes a spend but never becomes key material.
pub fn unified_account_from_seed(seed32: [u8; 32]) -> Result<UnifiedAccount> {
    let (compressed, uncompressed) = pubkeys_from_private(&seed32)?;
    build_account(
        seed32,
        compressed,
        &uncompressed,
        &format!("seed:{}", hex::encode(seed32)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_MNEMONIC: &str =
        "test test test test test test test test test test test junk";

    #[test]
    fn kat_mnemonic_index0() {
        let acct = derive_unified_account(TEST_MNEMONIC, 0).unwrap();
        assert_eq!(acct.cosmos, "qor17w0adeg64ky0daxwd2ugyuneellmjgnxhkv37z");
        assert_eq!(acct.evm, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        assert_eq!(acct.svm, "HQ1S8pxTw4YN41GPdWYPQVfweQveXAUtfFnZNmvPfrYf");
        assert_eq!(acct.pqc.public_key.len(), 2592);
        assert_eq!(acct.pqc.secret_key.len(), 4896);
        // PQC public-key determinism (first 8 bytes) — locked against the 0.1.5
        // reference adapter to pin exact ML-DSA-87 keygen across languages.
        assert_eq!(hex::encode(&acct.pqc.public_key[..8]), "4a685622f2a99d54");
    }

    #[test]
    fn kat_seed_0x01() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        assert_eq!(acct.cosmos, "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj");
        assert_eq!(acct.evm, "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1");
        assert_eq!(acct.svm, "2n2Cnc7fib6rm4Azo1mbvMuHB3iCb1J254kEQDcrHyPu");
        assert_eq!(acct.pqc.public_key.len(), 2592);
        assert_eq!(acct.pqc.secret_key.len(), 4896);
        // PQC public-key determinism (first 8 bytes) — locked against the 0.1.5
        // reference adapter (uses the "seed:"-prefixed hex privkey in the PQC seed).
        assert_eq!(hex::encode(&acct.pqc.public_key[..8]), "2d7f888fecbe5b24");
    }

    #[test]
    fn addresses_from_20_roundtrip() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        let enc = addresses_from_20(acct.address_bytes).unwrap();
        assert_eq!(enc.cosmos, acct.cosmos);
        assert_eq!(enc.evm, acct.evm);
        assert_eq!(enc.svm, acct.svm);
    }

    #[test]
    fn qore_addresses_from_each_form() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        let from_evm = qore_addresses(None, Some(&acct.evm), None).unwrap();
        assert_eq!(from_evm.cosmos, acct.cosmos);
        let hex_addr = hex::encode(acct.address_bytes);
        let from_hex = qore_addresses(None, None, Some(&hex_addr)).unwrap();
        assert_eq!(from_hex.evm, acct.evm);
        let from_cosmos = qore_addresses(Some(&acct.cosmos), None, None).unwrap();
        assert_eq!(from_cosmos.svm, acct.svm);
    }

    #[test]
    fn pqc_deterministic() {
        let a = derive_unified_account(TEST_MNEMONIC, 0).unwrap();
        let b = derive_unified_account(TEST_MNEMONIC, 0).unwrap();
        assert_eq!(a.pqc.public_key, b.pqc.public_key);
        assert_eq!(a.pqc.secret_key, b.pqc.secret_key);
    }
}
