//! Quantum-safe DX helper tests: `is_pqc_registered` / `get_pqc_status` against
//! a mocked `qor_getPQCKeyStatus` JSON-RPC endpoint, and `ensure_pqc_registered`
//! on both paths (already-registered → no broadcast; missing → builds, signs and
//! broadcasts `MsgRegisterPQCKeyV2`).
//!
//! A single tiny hyper mock server dispatches by request path: the REST broadcast
//! POST (`/cosmos/tx/v1beta1/txs`) returns a tx-hash body, and every other path
//! (the JSON-RPC root) answers `qor_getPQCKeyStatus`. It records each request so
//! the broadcast body's signed `TxRaw` can be decoded back to assert the message.
//! No real network access is used.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use tokio::net::TcpListener;

use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
use cosmrs::proto::traits::Message as ProstMessage;

use qorechain::accounts::derive_native_account;
use qorechain::pqc_dx::PqcDx;
use qorechain::proto::qorechain::pqc::v1::MsgRegisterPqcKeyV2;
use qorechain::query::QorClient;
use qorechain::tx::{BroadcastMode, Coin, Fee};

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_CHAIN_ID: &str = "qorechain-diana";

#[derive(Debug, Clone)]
struct Recorded {
    path: String,
    body: String,
}

struct MockServer {
    base_url: String,
    recorded: Arc<Mutex<Vec<Recorded>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockServer {
    /// Starts a server: the broadcast path returns `broadcast_body`; any other
    /// path (the JSON-RPC root) returns a JSON-RPC envelope whose `result` is
    /// `status_result`.
    async fn start(status_result: &'static str, broadcast_body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let recorded: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let rpc_body = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{status_result}}}"#);

        let rec = recorded.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let rec = rec.clone();
                        let rpc_body = rpc_body.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let rec = rec.clone();
                                let rpc_body = rpc_body.clone();
                                async move {
                                    let path = req.uri().path().to_string();
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    rec.lock().unwrap().push(Recorded { path: path.clone(), body });
                                    let resp = if path == "/cosmos/tx/v1beta1/txs" {
                                        broadcast_body.to_string()
                                    } else {
                                        rpc_body
                                    };
                                    Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(resp))))
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

        MockServer { base_url, recorded, _shutdown: tx }
    }

    fn recorded(&self) -> Vec<Recorded> {
        self.recorded.lock().unwrap().clone()
    }
}

fn sample_fee() -> Fee {
    Fee {
        amount: vec![Coin { denom: "uqor".into(), amount: "5000".into() }],
        gas: "200000".into(),
        granter: String::new(),
        payer: String::new(),
    }
}

fn make_pqc_dx(url: String, qor: Option<QorClient>) -> PqcDx {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    PqcDx {
        sender: acc.address.clone(),
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        // 2592-byte ML-DSA-87 public key (length is asserted only on the hybrid
        // path, not on registration); a deterministic filler is fine here.
        pqc_public_key: vec![7u8; 2592],
        pqc_secret_key: vec![9u8; 4896],
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 1,
        sequence: 0,
        fee: sample_fee(),
        key_type: String::new(),
        rest_url: url,
        mode: BroadcastMode::Sync,
        qor,
    }
}

fn decode_register_msg(server: &MockServer) -> MsgRegisterPqcKeyV2 {
    let last = server
        .recorded()
        .into_iter()
        .rev()
        .find(|r| r.path == "/cosmos/tx/v1beta1/txs")
        .expect("a broadcast was recorded");
    let v: Value = serde_json::from_str(&last.body).unwrap();
    let tx_bytes = BASE64.decode(v["tx_bytes"].as_str().unwrap()).unwrap();
    let tx_raw = TxRaw::decode(tx_bytes.as_slice()).unwrap();
    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    assert_eq!(body.messages.len(), 1);
    assert_eq!(
        body.messages[0].type_url,
        "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"
    );
    MsgRegisterPqcKeyV2::decode(body.messages[0].value.as_slice()).unwrap()
}

#[tokio::test]
async fn get_pqc_status_normalizes_chain_response() {
    let server = MockServer::start(
        r#"{"registered":true,"algorithm_id":1,"public_key":"0xdeadbeef"}"#,
        r#"{"tx_response":{"code":0,"txhash":"X"}}"#,
    )
    .await;
    let qor = QorClient::new(server.base_url.clone());
    let dx = make_pqc_dx(server.base_url.clone(), Some(qor));

    let status = dx.get_pqc_status(&dx.sender).await.unwrap();
    assert!(status.registered);
    assert_eq!(status.algorithm_id, Some(1));
    assert_eq!(status.pubkey, Some(vec![0xde, 0xad, 0xbe, 0xef]));

    // The read used qor_getPQCKeyStatus with the address as the first param.
    let last = server.recorded().pop().unwrap();
    let v: Value = serde_json::from_str(&last.body).unwrap();
    assert_eq!(v["method"], "qor_getPQCKeyStatus");
    assert_eq!(v["params"][0], dx.sender);
}

#[tokio::test]
async fn is_pqc_registered_true_and_false() {
    let server_yes = MockServer::start(
        r#"{"registered":true}"#,
        r#"{"tx_response":{"code":0}}"#,
    )
    .await;
    let dx_yes = make_pqc_dx(
        server_yes.base_url.clone(),
        Some(QorClient::new(server_yes.base_url.clone())),
    );
    assert!(dx_yes.is_pqc_registered(&dx_yes.sender).await.unwrap());

    let server_no = MockServer::start(
        r#"{"registered":false}"#,
        r#"{"tx_response":{"code":0}}"#,
    )
    .await;
    let dx_no = make_pqc_dx(
        server_no.base_url.clone(),
        Some(QorClient::new(server_no.base_url.clone())),
    );
    assert!(!dx_no.is_pqc_registered(&dx_no.sender).await.unwrap());
}

#[tokio::test]
async fn ensure_pqc_registered_skips_when_already_registered() {
    let server = MockServer::start(
        r#"{"registered":true,"algorithm_id":1}"#,
        r#"{"tx_response":{"code":0,"txhash":"SHOULD_NOT_BROADCAST"}}"#,
    )
    .await;
    let dx = make_pqc_dx(
        server.base_url.clone(),
        Some(QorClient::new(server.base_url.clone())),
    );

    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(res.already_registered);
    assert_eq!(res.tx_hash, None);

    // No broadcast happened — only the status read.
    let broadcasts = server
        .recorded()
        .into_iter()
        .filter(|r| r.path == "/cosmos/tx/v1beta1/txs")
        .count();
    assert_eq!(broadcasts, 0);
}

#[tokio::test]
async fn ensure_pqc_registered_broadcasts_when_missing() {
    let server = MockServer::start(
        r#"{"registered":false}"#,
        r#"{"tx_response":{"code":0,"txhash":"REG_TX_HASH"}}"#,
    )
    .await;
    let dx = make_pqc_dx(
        server.base_url.clone(),
        Some(QorClient::new(server.base_url.clone())),
    );

    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(!res.already_registered);
    assert_eq!(res.tx_hash, Some("REG_TX_HASH".to_string()));

    // Exactly one broadcast carrying MsgRegisterPQCKeyV2 with the signer's keys.
    let broadcasts = server
        .recorded()
        .into_iter()
        .filter(|r| r.path == "/cosmos/tx/v1beta1/txs")
        .count();
    assert_eq!(broadcasts, 1);

    let msg = decode_register_msg(&server);
    assert_eq!(msg.sender, dx.sender);
    assert_eq!(msg.public_key, dx.pqc_public_key);
    assert_eq!(msg.algorithm_id, 1); // ALGORITHM_DILITHIUM5 (ML-DSA-87)
    assert_eq!(msg.ecdsa_pubkey, dx.public_key);
    assert_eq!(msg.key_type, "hybrid"); // default applied for empty key_type
}

#[tokio::test]
async fn ensure_pqc_registered_without_qor_broadcasts_unconditionally() {
    // No QorClient -> no pre-flight check -> always broadcasts.
    let server = MockServer::start(
        r#"{"registered":true}"#,
        r#"{"tx_response":{"code":0,"txhash":"UNCONDITIONAL"}}"#,
    )
    .await;
    let dx = make_pqc_dx(server.base_url.clone(), None);

    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(!res.already_registered);
    assert_eq!(res.tx_hash, Some("UNCONDITIONAL".to_string()));

    let broadcasts = server
        .recorded()
        .into_iter()
        .filter(|r| r.path == "/cosmos/tx/v1beta1/txs")
        .count();
    assert_eq!(broadcasts, 1);
}

#[tokio::test]
async fn get_pqc_status_requires_qor_client() {
    let dx = make_pqc_dx("http://127.0.0.1:0".into(), None);
    assert!(dx.get_pqc_status(&dx.sender).await.is_err());
}

#[tokio::test]
async fn migrate_to_hybrid_ensures_then_binds_keypair() {
    let server = MockServer::start(
        r#"{"registered":false}"#,
        r#"{"tx_response":{"code":0,"txhash":"MIGR"}}"#,
    )
    .await;
    let dx = make_pqc_dx(
        server.base_url.clone(),
        Some(QorClient::new(server.base_url.clone())),
    );

    let path = dx.migrate_to_hybrid().await.unwrap();
    assert!(!path.already_registered);
    assert_eq!(path.registration_tx_hash, Some("MIGR".to_string()));
    // The bound DX carries the same PQC key material.
    assert_eq!(path.dx.pqc_public_key, dx.pqc_public_key);
}
