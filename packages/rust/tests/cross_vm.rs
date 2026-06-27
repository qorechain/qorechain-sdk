//! Cross-VM helper tests: `call` / `build_call` / `call_atomic` (asserting the
//! built tx's messages, the cosmwasm JSON payload, and that an atomic call packs
//! N messages into ONE tx) and `get_message`.
//!
//! Writes are broadcast against a tiny hyper mock server that records the REST
//! POST body; the signed `TxRaw` is decoded back to assert its messages. Reads
//! (`get_message`) go through a mocked JSON-RPC endpoint. No real network.

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
use qorechain::cross_vm::{CallOptions, CrossVm, Payload, VM_TYPE_COSMWASM, VM_TYPE_EVM, VM_TYPE_SVM};
use qorechain::proto::qorechain::crossvm::v1::MsgCrossVmCall;
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
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let rec = rec.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let rec = rec.clone();
                                async move {
                                    let path = req.uri().path().to_string();
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    rec.lock().unwrap().push(Recorded { path, body });
                                    Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(response_body))))
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

    fn last(&self) -> Recorded {
        self.recorded.lock().unwrap().last().cloned().unwrap()
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

fn make_cross_vm(rest_url: String, qor: Option<QorClient>) -> CrossVm {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    CrossVm {
        sender: acc.address.clone(),
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 1,
        sequence: 0,
        fee: sample_fee(),
        rest_url,
        mode: BroadcastMode::Sync,
        qor,
    }
}

/// Decode the messages from the last broadcast REST POST.
fn decode_broadcast_messages(server: &MockServer) -> Vec<MsgCrossVmCall> {
    let last = server.last();
    assert_eq!(last.path, "/cosmos/tx/v1beta1/txs");
    let v: Value = serde_json::from_str(&last.body).unwrap();
    let tx_bytes = BASE64.decode(v["tx_bytes"].as_str().unwrap()).unwrap();
    let tx_raw = TxRaw::decode(tx_bytes.as_slice()).unwrap();
    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    body.messages
        .iter()
        .map(|any| {
            assert_eq!(any.type_url, "/qorechain.crossvm.v1.MsgCrossVMCall");
            MsgCrossVmCall::decode(any.value.as_slice()).unwrap()
        })
        .collect()
}

#[tokio::test]
async fn call_builds_signs_and_broadcasts_one_message() {
    let server = MockServer::start(r#"{"tx_response":{"code":0,"txhash":"ABC"}}"#).await;
    let cv = make_cross_vm(server.base_url.clone(), None);

    let opts = CallOptions::new(VM_TYPE_COSMWASM, "qor1contract", vec![0xaa, 0xbb])
        .source_vm(VM_TYPE_EVM)
        .funds(vec![Coin { denom: "uqor".into(), amount: "100".into() }]);

    let resp = cv.call(&opts).await.unwrap();
    assert_eq!(resp["tx_response"]["code"], 0);

    let msgs = decode_broadcast_messages(&server);
    assert_eq!(msgs.len(), 1);
    let m = &msgs[0];
    assert_eq!(m.sender, cv.sender);
    assert_eq!(m.source_vm, "evm");
    assert_eq!(m.target_vm, "cosmwasm");
    assert_eq!(m.target_contract, "qor1contract");
    assert_eq!(m.payload, vec![0xaa, 0xbb]);
    assert_eq!(m.funds.len(), 1);
    assert_eq!(m.funds[0].amount, "100");
}

#[tokio::test]
async fn build_call_does_not_broadcast() {
    // No server hit expected: build only.
    let cv = make_cross_vm("http://127.0.0.1:0".into(), None);
    let opts = CallOptions::new(VM_TYPE_SVM, "prog", vec![1, 2, 3]);
    let built = cv.build_call(&opts).unwrap();
    assert!(!built.tx_raw_bytes.is_empty());

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    assert_eq!(tx_raw.signatures.len(), 1);
    assert_eq!(tx_raw.signatures[0].len(), 64);
    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    assert_eq!(body.messages.len(), 1);
    let m = MsgCrossVmCall::decode(body.messages[0].value.as_slice()).unwrap();
    assert_eq!(m.target_vm, "svm");
    assert_eq!(m.payload, vec![1, 2, 3]);
}

#[tokio::test]
async fn cosmwasm_payload_is_serialized_to_json_bytes() {
    let server = MockServer::start(r#"{"tx_response":{"code":0}}"#).await;
    let cv = make_cross_vm(server.base_url.clone(), None);

    let opts = CallOptions::new(
        VM_TYPE_COSMWASM,
        "qor1cw",
        Payload::CosmWasm(serde_json::json!({ "transfer": { "amount": "5" } })),
    );
    cv.call(&opts).await.unwrap();

    let msgs = decode_broadcast_messages(&server);
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].payload, br#"{"transfer":{"amount":"5"}}"#.to_vec());
}

#[tokio::test]
async fn call_atomic_packs_n_messages_into_one_tx() {
    let server = MockServer::start(r#"{"tx_response":{"code":0}}"#).await;
    let cv = make_cross_vm(server.base_url.clone(), None);

    let calls = vec![
        CallOptions::new(VM_TYPE_COSMWASM, "c1", vec![1]),
        CallOptions::new(VM_TYPE_SVM, "c2", vec![2]),
        CallOptions::new(VM_TYPE_EVM, "c3", vec![3]).source_vm(VM_TYPE_SVM),
    ];
    cv.call_atomic(&calls).await.unwrap();

    // Exactly one broadcast.
    assert_eq!(server.recorded.lock().unwrap().len(), 1);

    let msgs = decode_broadcast_messages(&server);
    assert_eq!(msgs.len(), 3);
    assert_eq!(msgs[0].target_contract, "c1");
    assert_eq!(msgs[0].target_vm, "cosmwasm");
    assert_eq!(msgs[1].target_contract, "c2");
    assert_eq!(msgs[1].target_vm, "svm");
    assert_eq!(msgs[2].target_contract, "c3");
    assert_eq!(msgs[2].source_vm, "svm");
    assert_eq!(msgs[2].target_vm, "evm");
}

#[tokio::test]
async fn call_atomic_rejects_empty() {
    let cv = make_cross_vm("http://127.0.0.1:0".into(), None);
    assert!(cv.build_atomic(&[]).is_err());
}

#[tokio::test]
async fn get_message_uses_qor_method() {
    let server = MockServer::start(r#"{"jsonrpc":"2.0","id":1,"result":{"status":"executed"}}"#).await;
    let qor = QorClient::new(server.base_url.clone());
    let cv = make_cross_vm(server.base_url.clone(), Some(qor));

    let res = cv.get_message("msg-123").await.unwrap();
    assert_eq!(res["status"], "executed");

    let last = server.last();
    let v: Value = serde_json::from_str(&last.body).unwrap();
    assert_eq!(v["method"], "qor_getCrossVMMessage");
    assert_eq!(v["params"][0], "msg-123");
}

#[tokio::test]
async fn get_message_requires_qor_client() {
    let cv = make_cross_vm("http://127.0.0.1:0".into(), None);
    assert!(cv.get_message("x").await.is_err());
}
