//! Whether `MsgRegisterPQCKeyV2` carries a proof of possession: the chain's
//! `pqc-possession-flag` switch decides first, the v3.2.3 applied plan only
//! when the node definitively does not serve the switch, and a node that could
//! not be asked is an error (never a fall back, never a guess).
//!
//! A tiny local hyper mock serves the protocol features route, the v3.2.3
//! `applied_plan` route, the PQC status route and the broadcast route, and
//! records every request. No real network access is used.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
use cosmrs::proto::traits::Message as ProstMessage;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use tokio::net::TcpListener;

use qorechain::accounts::derive_native_account;
use qorechain::key_integrity::{
    proof_of_possession_accepted, resolve_proof_of_possession, verify_proof_of_possession,
    ProofOfPossessionMode, PQC_POSSESSION_FLAG_FEATURE,
};
use qorechain::pqc_dx::PqcDx;
use qorechain::proto::qorechain::pqc::v1::MsgRegisterPqcKeyV2;
use qorechain::signbytes::SignBytesMode;
use qorechain::tx::{BroadcastMode, Coin, Fee};
use qorechain::Error;

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const CHAIN_ID: &str = "qorechain-diana";
const FEATURES_PATH: &str = "/qorechain/pqc/v1/protocol_features";
const PLAN_PATH: &str = "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3";
const BROADCAST_PATH: &str = "/cosmos/tx/v1beta1/txs";
const NOT_IMPLEMENTED: &str = r#"{"code":12,"message":"Not Implemented"}"#;
const PLAN_APPLIED: &str = r#"{"height":"8003746"}"#;
const PLAN_NOT_APPLIED: &str = r#"{"height":"0"}"#;

fn features_body(flag: Option<bool>) -> String {
    let mut items =
        vec![r#"{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false}"#.into()];
    if let Some(on) = flag {
        items.push(format!(
            r#"{{"name":"pqc-possession-flag","enabled":{on},"known":true,"staged":false}}"#
        ));
    }
    format!(r#"{{"features":[{}],"height":"42"}}"#, items.join(","))
}

struct Node {
    base_url: String,
    features: Arc<Mutex<(u16, String)>>,
    hits: Arc<Mutex<Vec<(String, String)>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl Node {
    async fn start(features: (u16, &str), plan: (u16, &str)) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let features = Arc::new(Mutex::new((features.0, features.1.to_string())));
        let plan = Arc::new(Mutex::new((plan.0, plan.1.to_string())));
        let hits: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        let (feat_c, plan_c, hits_c) = (features.clone(), plan.clone(), hits.clone());
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let (feat, plan, hits) = (feat_c.clone(), plan_c.clone(), hits_c.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (feat, plan, hits) = (feat.clone(), plan.clone(), hits.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    hits.lock().unwrap().push((path.clone(), body));
                                    let (status, resp) = if path == FEATURES_PATH {
                                        feat.lock().unwrap().clone()
                                    } else if path == PLAN_PATH {
                                        plan.lock().unwrap().clone()
                                    } else if path.starts_with("/qorechain/pqc/v1/account/") {
                                        (200, r#"{"found":false,"account":null}"#.to_string())
                                    } else if path == BROADCAST_PATH {
                                        (200, r#"{"tx_response":{"code":0,"txhash":"REG"}}"#.to_string())
                                    } else {
                                        (404, "{}".to_string())
                                    };
                                    let mut r = Response::new(Full::new(Bytes::from(resp)));
                                    *r.status_mut() = StatusCode::from_u16(status).unwrap();
                                    Ok::<_, Infallible>(r)
                                }
                            });
                            let _ = hyper::server::conn::http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), svc)
                                .await;
                        });
                    }
                }
            }
        });
        Node {
            base_url,
            features,
            hits,
            _shutdown: tx,
        }
    }

    fn set_features(&self, status: u16, body: &str) {
        *self.features.lock().unwrap() = (status, body.to_string());
    }

    fn count(&self, path: &str) -> usize {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .filter(|(p, _)| p == path)
            .count()
    }

    fn feature_hits(&self) -> usize {
        self.count(FEATURES_PATH)
    }

    fn plan_hits(&self) -> usize {
        self.count(PLAN_PATH)
    }

    fn register_msg(&self) -> MsgRegisterPqcKeyV2 {
        let body = self
            .hits
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(p, _)| p == BROADCAST_PATH)
            .map(|(_, b)| b.clone())
            .expect("a broadcast was recorded");
        let v: Value = serde_json::from_str(&body).unwrap();
        let tx_bytes = BASE64.decode(v["tx_bytes"].as_str().unwrap()).unwrap();
        let raw = TxRaw::decode(tx_bytes.as_slice()).unwrap();
        let tx_body = TxBody::decode(raw.body_bytes.as_slice()).unwrap();
        MsgRegisterPqcKeyV2::decode(tx_body.messages[0].value.as_slice()).unwrap()
    }
}

fn make_dx(url: &str) -> PqcDx {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = qorechain::pqc::pqc_keypair_from_seed(&[3u8; 32]);
    PqcDx {
        sender: acc.address.clone(),
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_public_key: kp.public_key,
        pqc_secret_key: kp.secret_key,
        chain_id: CHAIN_ID.into(),
        account_number: 1,
        sequence: 0,
        fee: Fee {
            amount: vec![Coin {
                denom: "uqor".into(),
                amount: "5000".into(),
            }],
            gas: "200000".into(),
            granter: String::new(),
            payer: String::new(),
        },
        key_type: String::new(),
        rest_url: url.to_string(),
        mode: BroadcastMode::Sync,
        qor: None,
        sign_bytes: SignBytesMode::Auto,
    }
}

#[test]
fn feature_name_matches_the_chain() {
    assert_eq!(PQC_POSSESSION_FLAG_FEATURE, "pqc-possession-flag");
}

/// A fork or fest chain runs the v3.2.3 rules from genesis and answers the
/// plan with height 0: the switch still decides, and the proof is attached.
#[tokio::test]
async fn feature_enabled_attaches_the_proof_without_asking_the_plan() {
    let node = Node::start((200, &features_body(Some(true))), (200, PLAN_NOT_APPLIED)).await;
    let dx = make_dx(&node.base_url);
    dx.ensure_pqc_registered().await.unwrap();
    let msg = node.register_msg();
    assert!(verify_proof_of_possession(
        &dx.chain_id,
        &dx.sender,
        &dx.pqc_public_key,
        &msg.proof_of_possession
    ));
    assert_eq!(node.feature_hits(), 1);
    assert_eq!(node.plan_hits(), 0);
}

#[tokio::test]
async fn feature_disabled_leaves_the_proof_off_even_with_the_plan_applied() {
    let node = Node::start((200, &features_body(Some(false))), (200, PLAN_APPLIED)).await;
    let dx = make_dx(&node.base_url);
    dx.ensure_pqc_registered().await.unwrap();
    assert!(node.register_msg().proof_of_possession.is_empty());
    assert_eq!(node.plan_hits(), 0);
}

#[tokio::test]
async fn not_served_answers_fall_back_to_the_plan() {
    let empty = r#"{"features":[],"height":"42"}"#.to_string();
    let absent = features_body(None);
    let cases: [(u16, &str, &str); 4] = [
        (404, r#"{"code":5,"message":"Not Found"}"#, "404"),
        (501, NOT_IMPLEMENTED, "501"),
        (200, &empty, "empty list"),
        (200, &absent, "switch absent"),
    ];
    for (status, body, label) in cases {
        for (plan, want) in [(PLAN_APPLIED, true), (PLAN_NOT_APPLIED, false)] {
            let node = Node::start((status, body), (200, plan)).await;
            let got = proof_of_possession_accepted(&node.base_url, CHAIN_ID)
                .await
                .unwrap();
            assert_eq!(got, want, "{label} / {plan}");
            assert_eq!(node.feature_hits(), 1, "{label}");
            assert_eq!(node.plan_hits(), 1, "{label}");
        }
    }
}

#[tokio::test]
async fn unreachable_or_failing_node_is_an_error_without_a_plan_request() {
    let cases: [(u16, &str, &str); 5] = [
        (500, r#"{"message":"boom"}"#, "500"),
        (502, "bad gateway", "502"),
        (503, "", "503"),
        (429, "slow down", "429"),
        (200, "<html>", "unparsable"),
    ];
    for (status, body, label) in cases {
        let node = Node::start((status, body), (200, PLAN_APPLIED)).await;
        let err = proof_of_possession_accepted(&node.base_url, CHAIN_ID)
            .await
            .unwrap_err();
        assert!(matches!(err, Error::Pqc(_)), "{label}: {err:?}");
        let msg = err.to_string();
        assert!(msg.contains("cannot ask"), "{label}: {msg}");
        assert!(
            msg.contains("ProofOfPossessionMode::Attach"),
            "{label}: {msg}"
        );
        assert_eq!(node.plan_hits(), 0, "{label}: no plan fall back");
    }
}

#[tokio::test]
async fn connection_refused_is_an_error() {
    let err = proof_of_possession_accepted("http://127.0.0.1:1", CHAIN_ID)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Pqc(_)), "{err:?}");
}

#[tokio::test]
async fn failing_node_sends_no_registration() {
    let node = Node::start((500, "{}"), (200, PLAN_APPLIED)).await;
    let dx = make_dx(&node.base_url);
    assert!(dx.ensure_pqc_registered().await.is_err());
    assert_eq!(node.count(BROADCAST_PATH), 0);
}

#[tokio::test]
async fn explicit_choice_makes_no_request() {
    // A closed port: any request would fail.
    for (mode, want) in [
        (ProofOfPossessionMode::Attach, true),
        (ProofOfPossessionMode::Skip, false),
    ] {
        assert_eq!(
            resolve_proof_of_possession(mode, "http://127.0.0.1:1", CHAIN_ID)
                .await
                .unwrap(),
            want
        );
    }
    // Through the registration: the features and plan routes are never asked,
    // even though they would fail.
    let node = Node::start((500, "{}"), (500, "{}")).await;
    let dx = make_dx(&node.base_url);
    dx.ensure_pqc_registered_with(ProofOfPossessionMode::Attach)
        .await
        .unwrap();
    assert!(!node.register_msg().proof_of_possession.is_empty());
    dx.ensure_pqc_registered_with(ProofOfPossessionMode::Skip)
        .await
        .unwrap();
    assert!(node.register_msg().proof_of_possession.is_empty());
    assert_eq!(node.feature_hits(), 0);
    assert_eq!(node.plan_hits(), 0);
}

#[tokio::test]
async fn answers_are_cached_within_the_ttl_and_errors_are_not() {
    let node = Node::start((500, "{}"), (200, PLAN_NOT_APPLIED)).await;
    // An error is not cached: the next call asks again.
    assert!(proof_of_possession_accepted(&node.base_url, CHAIN_ID)
        .await
        .is_err());
    node.set_features(200, &features_body(Some(true)));
    assert!(proof_of_possession_accepted(&node.base_url, CHAIN_ID)
        .await
        .unwrap());
    assert_eq!(node.feature_hits(), 2);
    // A success is cached per (rest, chain id); a trailing slash is the same key.
    node.set_features(200, &features_body(Some(false)));
    let slash = format!("{}/", node.base_url);
    assert!(proof_of_possession_accepted(&slash, CHAIN_ID)
        .await
        .unwrap());
    assert_eq!(node.feature_hits(), 2);
    // Another chain id on the same endpoint is its own entry.
    assert!(
        !proof_of_possession_accepted(&node.base_url, "qorechain-vladi")
            .await
            .unwrap()
    );
    assert_eq!(node.feature_hits(), 3);
    qorechain::key_integrity::clear_proof_of_possession_cache();
    assert!(!proof_of_possession_accepted(&node.base_url, CHAIN_ID)
        .await
        .unwrap());
    assert_eq!(node.feature_hits(), 4);
}
