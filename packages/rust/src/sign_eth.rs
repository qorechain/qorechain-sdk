//! Eth-native (`eth_secp256k1`) native-lane signing (classical + hybrid).
//!
//! A QoreChain account created eth-native (address = `keccak256(pubkey)[12..]`,
//! see [`crate::unified`]) signs native-lane txs with the `eth_secp256k1` scheme:
//! the classical signature is secp256k1 over the KECCAK-256 of the `SignDoc` (NOT
//! sha256), and the account's pubkey `Any` uses the type URL
//! [`ETHSECP256K1_PUBKEY_TYPE`] (its wire value is the standard secp256k1
//! `PubKey`). This is the same account that spends on the EVM lane, so its
//! `qor…`/`0x…`/base58 forms are one identity.
//!
//! Mainnet requires the ML-DSA-87 hybrid extension in the tx body;
//! [`sign_hybrid_eth`] adds it. [`sign_classical_eth`] omits it (used for the
//! one-time PQC-key registration, which is bootstrap-exempt from the hybrid
//! requirement). The hybrid framing (`B0` without the extension, ML-DSA-87 over
//! `frame(B0, authInfo)`, extension added to the final body, classical signature
//! over the final body) is identical to [`crate::tx::build_hybrid_tx`]; only the
//! classical hash (keccak256, not the k256 default sha256) and the pubkey type
//! URL change.

use crate::error::{Error, Result};
use crate::pqc::{
    build_hybrid_signature_extension, pqc_keypair_from_seed, pqc_sign, PqcKeypair,
    ALGORITHM_DILITHIUM5, HYBRID_SIG_TYPE_URL,
};
use crate::unified::UnifiedAccount;
use cosmrs::proto::cosmos::tx::signing::v1beta1::SignMode;
use cosmrs::proto::cosmos::tx::v1beta1::{
    mode_info::{Single, Sum},
    AuthInfo, Fee as ProtoFee, ModeInfo, SignDoc, SignerInfo, TxBody, TxRaw,
};
use cosmrs::proto::traits::Message as ProstMessage;
use cosmrs::Any;
use k256::ecdsa::signature::hazmat::PrehashSigner;
use k256::ecdsa::{Signature, SigningKey};
use sha3::{Digest, Keccak256};

pub use crate::tx::{Coin, Fee};

/// The `cosmos/evm` `eth_secp256k1` pubkey type URL. Its wire shape is identical
/// to the Native secp256k1 `PubKey` (`{1: bytes key}`); only the type URL differs.
pub const ETHSECP256K1_PUBKEY_TYPE: &str = "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";

/// The inputs common to [`sign_classical_eth`] and [`sign_hybrid_eth`].
#[derive(Debug, Clone)]
pub struct EthSignParams {
    /// The signer's 32-byte secp256k1 private key.
    pub private_key: [u8; 32],
    /// The signer's 33-byte compressed secp256k1 public key.
    pub public_key: Vec<u8>,
    /// The tx messages, packed as `cosmrs::Any`.
    pub messages: Vec<Any>,
    /// The chain id.
    pub chain_id: String,
    /// The signer's on-chain account number.
    pub account_number: u64,
    /// The signer's current account sequence (nonce).
    pub sequence: u64,
    /// The fee to pay.
    pub fee: Fee,
    /// An optional tx memo.
    pub memo: String,
    /// An optional tx timeout height (`0` = none).
    pub timeout_height: u64,
}

/// A built, signed eth-native transaction plus its intermediate artifacts.
#[derive(Debug, Clone)]
pub struct EthBuiltTx {
    /// Encoded `TxRaw`, ready to broadcast.
    pub tx_raw_bytes: Vec<u8>,
    /// `A` — the `AuthInfo` bytes.
    pub auth_info_bytes: Vec<u8>,
    /// The final `TxBody` bytes (WITH the PQC extension for a hybrid tx).
    pub body_bytes: Vec<u8>,
    /// The exact bytes the ML-DSA-87 signature covered (empty for a classical tx).
    pub pqc_signed_message: Vec<u8>,
    /// The raw ML-DSA-87 signature (empty for a classical tx).
    pub pqc_signature: Vec<u8>,
}

/// Builds a classical-only `eth_secp256k1` native-lane tx (no PQC extension).
///
/// Use for the one-time PQC-key registration (`MsgRegisterPQCKeyV2`), which is
/// bootstrap-exempt from the mainnet hybrid requirement. Does not broadcast —
/// pass [`EthBuiltTx::tx_raw_bytes`] to [`crate::tx::broadcast`].
pub fn sign_classical_eth(params: EthSignParams) -> Result<EthBuiltTx> {
    let auth_info_bytes =
        build_eth_auth_info_bytes(&params.public_key, params.sequence, &params.fee)?;
    let body = TxBody {
        messages: params.messages,
        memo: params.memo,
        timeout_height: params.timeout_height,
        extension_options: vec![],
        non_critical_extension_options: vec![],
    };
    let body_bytes = body.encode_to_vec();
    let classical = eth_sign_direct(
        &params.private_key,
        &body_bytes,
        &auth_info_bytes,
        &params.chain_id,
        params.account_number,
    )?;
    let tx_raw = TxRaw {
        body_bytes: body_bytes.clone(),
        auth_info_bytes: auth_info_bytes.clone(),
        signatures: vec![classical],
    };
    Ok(EthBuiltTx {
        tx_raw_bytes: tx_raw.encode_to_vec(),
        auth_info_bytes,
        body_bytes,
        pqc_signed_message: vec![],
        pqc_signature: vec![],
    })
}

/// Builds a hybrid `eth_secp256k1` + ML-DSA-87 native-lane tx.
///
/// The `B0` body (WITHOUT the PQC extension) is framed with the `AuthInfo` and
/// signed by ML-DSA-87; the extension is then attached to the final body, and the
/// classical `eth_secp256k1` signature covers `SignDoc(finalBody, A, chainId,
/// accountNumber)`. `include_pqc_public_key` embeds the 2592-byte ML-DSA-87
/// public key for auto-registration on first use.
pub fn sign_hybrid_eth(
    params: EthSignParams,
    pqc: &PqcKeypair,
    include_pqc_public_key: bool,
) -> Result<EthBuiltTx> {
    let auth_info_bytes =
        build_eth_auth_info_bytes(&params.public_key, params.sequence, &params.fee)?;

    // B0 — body WITHOUT the PQC extension.
    let b0_body = TxBody {
        messages: params.messages.clone(),
        memo: params.memo.clone(),
        timeout_height: params.timeout_height,
        extension_options: vec![],
        non_critical_extension_options: vec![],
    };
    let b0 = b0_body.encode_to_vec();

    // ML-DSA-87 over frame(B0, authInfo).
    let pqc_signed_message = frame_sign_bytes(&b0, &auth_info_bytes);
    let pqc_signature = pqc_sign(&pqc.secret_key, &pqc_signed_message)?;

    let public_key: Option<&[u8]> = if include_pqc_public_key {
        Some(pqc.public_key.as_slice())
    } else {
        None
    };
    // The chain protobuf-decodes the extension, so the Any.value is the encoded
    // PQCHybridSignature message (first byte 0x08), NOT JSON.
    let ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &pqc_signature, public_key)?;
    let ext_value = ext.encode_to_vec();
    let ext_any = Any {
        type_url: HYBRID_SIG_TYPE_URL.to_string(),
        value: ext_value,
    };
    let final_body = TxBody {
        messages: params.messages,
        memo: params.memo,
        timeout_height: params.timeout_height,
        extension_options: vec![ext_any],
        non_critical_extension_options: vec![],
    };
    let body_bytes = final_body.encode_to_vec();

    let classical = eth_sign_direct(
        &params.private_key,
        &body_bytes,
        &auth_info_bytes,
        &params.chain_id,
        params.account_number,
    )?;
    let tx_raw = TxRaw {
        body_bytes: body_bytes.clone(),
        auth_info_bytes: auth_info_bytes.clone(),
        signatures: vec![classical],
    };
    Ok(EthBuiltTx {
        tx_raw_bytes: tx_raw.encode_to_vec(),
        auth_info_bytes,
        body_bytes,
        pqc_signed_message,
        pqc_signature,
    })
}

/// REMOVED in v0.8.0 — always returns [`Error::Removed`].
///
/// This function used to derive a spend key from a wallet signature over a fixed
/// public message. That is not a key-derivation input: a wallet signature is a
/// bearer secret the wallet will hand to any page that asks for it, and the
/// signature is deterministic, so the same bytes come back every time. Anyone who
/// obtains them controls the account.
///
/// Use the authenticator lanes instead: register the external key with
/// `MsgRegisterAuthenticator` (see [`crate::msg::abstractaccount`]) and spend via
/// `MsgExecuteCosmos` / `MsgExecuteEVM`, which keep the spend key on the
/// canonical PQC account and treat the external signature as an *authorization*
/// under revocable, least-privilege terms — never as key material.
///
/// Any account previously derived through this function must be treated as
/// exposed; move its funds.
///
/// The signature is kept (rather than deleted outright) so existing call sites
/// fail loudly at run time with an explanation instead of silently resolving to
/// some other overload.
pub fn unified_account_from_phantom_signature(_sig: &[u8]) -> Result<UnifiedAccount> {
    Err(Error::Removed(REMOVED_MESSAGE.to_string()))
}

/// The exact text of the [`Error::Removed`] returned by
/// [`unified_account_from_phantom_signature`].
const REMOVED_MESSAGE: &str = "unified_account_from_phantom_signature was removed in v0.8.0: \
deriving a spend key from a wallet signature is unsafe — the signature is a bearer secret that any \
page can request from the wallet, so whoever obtains it controls the account. Use the authenticator \
lanes instead: register the external key with MsgRegisterAuthenticator and spend via \
MsgExecuteCosmos / MsgExecuteEVM. Any account previously derived this way must be treated as \
exposed — move its funds.";

/// Reports whether an on-chain pubkey `Any` type URL is the `eth_secp256k1`
/// scheme accepted by this module's signer.
pub fn is_ethsecp256k1_pubkey_type(type_url: &str) -> bool {
    type_url == ETHSECP256K1_PUBKEY_TYPE
}

/// Extracts the compressed secp256k1 public key from an on-chain pubkey `Any` of
/// type [`ETHSECP256K1_PUBKEY_TYPE`] (the account parser lane).
///
/// The wire value is a standard secp256k1 `PubKey` (`{1: bytes key}`).
pub fn parse_ethsecp256k1_pubkey(any: &Any) -> Result<Vec<u8>> {
    if !is_ethsecp256k1_pubkey_type(&any.type_url) {
        return Err(Error::Derivation(format!(
            "unexpected pubkey type: {}",
            any.type_url
        )));
    }
    let pk = cosmrs::proto::cosmos::crypto::secp256k1::PubKey::decode(any.value.as_slice())
        .map_err(|e| Error::Derivation(format!("decode eth_secp256k1 pubkey: {e}")))?;
    Ok(pk.key)
}

// --- internal helpers ---

/// Deterministically re-derives the ML-DSA-87 keypair from a 32-byte seed
/// (re-exported convenience so callers can seed the hybrid signer without pulling
/// in [`crate::pqc`] directly).
pub fn pqc_from_seed(seed: &[u8; 32]) -> PqcKeypair {
    pqc_keypair_from_seed(seed)
}

fn frame_sign_bytes(b0: &[u8], a: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + b0.len() + a.len());
    out.extend_from_slice(&(b0.len() as u32).to_be_bytes());
    out.extend_from_slice(b0);
    out.extend_from_slice(&(a.len() as u32).to_be_bytes());
    out.extend_from_slice(a);
    out
}

/// Builds the eth_secp256k1 pubkey `Any` from a 33-byte compressed public key.
fn ethsecp256k1_pubkey_any(compressed: &[u8]) -> Any {
    let pubkey = cosmrs::proto::cosmos::crypto::secp256k1::PubKey {
        key: compressed.to_vec(),
    };
    Any {
        type_url: ETHSECP256K1_PUBKEY_TYPE.to_string(),
        value: pubkey.encode_to_vec(),
    }
}

fn fee_to_proto(fee: &Fee) -> Result<ProtoFee> {
    let amount = fee
        .amount
        .iter()
        .map(|c| cosmrs::proto::cosmos::base::v1beta1::Coin {
            denom: c.denom.clone(),
            amount: c.amount.clone(),
        })
        .collect();
    let gas_limit = if fee.gas.is_empty() {
        0
    } else {
        fee.gas
            .parse::<u64>()
            .map_err(|_| Error::Denom(format!("invalid gas: {:?}", fee.gas)))?
    };
    Ok(ProtoFee {
        amount,
        gas_limit,
        payer: fee.payer.clone(),
        granter: fee.granter.clone(),
    })
}

fn build_eth_auth_info_bytes(public_key: &[u8], sequence: u64, fee: &Fee) -> Result<Vec<u8>> {
    let auth_info = AuthInfo {
        signer_infos: vec![SignerInfo {
            public_key: Some(ethsecp256k1_pubkey_any(public_key)),
            mode_info: Some(ModeInfo {
                sum: Some(Sum::Single(Single {
                    mode: SignMode::Direct as i32,
                })),
            }),
            sequence,
        }],
        fee: Some(fee_to_proto(fee)?),
        ..Default::default()
    };
    Ok(auth_info.encode_to_vec())
}

/// Produces a canonical 64-byte secp256k1 signature over `keccak256(SignDoc)`
/// (low-s normalized) — the `eth_secp256k1` classical signature.
fn eth_sign_direct(
    private_key: &[u8; 32],
    body_bytes: &[u8],
    auth_info_bytes: &[u8],
    chain_id: &str,
    account_number: u64,
) -> Result<Vec<u8>> {
    let sign_doc = SignDoc {
        body_bytes: body_bytes.to_vec(),
        auth_info_bytes: auth_info_bytes.to_vec(),
        chain_id: chain_id.to_string(),
        account_number,
    };
    let sign_bytes = sign_doc.encode_to_vec();
    let hash = Keccak256::digest(&sign_bytes);
    let signing = SigningKey::from_slice(private_key)
        .map_err(|e| Error::Derivation(format!("invalid signing key: {e}")))?;
    // PrehashSigner normalizes to low-s; to_bytes() is the 64-byte r‖s wire form.
    let sig: Signature = signing
        .sign_prehash(&hash)
        .map_err(|e| Error::Derivation(format!("eth_secp256k1 sign: {e}")))?;
    Ok(sig.to_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unified::unified_account_from_seed;
    use k256::ecdsa::signature::hazmat::PrehashVerifier;
    use k256::ecdsa::VerifyingKey;

    fn test_params(acct: &UnifiedAccount) -> EthSignParams {
        EthSignParams {
            private_key: acct.private_key,
            public_key: acct.public_key.clone(),
            messages: vec![Any {
                type_url: "/cosmos.bank.v1beta1.MsgSend".to_string(),
                value: vec![1, 2, 3],
            }],
            chain_id: "qorechain-vladi".to_string(),
            account_number: 7,
            sequence: 3,
            fee: Fee {
                amount: vec![Coin {
                    denom: "uqor".into(),
                    amount: "100".into(),
                }],
                gas: "200000".into(),
                granter: String::new(),
                payer: String::new(),
            },
            memo: String::new(),
            timeout_height: 0,
        }
    }

    fn verify_eth_sig(pubkey: &[u8], body: &[u8], auth: &[u8], built: &EthBuiltTx) -> bool {
        let sign_doc = SignDoc {
            body_bytes: body.to_vec(),
            auth_info_bytes: auth.to_vec(),
            chain_id: "qorechain-vladi".to_string(),
            account_number: 7,
        };
        let sign_bytes = sign_doc.encode_to_vec();
        let hash = Keccak256::digest(&sign_bytes);
        let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
        let sig = Signature::from_slice(&tx_raw.signatures[0]).unwrap();
        let vk = VerifyingKey::from_sec1_bytes(pubkey).unwrap();
        vk.verify_prehash(&hash, &sig).is_ok()
    }

    #[test]
    fn classical_sig_verifies_over_keccak() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        let built = sign_classical_eth(test_params(&acct)).unwrap();
        assert!(built.pqc_signature.is_empty());
        assert!(verify_eth_sig(
            &acct.public_key,
            &built.body_bytes,
            &built.auth_info_bytes,
            &built
        ));
    }

    #[test]
    fn hybrid_b0_excludes_extension() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        let built = sign_hybrid_eth(test_params(&acct), &acct.pqc, false).unwrap();
        // The PQC signed message frames B0 (no extension); the final body carries
        // the extension, so the two bodies differ.
        assert!(!built.pqc_signature.is_empty());
        let final_body = TxBody::decode(built.body_bytes.as_slice()).unwrap();
        assert_eq!(final_body.extension_options.len(), 1);
        // The extension Any.value is PROTOBUF (first byte 0x08), NOT JSON (0x7b),
        // and round-trips through the generated PQCHybridSignature message.
        let ext_value = &final_body.extension_options[0].value;
        assert_eq!(ext_value[0], 0x08);
        assert_ne!(ext_value[0], 0x7b);
        let ext_msg = crate::proto::qorechain::pqc::v1::PqcHybridSignature::decode(
            ext_value.as_slice(),
        )
        .unwrap();
        assert_eq!(ext_msg.algorithm_id, ALGORITHM_DILITHIUM5);
        assert_eq!(ext_msg.pqc_signature, built.pqc_signature);
        assert!(ext_msg.pqc_public_key.is_empty());
        // Reconstruct B0 from the frame and confirm it has NO extension.
        let b0_len =
            u32::from_be_bytes(built.pqc_signed_message[0..4].try_into().unwrap()) as usize;
        let b0 = &built.pqc_signed_message[4..4 + b0_len];
        let b0_body = TxBody::decode(b0).unwrap();
        assert_eq!(b0_body.extension_options.len(), 0);
        // The ML-DSA-87 signature verifies over frame(B0, authInfo).
        assert!(crate::pqc::pqc_verify(
            &acct.pqc.public_key,
            &built.pqc_signed_message,
            &built.pqc_signature
        ));
        // The classical eth_secp256k1 signature verifies over keccak(finalBody).
        assert!(verify_eth_sig(
            &acct.public_key,
            &built.body_bytes,
            &built.auth_info_bytes,
            &built
        ));
    }

    #[test]
    fn eth_pubkey_any_roundtrips() {
        let acct = unified_account_from_seed([0x01u8; 32]).unwrap();
        let any = ethsecp256k1_pubkey_any(&acct.public_key);
        assert_eq!(any.type_url, ETHSECP256K1_PUBKEY_TYPE);
        assert!(is_ethsecp256k1_pubkey_type(&any.type_url));
        let parsed = parse_ethsecp256k1_pubkey(&any).unwrap();
        assert_eq!(parsed, acct.public_key);
    }

    #[test]
    fn wallet_signature_account_derivation_is_removed() {
        let err = unified_account_from_phantom_signature(b"any-wallet-signature-bytes")
            .expect_err("deriving a spend key from a wallet signature must not be possible");
        assert!(matches!(err, Error::Removed(_)), "got {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("removed in v0.8.0"), "{msg}");
        assert!(msg.contains("authenticator lanes"), "{msg}");
        assert!(msg.contains("MsgRegisterAuthenticator"), "{msg}");
        assert!(msg.contains("MsgExecuteCosmos"), "{msg}");
        assert!(msg.contains("MsgExecuteEVM"), "{msg}");
        assert!(msg.contains("move its funds"), "{msg}");
    }

    #[test]
    fn wallet_signature_account_derivation_returns_no_key_material() {
        // Two different signatures, one shared outcome: an error, never an account.
        for sig in [&b"sig-a"[..], &b"sig-b"[..], &b""[..]] {
            assert!(unified_account_from_phantom_signature(sig).is_err());
        }
    }
}
