//! Native + hybrid (classical + post-quantum) transaction building, signing, and
//! broadcast for QoreChain.
//!
//! A native transaction carries a classical secp256k1 signature in
//! `TxRaw.signatures`. A hybrid transaction additionally attaches an ML-DSA-87
//! (Dilithium-5) signature to the `TxBody` as a `PQCHybridSignature` extension.
//! The chain's ante handler verifies BOTH, so a hybrid account stays
//! interoperable with classical verification while gaining quantum safety.
//!
//! ─────────────────────────────────────────────────────────────────────────────
//!  The wallet ↔ chain hybrid contract (enforced by the chain; matches the other SDKs)
//! ─────────────────────────────────────────────────────────────────────────────
//! The chain verifies the ML-DSA-87 signature over the tx body WITH the PQC
//! extension REMOVED:
//!
//!   - `B0` = protobuf bytes of the `TxBody` containing the messages/memo/timeout
//!     but NOT the `PQCHybridSignature` extension.
//!   - `A`  = the `AuthInfo` bytes (signer secp256k1 pubkey, `SIGN_MODE_DIRECT`,
//!     sequence, fee) — the exact bytes that are broadcast.
//!   - PQC signed message = `BE32(len(B0)) || B0 || BE32(len(A)) || A` (4-byte
//!     big-endian length prefixes; NO hashing, NO domain prefix).
//!   - PQC signature = `pqc_sign(pqc_secret, message)` — pure ML-DSA-87 (4627
//!     bytes for Dilithium-5).
//!   - The `PQCHybridSignature` extension is then added to
//!     `TxBody.extension_options` (the CRITICAL extension-options slot) as an
//!     `Any` whose `type_url` is `"/qorechain.pqc.v1.PQCHybridSignature"` and
//!     whose `value` is the UTF-8 bytes of the JSON
//!     `{"algorithm_id","pqc_signature","pqc_public_key"?}` (standard padded
//!     base64; `pqc_public_key` omitted when not supplied) → the final body bytes.
//!   - The CLASSICAL secp256k1 `SIGN_MODE_DIRECT` signature is computed over
//!     `SignDoc(finalBody, A, chainId, accountNumber)` and goes in
//!     `TxRaw.signatures` (outside the body). The classical signature never signs
//!     itself.
//!
//! The signer's PQC key must be registered on-chain (via `MsgRegisterPQCKey`)
//! before hybrid txs PQC-verify — unless `include_pqc_public_key` is set, which
//! embeds the key for auto-registration on first use. Registering the key is the
//! caller's responsibility.
//!
//! Determinism note (same caveat as the other SDKs): the `BE32` framing is
//! byte-for-byte deterministic on the wallet side. Cross-implementation
//! determinism (this `prost` encoding vs. the chain's re-marshal of the same
//! `TxBody`) is confirmed for the default bank message types; callers using
//! custom message types with non-canonical field ordering must ensure their
//! encoding is canonical.

use crate::error::{Error, Result};
use crate::pqc::{
    build_hybrid_signature_extension, pqc_sign, ALGORITHM_DILITHIUM5, HYBRID_SIG_TYPE_URL,
};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cosmrs::crypto::secp256k1::SigningKey;
use cosmrs::proto::cosmos::bank::v1beta1::MsgSend;
use cosmrs::proto::cosmos::base::v1beta1::Coin as ProtoCoin;
use cosmrs::proto::cosmos::tx::signing::v1beta1::SignMode;
use cosmrs::proto::cosmos::tx::v1beta1::{
    mode_info::{Single, Sum},
    AuthInfo, Fee as ProtoFee, ModeInfo, SignDoc, SignerInfo, TxBody, TxRaw,
};
use cosmrs::proto::traits::Message as ProstMessage;
use cosmrs::Any;
use serde::Serialize;
use serde_json::Value;

/// The `/cosmos.bank.v1beta1.MsgSend` type URL.
pub const MSG_SEND_TYPE_URL: &str = "/cosmos.bank.v1beta1.MsgSend";

/// A Cosmos coin amount: a denom plus an integer base amount (as a string).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coin {
    /// The coin denomination (e.g. `"uqor"`).
    pub denom: String,
    /// The integer base amount, as a decimal string (e.g. `"1000"`).
    pub amount: String,
}

/// The transaction fee: a coin amount plus a gas limit (as a string).
#[derive(Debug, Clone, Default)]
pub struct Fee {
    /// The coins paid as a fee (e.g. uqor).
    pub amount: Vec<Coin>,
    /// The gas limit, as a decimal string (e.g. `"200000"`).
    pub gas: String,
    /// Optionally pays the fee via a fee grant.
    pub granter: String,
    /// Optionally identifies the fee payer.
    pub payer: String,
}

/// A transaction message: a type URL plus its protobuf-encoded value bytes.
#[derive(Debug, Clone)]
pub struct Message {
    /// The message type URL (e.g. `"/cosmos.bank.v1beta1.MsgSend"`).
    pub type_url: String,
    /// The protobuf-encoded message value.
    pub value: Vec<u8>,
}

/// A built, signed transaction plus the intermediate artifacts.
///
/// For a plain [`bank_send`] the PQC fields are empty; for [`build_hybrid_tx`]
/// they expose the exact bytes signed by ML-DSA-87 so the contract can be
/// asserted/audited.
#[derive(Debug, Clone)]
pub struct BuiltTx {
    /// Encoded `TxRaw`, ready to broadcast.
    pub tx_raw_bytes: Vec<u8>,
    /// `A` — the `AuthInfo` bytes (identical in the PQC framing and the SignDoc).
    pub auth_info_bytes: Vec<u8>,
    /// The final `TxBody` bytes (WITH the PQC extension, for a hybrid tx).
    pub body_bytes: Vec<u8>,
    /// The exact bytes the ML-DSA-87 signature covered (empty for a non-hybrid tx).
    pub pqc_signed_message: Vec<u8>,
    /// The raw ML-DSA-87 signature (Dilithium-5: 4627 bytes; empty for non-hybrid).
    pub pqc_signature: Vec<u8>,
}

/// The REST `/cosmos/tx/v1beta1/txs` broadcast behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BroadcastMode {
    /// Submit and return after `CheckTx`.
    Sync,
    /// Submit and return immediately.
    Async,
    /// Submit and wait until the tx is committed in a block.
    Block,
}

impl BroadcastMode {
    /// The proto3 enum string the REST endpoint expects.
    fn wire(self) -> &'static str {
        match self {
            BroadcastMode::Sync => "BROADCAST_MODE_SYNC",
            BroadcastMode::Async => "BROADCAST_MODE_ASYNC",
            BroadcastMode::Block => "BROADCAST_MODE_BLOCK",
        }
    }
}

/// Builds a [`Fee`] from a RestClient fee-estimate JSON body.
///
/// The estimate provides only the suggested fee amount (in uqor); the gas limit
/// is chosen by the caller. The `suggested_fee_uqor` field is accepted as either
/// a JSON string (`"1234"`) or a JSON number (`1234`). An empty/zero/missing fee
/// returns an error so callers can fall back to a static fee.
pub fn fee_from_estimate(estimate: &Value, gas: &str) -> Result<Fee> {
    let raw = &estimate["suggested_fee_uqor"];
    let amount = match raw {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Null => {
            return Err(Error::InvalidResponse(
                "fee estimate has no suggested_fee_uqor".into(),
            ))
        }
        other => {
            return Err(Error::InvalidResponse(format!(
                "fee estimate suggested_fee_uqor has unexpected type: {other}"
            )))
        }
    };
    if amount.is_empty() || amount == "0" {
        return Err(Error::InvalidResponse(
            "fee estimate suggested_fee_uqor is empty/zero".into(),
        ));
    }
    if amount.contains(['.', 'e', 'E']) {
        return Err(Error::InvalidResponse(format!(
            "fee estimate suggested_fee_uqor is not an integer: {amount}"
        )));
    }
    Ok(Fee {
        amount: vec![Coin {
            denom: "uqor".into(),
            amount,
        }],
        gas: gas.into(),
        granter: String::new(),
        payer: String::new(),
    })
}

/// The inputs to [`bank_send`].
#[derive(Debug, Clone)]
pub struct BankSendParams {
    /// The signer's 32-byte secp256k1 private key (from `derive_native_account`).
    pub private_key: Vec<u8>,
    /// The signer's 33-byte compressed secp256k1 public key.
    pub public_key: Vec<u8>,
    /// The bech32 sender address.
    pub from_address: String,
    /// The bech32 recipient address.
    pub to_address: String,
    /// The coins to send.
    pub amount: Vec<Coin>,
    /// The chain id (e.g. `"qorechain-diana"`).
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

/// Builds and signs a bank `MsgSend` into a broadcast-ready `TxRaw`.
///
/// Constructs `/cosmos.bank.v1beta1.MsgSend` from `from_address` to `to_address`,
/// builds the `SIGN_MODE_DIRECT` `AuthInfo` from the compressed secp256k1 pubkey,
/// signs the `SignDoc`, and assembles the `TxRaw`. This does not broadcast — pass
/// [`BuiltTx::tx_raw_bytes`] to [`broadcast`].
pub fn bank_send(params: BankSendParams) -> Result<BuiltTx> {
    let msg = MsgSend {
        from_address: params.from_address,
        to_address: params.to_address,
        amount: to_proto_coins(&params.amount)?,
    };
    let messages = vec![Any {
        type_url: MSG_SEND_TYPE_URL.to_string(),
        value: msg.encode_to_vec(),
    }];

    let body = TxBody {
        messages,
        memo: params.memo,
        timeout_height: params.timeout_height,
        extension_options: vec![],
        non_critical_extension_options: vec![],
    };
    let body_bytes = body.encode_to_vec();

    let auth_info_bytes = build_auth_info_bytes(&params.public_key, params.sequence, &params.fee)?;
    let sig = sign_direct(
        &params.private_key,
        &body_bytes,
        &auth_info_bytes,
        &params.chain_id,
        params.account_number,
    )?;

    let tx_raw = TxRaw {
        body_bytes: body_bytes.clone(),
        auth_info_bytes: auth_info_bytes.clone(),
        signatures: vec![sig],
    };
    Ok(BuiltTx {
        tx_raw_bytes: tx_raw.encode_to_vec(),
        auth_info_bytes,
        body_bytes,
        pqc_signed_message: vec![],
        pqc_signature: vec![],
    })
}

/// The inputs to [`build_hybrid_tx`].
#[derive(Debug, Clone)]
pub struct BuildHybridTxParams {
    /// The signer's 32-byte secp256k1 private key (the classical half).
    pub private_key: Vec<u8>,
    /// The signer's 33-byte compressed secp256k1 public key.
    pub public_key: Vec<u8>,
    /// The ML-DSA-87 (Dilithium-5) secret key (the post-quantum half).
    pub pqc_secret_key: Vec<u8>,
    /// The ML-DSA-87 public key (embedded only when `include_pqc_public_key`).
    pub pqc_public_key: Vec<u8>,
    /// The tx messages as `{type_url, value}` pairs (value = encoded proto bytes).
    pub messages: Vec<Message>,
    /// The fee to pay.
    pub fee: Fee,
    /// The chain id.
    pub chain_id: String,
    /// The signer's on-chain account number.
    pub account_number: u64,
    /// The signer's current account sequence.
    pub sequence: u64,
    /// An optional tx memo.
    pub memo: String,
    /// An optional tx timeout height (`0` = none).
    pub timeout_height: u64,
    /// Embeds the 2592-byte ML-DSA-87 public key in the extension for
    /// auto-registration on first use. Defaults to `false` (the key is expected
    /// to be registered already via `MsgRegisterPQCKey`).
    pub include_pqc_public_key: bool,
}

/// Builds a fully signed hybrid (classical + PQC) transaction following the chain
/// contract documented in the module header.
///
/// The build sequence:
///  1. Encode `B0` — the `TxBody` WITHOUT the PQC extension.
///  2. Encode `A`  — the single-signer `SIGN_MODE_DIRECT` `AuthInfo`.
///  3. `message = BE32(len B0) || B0 || BE32(len A) || A`; ML-DSA-87 sign it.
///  4. Build the `PQCHybridSignature` extension `Any` and attach it to a new body
///     identical to step 1 but with `extension_options = [ext]` → final body bytes.
///  5. Classical `SIGN_MODE_DIRECT` signature over `SignDoc(finalBody, A, chainId,
///     accountNumber)`.
///  6. Assemble `TxRaw(finalBody, A, [classicalSig])`.
///
/// The returned [`BuiltTx`] exposes `pqc_signed_message` and `pqc_signature` so
/// the contract can be asserted/audited.
///
/// On-chain prerequisite: the signer's PQC key must already be registered via
/// `MsgRegisterPQCKey` for the chain to PQC-verify the tx, unless
/// `include_pqc_public_key` is set to embed the key for auto-registration.
pub fn build_hybrid_tx(params: BuildHybridTxParams) -> Result<BuiltTx> {
    let messages = encode_messages(&params.messages);

    // 1. B0 — body WITHOUT the PQC extension.
    let base_body = TxBody {
        messages: messages.clone(),
        memo: params.memo.clone(),
        timeout_height: params.timeout_height,
        extension_options: vec![],
        non_critical_extension_options: vec![],
    };
    let b0 = base_body.encode_to_vec();

    // 2. A — single-signer AuthInfo (SIGN_MODE_DIRECT).
    let auth_info_bytes = build_auth_info_bytes(&params.public_key, params.sequence, &params.fee)?;

    // 3. PQC framing + ML-DSA-87 signature over B0 + A (NOT the final body).
    let pqc_signed_message = frame_sign_bytes(&b0, &auth_info_bytes);
    let pqc_signature = pqc_sign(&params.pqc_secret_key, &pqc_signed_message)?;

    // 4. Build the PQC extension Any (JSON value) and attach it to the FINAL body
    //    as a CRITICAL extension option.
    let public_key: Option<&[u8]> = if params.include_pqc_public_key {
        Some(params.pqc_public_key.as_slice())
    } else {
        None
    };
    let ext = build_hybrid_signature_extension(ALGORITHM_DILITHIUM5, &pqc_signature, public_key)?;
    let ext_value = to_canonical_json(&ext)?;
    let ext_any = Any {
        type_url: HYBRID_SIG_TYPE_URL.to_string(),
        value: ext_value,
    };
    let final_body = TxBody {
        messages,
        memo: params.memo,
        timeout_height: params.timeout_height,
        extension_options: vec![ext_any],
        non_critical_extension_options: vec![],
    };
    let body_bytes = final_body.encode_to_vec();

    // 5. Classical SIGN_MODE_DIRECT signature over the FINAL body + A.
    let classical_sig = sign_direct(
        &params.private_key,
        &body_bytes,
        &auth_info_bytes,
        &params.chain_id,
        params.account_number,
    )?;

    // 6. Assemble TxRaw.
    let tx_raw = TxRaw {
        body_bytes: body_bytes.clone(),
        auth_info_bytes: auth_info_bytes.clone(),
        signatures: vec![classical_sig],
    };
    Ok(BuiltTx {
        tx_raw_bytes: tx_raw.encode_to_vec(),
        auth_info_bytes,
        body_bytes,
        pqc_signed_message,
        pqc_signature,
    })
}

/// POSTs signed `TxRaw` bytes to the REST `/cosmos/tx/v1beta1/txs` endpoint.
///
/// Sends `{"tx_bytes": <base64>, "mode": "BROADCAST_MODE_*"}` and returns the
/// parsed JSON response. Broadcasting requires a live node; unit tests mock this
/// POST against a local server.
pub async fn broadcast(rest_url: &str, tx_bytes: &[u8], mode: BroadcastMode) -> Result<Value> {
    let url = format!("{}/cosmos/tx/v1beta1/txs", rest_url.trim_end_matches('/'));
    let payload = serde_json::json!({
        "tx_bytes": BASE64.encode(tx_bytes),
        "mode": mode.wire(),
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(Error::Http {
            status: status.as_u16(),
            url,
            body,
        });
    }
    serde_json::from_str(&body).map_err(|e| Error::InvalidResponse(e.to_string()))
}

// --- internal helpers ---

/// A big-endian 4-byte length prefix, matching the chain contract framing.
fn be32(n: u32) -> [u8; 4] {
    n.to_be_bytes()
}

/// Frames the PQC sign-bytes as `BE32(len(b0)) || b0 || BE32(len(a)) || a`.
fn frame_sign_bytes(b0: &[u8], a: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + b0.len() + a.len());
    out.extend_from_slice(&be32(b0.len() as u32));
    out.extend_from_slice(b0);
    out.extend_from_slice(&be32(a.len() as u32));
    out.extend_from_slice(a);
    out
}

/// Serializes the hybrid extension to canonical JSON: field order
/// `algorithm_id`, `pqc_signature`, then `pqc_public_key` (omitted when absent),
/// with no extra whitespace — matching the other SDKs' wire bytes.
fn to_canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|e| Error::Pqc(format!("serialize hybrid extension: {e}")))
}

fn to_proto_coins(coins: &[Coin]) -> Result<Vec<ProtoCoin>> {
    for c in coins {
        validate_amount(&c.amount)?;
    }
    Ok(coins
        .iter()
        .map(|c| ProtoCoin {
            denom: c.denom.clone(),
            amount: c.amount.clone(),
        })
        .collect())
}

fn validate_amount(amount: &str) -> Result<()> {
    if amount.is_empty() || !amount.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::Denom(format!("invalid coin amount: {amount:?}")));
    }
    Ok(())
}

fn encode_messages(messages: &[Message]) -> Vec<Any> {
    messages
        .iter()
        .map(|m| Any {
            type_url: m.type_url.clone(),
            value: m.value.clone(),
        })
        .collect()
}

fn fee_to_proto(fee: &Fee) -> Result<ProtoFee> {
    let amount = to_proto_coins(&fee.amount)?;
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

fn build_auth_info_bytes(public_key: &[u8], sequence: u64, fee: &Fee) -> Result<Vec<u8>> {
    let pubkey_any = secp256k1_pubkey_any(public_key)?;
    let auth_info = AuthInfo {
        signer_infos: vec![SignerInfo {
            public_key: Some(pubkey_any),
            mode_info: Some(ModeInfo {
                sum: Some(Sum::Single(Single {
                    mode: SignMode::Direct as i32,
                })),
            }),
            sequence,
        }],
        fee: Some(fee_to_proto(fee)?),
        // `tip` is deprecated upstream; default (None) keeps it off the wire.
        ..Default::default()
    };
    Ok(auth_info.encode_to_vec())
}

/// Builds the `/cosmos.crypto.secp256k1.PubKey` `Any` from a 33-byte compressed
/// public key.
fn secp256k1_pubkey_any(compressed: &[u8]) -> Result<Any> {
    let pubkey = cosmrs::proto::cosmos::crypto::secp256k1::PubKey {
        key: compressed.to_vec(),
    };
    Ok(Any {
        type_url: "/cosmos.crypto.secp256k1.PubKey".to_string(),
        value: pubkey.encode_to_vec(),
    })
}

/// Produces a canonical 64-byte secp256k1 `SIGN_MODE_DIRECT` signature over the
/// serialized `SignDoc`.
fn sign_direct(
    private_key: &[u8],
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
    let signing = SigningKey::from_slice(private_key)
        .map_err(|e| Error::Derivation(format!("invalid signing key: {e}")))?;
    let sig = signing
        .sign(&sign_bytes)
        .map_err(|e| Error::Derivation(format!("secp256k1 sign: {e}")))?;
    // k256 normalizes to low-S; the compact 64-byte form is the Cosmos wire form.
    Ok(sig.to_bytes().to_vec())
}
