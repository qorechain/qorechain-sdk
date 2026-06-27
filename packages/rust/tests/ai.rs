//! AI pre-flight tests: `aiRiskScore` / `aiAnomalyCheck` over mocked `eth_call`
//! and `simulate_with_risk_score` over mocked `eth_call` + `eth_estimateGas`.
//!
//! The mock server is a tiny hyper service that records every JSON-RPC request
//! and replies based on the `method` field, so a single server can answer
//! `eth_call`, `eth_estimateGas`, and dispatch the two precompiles by their
//! address. No real network access is used.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use tokio::net::TcpListener;

use qorechain::ai::{AiClient, PreflightTx, AI_ANOMALY_CHECK_PRECOMPILE, AI_RISK_SCORE_PRECOMPILE};

/// A single recorded JSON-RPC request body.
#[derive(Debug, Clone)]
struct Recorded {
    body: String,
}

struct MockServer {
    base_url: String,
    recorded: Arc<Mutex<Vec<Recorded>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

/// A 32-byte big-endian word holding `value` in the low bytes, as 0x-hex (no
/// 0x prefix; concatenated by the caller).
fn word_hex(value: u128) -> String {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&value.to_be_bytes());
    hex::encode(w)
}

impl MockServer {
    /// Starts a server whose response is computed from the request `method`:
    /// - `eth_estimateGas` -> `gas_hex`
    /// - `eth_call` to the risk precompile -> two words (`risk_score`, `level`)
    /// - `eth_call` to the anomaly precompile -> two words (`anomaly_score`,
    ///   `flagged`)
    async fn start(gas: u64, risk_score: u128, level: u8, anomaly_score: u128, flagged: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let recorded: Arc<Mutex<Vec<Recorded>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let risk_ret = format!("0x{}{}", word_hex(risk_score), word_hex(level as u128));
        let anomaly_ret = format!(
            "0x{}{}",
            word_hex(anomaly_score),
            word_hex(if flagged { 1 } else { 0 })
        );
        let gas_ret = format!("0x{gas:x}");

        let rec = recorded.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let rec = rec.clone();
                        let risk_ret = risk_ret.clone();
                        let anomaly_ret = anomaly_ret.clone();
                        let gas_ret = gas_ret.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let rec = rec.clone();
                                let risk_ret = risk_ret.clone();
                                let anomaly_ret = anomaly_ret.clone();
                                let gas_ret = gas_ret.clone();
                                async move {
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    rec.lock().unwrap().push(Recorded { body: body.clone() });
                                    let v: Value = serde_json::from_str(&body).unwrap();
                                    let method = v["method"].as_str().unwrap_or("");
                                    let result = match method {
                                        "eth_estimateGas" => gas_ret.clone(),
                                        "eth_call" => {
                                            let to = v["params"][0]["to"].as_str().unwrap_or("");
                                            if to.eq_ignore_ascii_case(AI_RISK_SCORE_PRECOMPILE) {
                                                risk_ret.clone()
                                            } else if to.eq_ignore_ascii_case(AI_ANOMALY_CHECK_PRECOMPILE) {
                                                anomaly_ret.clone()
                                            } else {
                                                "0x".to_string()
                                            }
                                        }
                                        _ => "0x".to_string(),
                                    };
                                    let resp = json!({ "jsonrpc": "2.0", "id": 1, "result": result });
                                    Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(resp.to_string()))))
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

    fn bodies(&self) -> Vec<Recorded> {
        self.recorded.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn ai_risk_score_encodes_and_decodes() {
    let server = MockServer::start(21_000, 7, 2, 0, false).await;
    let client = AiClient::new(server.base_url.clone());

    let res = client.ai_risk_score(&[0xde, 0xad, 0xbe, 0xef]).await.unwrap();
    assert_eq!(res.score.as_u128(), Some(7));
    assert_eq!(res.level, 2);

    // The eth_call was sent to the risk precompile with our calldata.
    let last = server.bodies().pop().unwrap();
    let v: Value = serde_json::from_str(&last.body).unwrap();
    assert_eq!(v["method"], "eth_call");
    assert!(v["params"][0]["to"]
        .as_str()
        .unwrap()
        .eq_ignore_ascii_case(AI_RISK_SCORE_PRECOMPILE));
    let data = v["params"][0]["data"].as_str().unwrap();
    // selector(aiRiskScore(bytes)) + offset 0x20 + length 4 + padded data.
    assert!(data.starts_with("0x"));
    let raw = hex::decode(&data[2..]).unwrap();
    assert_eq!(raw.len(), 4 + 32 + 32 + 32);
    // offset word == 0x20, length == 4, data prefix == deadbeef.
    assert_eq!(raw[4 + 31], 0x20);
    assert_eq!(raw[4 + 32 + 31], 4);
    assert_eq!(&raw[4 + 64..4 + 64 + 4], &[0xde, 0xad, 0xbe, 0xef]);
}

#[tokio::test]
async fn ai_anomaly_check_encodes_and_decodes() {
    let server = MockServer::start(21_000, 0, 0, 999, true).await;
    let client = AiClient::new(server.base_url.clone());

    let addr = "0x000000000000000000000000000000000000dEaD";
    let res = client.ai_anomaly_check(addr, 1_000_000).await.unwrap();
    assert_eq!(res.anomaly_score.as_u128(), Some(999));
    assert!(res.flagged);

    let last = server.bodies().pop().unwrap();
    let v: Value = serde_json::from_str(&last.body).unwrap();
    assert_eq!(v["method"], "eth_call");
    assert!(v["params"][0]["to"]
        .as_str()
        .unwrap()
        .eq_ignore_ascii_case(AI_ANOMALY_CHECK_PRECOMPILE));
    let raw = hex::decode(&v["params"][0]["data"].as_str().unwrap()[2..]).unwrap();
    // selector + address word + uint256 word.
    assert_eq!(raw.len(), 4 + 32 + 32);
    // address left-padded -> last two bytes of first word are de ad.
    assert_eq!(raw[4 + 30], 0xde);
    assert_eq!(raw[4 + 31], 0xad);
    // amount in the low bytes of the second word.
    let mut low = [0u8; 16];
    low.copy_from_slice(&raw[4 + 32 + 16..]);
    assert_eq!(u128::from_be_bytes(low), 1_000_000);
}

#[tokio::test]
async fn simulate_with_risk_score_safe_path() {
    // level 1 (< 3) and not flagged => safe.
    let server = MockServer::start(50_000, 10, 1, 5, false).await;
    let client = AiClient::new(server.base_url.clone());

    let pre = client
        .simulate_with_risk_score(PreflightTx {
            from: "0x000000000000000000000000000000000000dEaD".into(),
            to: "0x000000000000000000000000000000000000bEEf".into(),
            data: vec![0x01, 0x02],
            value: "1000000".into(),
        })
        .await
        .unwrap();

    assert_eq!(pre.gas, 50_000);
    assert_eq!(pre.risk.level, 1);
    assert!(!pre.anomaly.flagged);
    assert!(pre.safe);

    // Three JSON-RPC calls: estimateGas, then the two eth_calls.
    let methods: Vec<String> = server
        .bodies()
        .iter()
        .map(|r| {
            let v: Value = serde_json::from_str(&r.body).unwrap();
            v["method"].as_str().unwrap().to_string()
        })
        .collect();
    assert_eq!(methods, vec!["eth_estimateGas", "eth_call", "eth_call"]);
}

#[tokio::test]
async fn simulate_with_risk_score_unsafe_when_flagged() {
    // not risky (level 0) but flagged => unsafe.
    let server = MockServer::start(50_000, 0, 0, 1, true).await;
    let client = AiClient::new(server.base_url.clone());
    let pre = client
        .simulate_with_risk_score(PreflightTx {
            from: "0x000000000000000000000000000000000000dEaD".into(),
            to: String::new(),
            data: vec![],
            value: String::new(),
        })
        .await
        .unwrap();
    assert!(!pre.safe);
}

#[tokio::test]
async fn simulate_with_risk_score_unsafe_when_high_level() {
    // level 3 (>= 3) => unsafe even if not flagged.
    let server = MockServer::start(50_000, 100, 3, 0, false).await;
    let client = AiClient::new(server.base_url.clone());
    let pre = client
        .simulate_with_risk_score(PreflightTx {
            from: "0x000000000000000000000000000000000000dEaD".into(),
            to: String::new(),
            data: vec![0xaa],
            value: "0".into(),
        })
        .await
        .unwrap();
    assert_eq!(pre.risk.level, 3);
    assert!(!pre.safe);
}

#[test]
fn precompile_addresses_are_exported_exactly() {
    assert_eq!(
        AI_RISK_SCORE_PRECOMPILE,
        "0x0000000000000000000000000000000000000B01"
    );
    assert_eq!(
        AI_ANOMALY_CHECK_PRECOMPILE,
        "0x0000000000000000000000000000000000000B02"
    );
}
