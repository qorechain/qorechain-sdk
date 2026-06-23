//! Native + hybrid (classical + post-quantum) transaction tests.
//!
//! `bank_send` and `build_hybrid_tx` are pure (no network); `broadcast` is tested
//! against a tiny local mock HTTP server that records the request, mirroring the
//! query tests. No real node or network access is used.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cosmrs::proto::cosmos::bank::v1beta1::MsgSend;
use cosmrs::proto::cosmos::tx::v1beta1::{SignDoc, TxBody, TxRaw};
use cosmrs::proto::traits::Message;

use qorechain::accounts::derive_native_account;
use qorechain::pqc::{
    generate_pqc_keypair, pqc_verify, HYBRID_SIG_TYPE_URL, MLDSA87_SIGNATURE_LEN,
};
use qorechain::tx::{
    bank_send, broadcast, build_hybrid_tx, fee_from_estimate, BankSendParams, BroadcastMode,
    BuildHybridTxParams, Coin, Fee, Message as TxMessage,
};

/// Public test mnemonic only (BIP-39 test vector); never a real secret.
const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_CHAIN_ID: &str = "qorechain-diana";
const MSG_SEND_TYPE_URL: &str = "/cosmos.bank.v1beta1.MsgSend";

fn sample_fee() -> Fee {
    Fee {
        amount: vec![Coin {
            denom: "uqor".into(),
            amount: "5000".into(),
        }],
        gas: "200000".into(),
        granter: String::new(),
        payer: String::new(),
    }
}

/// A big-endian 4-byte length prefix, matching the chain contract framing.
fn be32(n: u32) -> [u8; 4] {
    n.to_be_bytes()
}

/// Re-create the PQC framing `BE32(len(b0)) || b0 || BE32(len(a)) || a`.
fn frame(b0: &[u8], a: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + b0.len() + a.len());
    out.extend_from_slice(&be32(b0.len() as u32));
    out.extend_from_slice(b0);
    out.extend_from_slice(&be32(a.len() as u32));
    out.extend_from_slice(a);
    out
}

// --- mock HTTP server (mirrors tests/query.rs) ---

#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    path: String,
    body: String,
}

struct MockServer {
    base_url: String,
    recorded: Arc<Mutex<Vec<Recorded>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockServer {
    async fn start(response_body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let recorded: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let rec = recorded.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        let io = TokioIo::new(stream);
                        let rec = rec.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let rec = rec.clone();
                                async move {
                                    let method = req.method().to_string();
                                    let path = req.uri().path().to_string();
                                    let bytes =
                                        req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    rec.lock().unwrap().push(Recorded { method, path, body });
                                    Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(
                                        response_body,
                                    ))))
                                }
                            });
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(io, svc)
                                .await;
                        });
                    }
                }
            }
        });

        MockServer {
            base_url,
            recorded,
            _shutdown: tx,
        }
    }

    fn last(&self) -> Recorded {
        self.recorded.lock().unwrap().last().cloned().unwrap()
    }
}

// --- fee helper ---

#[test]
fn fee_from_estimate_uses_suggested_fee() {
    let fee = fee_from_estimate(
        &serde_json::json!({"suggested_fee_uqor":"1234","estimated_blocks":2}),
        "200000",
    )
    .unwrap();
    assert_eq!(fee.gas, "200000");
    assert_eq!(fee.amount.len(), 1);
    assert_eq!(fee.amount[0].denom, "uqor");
    assert_eq!(fee.amount[0].amount, "1234");
}

#[test]
fn fee_from_estimate_accepts_json_number() {
    let fee = fee_from_estimate(&serde_json::json!({"suggested_fee_uqor":4200}), "100000").unwrap();
    assert_eq!(fee.amount[0].amount, "4200");
}

#[test]
fn fee_from_estimate_rejects_empty() {
    assert!(fee_from_estimate(&serde_json::json!({}), "200000").is_err());
    assert!(fee_from_estimate(&serde_json::json!({"suggested_fee_uqor":"0"}), "200000").is_err());
}

// --- bank_send ---

#[test]
fn bank_send_builds_signed_tx_raw() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let to = "qor1recipient00000000000000000000000000000";

    let built = bank_send(BankSendParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        from_address: acc.address.clone(),
        to_address: to.into(),
        amount: vec![Coin {
            denom: "uqor".into(),
            amount: "1000".into(),
        }],
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 7,
        sequence: 3,
        fee: sample_fee(),
        memo: "hello".into(),
        timeout_height: 0,
    })
    .unwrap();

    assert!(!built.tx_raw_bytes.is_empty());

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    assert_eq!(tx_raw.signatures.len(), 1);
    assert_eq!(tx_raw.signatures[0].len(), 64);

    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    assert_eq!(body.memo, "hello");
    assert_eq!(body.messages.len(), 1);
    assert_eq!(body.messages[0].type_url, MSG_SEND_TYPE_URL);

    let msg = MsgSend::decode(body.messages[0].value.as_slice()).unwrap();
    assert_eq!(msg.from_address, acc.address);
    assert_eq!(msg.to_address, to);
    assert_eq!(msg.amount.len(), 1);
    assert_eq!(msg.amount[0].denom, "uqor");
    assert_eq!(msg.amount[0].amount, "1000");

    // Classical signature verifies over SignDoc(body, authInfo, chain, accNum).
    let sign_doc = SignDoc {
        body_bytes: tx_raw.body_bytes.clone(),
        auth_info_bytes: tx_raw.auth_info_bytes.clone(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 7,
    };
    let sig = k256::ecdsa::Signature::from_slice(&tx_raw.signatures[0]).unwrap();
    let vk = k256::ecdsa::VerifyingKey::from_sec1_bytes(&acc.public_key).unwrap();
    use k256::ecdsa::signature::Verifier;
    vk.verify(&sign_doc.encode_to_vec(), &sig)
        .expect("classical signature must verify");
}

// --- broadcast ---

#[tokio::test]
async fn broadcast_posts_to_rest_endpoint() {
    for (mode, want_mode) in [
        (BroadcastMode::Sync, "BROADCAST_MODE_SYNC"),
        (BroadcastMode::Async, "BROADCAST_MODE_ASYNC"),
        (BroadcastMode::Block, "BROADCAST_MODE_BLOCK"),
    ] {
        let server = MockServer::start(r#"{"tx_response":{"txhash":"ABC123","code":0}}"#).await;
        let tx_bytes = vec![0x01u8, 0x02, 0x03];
        let resp = broadcast(&server.base_url, &tx_bytes, mode).await.unwrap();
        let last = server.last();
        assert_eq!(last.method, "POST");
        assert_eq!(last.path, "/cosmos/tx/v1beta1/txs");
        let payload: serde_json::Value = serde_json::from_str(&last.body).unwrap();
        assert_eq!(payload["mode"], want_mode);
        assert_eq!(payload["tx_bytes"], BASE64.encode(&tx_bytes));
        assert_eq!(resp["tx_response"]["txhash"], "ABC123");
    }
}

#[tokio::test]
async fn broadcast_http_error_is_surfaced() {
    // The mock always answers 200; for an error path we point at a closed port.
    let err = broadcast("http://127.0.0.1:1", &[0x01], BroadcastMode::Sync).await;
    assert!(err.is_err());
}

// --- hybrid PQC tx ---

#[test]
fn build_hybrid_tx_contract() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = generate_pqc_keypair().unwrap();

    let msg = MsgSend {
        from_address: acc.address.clone(),
        to_address: "qor1recipient00000000000000000000000000000".into(),
        amount: vec![cosmrs::proto::cosmos::base::v1beta1::Coin {
            denom: "uqor".into(),
            amount: "2500".into(),
        }],
    };

    let built = build_hybrid_tx(BuildHybridTxParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        messages: vec![TxMessage {
            type_url: MSG_SEND_TYPE_URL.into(),
            value: msg.encode_to_vec(),
        }],
        fee: sample_fee(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 11,
        sequence: 5,
        memo: "pqc".into(),
        timeout_height: 0,
        include_pqc_public_key: false,
    })
    .unwrap();

    // ML-DSA-87 signature must be 4627 bytes and verify over the framed message.
    assert_eq!(built.pqc_signature.len(), MLDSA87_SIGNATURE_LEN);
    assert_eq!(MLDSA87_SIGNATURE_LEN, 4627);
    assert!(pqc_verify(
        &kp.public_key,
        &built.pqc_signed_message,
        &built.pqc_signature
    ));

    // Decode the final TxRaw + body.
    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    assert_eq!(tx_raw.signatures.len(), 1);
    assert_eq!(tx_raw.signatures[0].len(), 64);

    let final_body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();

    // The PQC extension must be in extension_options (the CRITICAL slot).
    assert_eq!(final_body.extension_options.len(), 1);
    assert!(final_body.non_critical_extension_options.is_empty());
    let ext = &final_body.extension_options[0];
    assert_eq!(ext.type_url, HYBRID_SIG_TYPE_URL);

    // The Any.value must be the JSON shape.
    let ext_json: serde_json::Value = serde_json::from_slice(&ext.value).unwrap();
    assert_eq!(ext_json["algorithm_id"], 1);
    let sig_b64 = ext_json["pqc_signature"].as_str().unwrap();
    let sig_bytes = BASE64.decode(sig_b64).unwrap();
    assert_eq!(sig_bytes.len(), MLDSA87_SIGNATURE_LEN);
    // pqc_public_key omitted when not requested.
    assert!(ext_json.get("pqc_public_key").is_none());

    // KEY PROPERTY: strip the PQC ext from the final body, re-encode (B0'),
    // re-frame, and assert it equals the signed message.
    let mut stripped = final_body.clone();
    stripped.extension_options.clear();
    let b0_prime = stripped.encode_to_vec();
    let reframed = frame(&b0_prime, &tx_raw.auth_info_bytes);
    assert_eq!(reframed, built.pqc_signed_message);

    // A framing over the WITH-ext body must differ.
    let with_ext = frame(&tx_raw.body_bytes, &tx_raw.auth_info_bytes);
    assert_ne!(with_ext, built.pqc_signed_message);

    // The BE32 length prefix matches len(B0').
    let prefix = u32::from_be_bytes(built.pqc_signed_message[..4].try_into().unwrap());
    assert_eq!(prefix as usize, b0_prime.len());

    // Classical signature verifies over SignDoc(finalBody, A, chain, accNum).
    let sign_doc = SignDoc {
        body_bytes: tx_raw.body_bytes.clone(),
        auth_info_bytes: tx_raw.auth_info_bytes.clone(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 11,
    };
    let vk = k256::ecdsa::VerifyingKey::from_sec1_bytes(&acc.public_key).unwrap();
    let sig = k256::ecdsa::Signature::from_slice(&tx_raw.signatures[0]).unwrap();
    use k256::ecdsa::signature::Verifier;
    vk.verify(&sign_doc.encode_to_vec(), &sig)
        .expect("classical signature must verify over final SignDoc");
}

#[test]
fn build_hybrid_tx_includes_public_key_when_requested() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = generate_pqc_keypair().unwrap();
    let msg = MsgSend {
        from_address: acc.address.clone(),
        to_address: "qor1recipient00000000000000000000000000000".into(),
        amount: vec![cosmrs::proto::cosmos::base::v1beta1::Coin {
            denom: "uqor".into(),
            amount: "1".into(),
        }],
    };
    let built = build_hybrid_tx(BuildHybridTxParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        messages: vec![TxMessage {
            type_url: MSG_SEND_TYPE_URL.into(),
            value: msg.encode_to_vec(),
        }],
        fee: sample_fee(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 0,
        sequence: 0,
        memo: String::new(),
        timeout_height: 0,
        include_pqc_public_key: true,
    })
    .unwrap();

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    let final_body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    let ext_json: serde_json::Value =
        serde_json::from_slice(&final_body.extension_options[0].value).unwrap();
    let pk_b64 = ext_json["pqc_public_key"].as_str().unwrap();
    assert_eq!(BASE64.decode(pk_b64).unwrap(), kp.public_key);
}
