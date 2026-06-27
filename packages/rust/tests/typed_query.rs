//! Typed query-client test: drives `abci_query` against a mock JSON-RPC server
//! that returns a prost-encoded response value, and asserts the typed decode.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use qorechain::proto::qorechain as pb;
use qorechain::TypedQueryClient;

struct MockServer {
    base_url: String,
    last_body: Arc<Mutex<Option<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockServer {
    async fn start(response_value_b64: String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let last_body: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        let resp_body = format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":{{"response":{{"code":0,"value":"{response_value_b64}"}}}}}}"#
        );
        let last = last_body.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let last = last.clone();
                        let resp_body = resp_body.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let last = last.clone();
                                let resp_body = resp_body.clone();
                                async move {
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    *last.lock().unwrap() =
                                        Some(String::from_utf8_lossy(&bytes).to_string());
                                    Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(
                                        resp_body,
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
            last_body,
            _shutdown: tx,
        }
    }
}

#[tokio::test]
async fn typed_pqc_account_query_decodes_response() {
    // Build a prost-encoded QueryAccountResponse the mock will return.
    let resp = pb::pqc::v1::QueryAccountResponse {
        found: true,
        account: Some(pb::pqc::v1::PqcAccountView {
            address: "qor1xyz".into(),
            algorithm_id: 1,
            algorithm_name: "dilithium5".into(),
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.pqc_account("qor1xyz").await.unwrap();
    assert!(got.found);
    let acct = got.account.unwrap();
    assert_eq!(acct.address, "qor1xyz");
    assert_eq!(acct.algorithm_id, 1);
    assert_eq!(acct.algorithm_name, "dilithium5");

    // The request used abci_query with the correct gRPC path.
    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["method"], "abci_query");
    assert_eq!(v["params"]["path"], "/qorechain.pqc.v1.Query/Account");
}

#[tokio::test]
async fn typed_svm_slot_query_decodes_response() {
    let resp = pb::svm::v1::QuerySlotResponse { slot: 12345 };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.svm_slot().await.unwrap();
    assert_eq!(got.slot, 12345);

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["params"]["path"], "/qorechain.svm.v1.Query/Slot");
}

#[tokio::test]
async fn typed_multilayer_layer_query_decodes_response() {
    let resp = pb::multilayer::v1::QueryLayerResponse {
        layer: Some(pb::multilayer::v1::LayerView {
            layer_id: "layer-1".into(),
            layer_type: "sidechain".into(),
            status: "active".into(),
            chain_id: "qorechain-vladi".into(),
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.multilayer_layer("layer-1").await.unwrap();
    let layer = got.layer.unwrap();
    assert_eq!(layer.layer_id, "layer-1");
    assert_eq!(layer.layer_type, "sidechain");
    assert_eq!(layer.status, "active");

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["method"], "abci_query");
    assert_eq!(v["params"]["path"], "/qorechain.multilayer.v1.Query/Layer");
}

#[tokio::test]
async fn typed_multilayer_routing_stats_query_decodes_response() {
    let resp = pb::multilayer::v1::QueryRoutingStatsView {
        stats: Some(pb::multilayer::v1::RoutingStatsView {
            total_routed: 42,
            routed_to_sidechains: 30,
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.multilayer_routing_stats().await.unwrap();
    let stats = got.stats.unwrap();
    assert_eq!(stats.total_routed, 42);
    assert_eq!(stats.routed_to_sidechains, 30);

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        v["params"]["path"],
        "/qorechain.multilayer.v1.Query/RoutingStats"
    );
}

#[tokio::test]
async fn typed_rdk_rollup_query_decodes_response() {
    let resp = pb::rdk::v1::QueryRollupResponse {
        rollup: Some(pb::rdk::v1::RollupView {
            rollup_id: "rollup-1".into(),
            creator: "qor1creator".into(),
            vm_type: "evm".into(),
            status: "active".into(),
            stake_amount: 1000,
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.rdk_rollup("rollup-1").await.unwrap();
    let rollup = got.rollup.unwrap();
    assert_eq!(rollup.rollup_id, "rollup-1");
    assert_eq!(rollup.vm_type, "evm");
    assert_eq!(rollup.stake_amount, 1000);

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["params"]["path"], "/qorechain.rdk.v1.Query/Rollup");
}

#[tokio::test]
async fn typed_rdk_latest_batch_query_decodes_response() {
    let resp = pb::rdk::v1::QueryLatestBatchResponse {
        batch: Some(pb::rdk::v1::BatchView {
            rollup_id: "rollup-1".into(),
            batch_index: 9,
            status: "finalized".into(),
            withdrawals_root: "0xroot".into(),
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.rdk_latest_batch("rollup-1").await.unwrap();
    let batch = got.batch.unwrap();
    assert_eq!(batch.batch_index, 9);
    assert_eq!(batch.status, "finalized");
    assert_eq!(batch.withdrawals_root, "0xroot");

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["params"]["path"], "/qorechain.rdk.v1.Query/LatestBatch");
}

#[tokio::test]
async fn typed_rdk_batch_query_sends_batch_index() {
    let resp = pb::rdk::v1::QueryBatchResponse {
        batch: Some(pb::rdk::v1::BatchView {
            rollup_id: "rollup-1".into(),
            batch_index: 4,
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.rdk_batch("rollup-1", 4).await.unwrap();
    assert_eq!(got.batch.unwrap().batch_index, 4);

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["params"]["path"], "/qorechain.rdk.v1.Query/Batch");
}

#[tokio::test]
async fn typed_bridge_chain_config_query_decodes_response() {
    let resp = pb::bridge::v1::QueryChainConfigResponse {
        chain: Some(pb::bridge::v1::ChainConfigView {
            chain_id: "ethereum".into(),
            name: "Ethereum".into(),
            status: "active".into(),
            architecture: "evm".into(),
            ..Default::default()
        }),
    };
    let value_b64 = BASE64.encode(prost::Message::encode_to_vec(&resp));
    let server = MockServer::start(value_b64).await;

    let client = TypedQueryClient::new(server.base_url.clone());
    let got = client.bridge_chain_config("ethereum").await.unwrap();
    let chain = got.chain.unwrap();
    assert_eq!(chain.chain_id, "ethereum");
    assert_eq!(chain.status, "active");

    let body = server.last_body.lock().unwrap().clone().unwrap();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["params"]["path"], "/qorechain.bridge.v1.Query/ChainConfig");
}
