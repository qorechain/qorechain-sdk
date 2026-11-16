//! Which `MsgExecuteEVM` digest a network verifies: the chain's
//! `abstractaccount-hardening` switch decides first, the v3.2.3 applied plan
//! only when the node definitively does not serve the switch, and a node that
//! could not be asked is an error (never a fall back, never a guess).
//!
//! A tiny local hyper mock serves the protocol features route and the v3.2.3
//! `applied_plan` route and counts every request. No real network access.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use qorechain::authenticator::{evm_auth_digest_version, ABSTRACTACCOUNT_HARDENING_FEATURE};
use qorechain::query::RestClient;
use qorechain::Error;

const FEATURES_PATH: &str = "/qorechain/pqc/v1/protocol_features";
const PLAN_PATH: &str = "/cosmos/upgrade/v1beta1/applied_plan/v3.2.3";
const PLAN_APPLIED: &str = r#"{"height":"8003746"}"#;
const PLAN_NOT_APPLIED: &str = r#"{"height":"0"}"#;

fn features_body(flag: Option<bool>) -> String {
    let mut items =
        vec![r#"{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false}"#.into()];
    if let Some(on) = flag {
        items.push(format!(
            r#"{{"name":"abstractaccount-hardening","enabled":{on},"known":true,"staged":false}}"#
        ));
    }
    format!(r#"{{"features":[{}],"height":"42"}}"#, items.join(","))
}

struct Node {
    base_url: String,
    features: Arc<Mutex<(u16, String)>>,
    hits: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl Node {
    async fn start(features: (u16, &str), plan: &str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let features = Arc::new(Mutex::new((features.0, features.1.to_string())));
        let plan = Arc::new(plan.to_string());
        let hits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        let (feat_c, hits_c) = (features.clone(), hits.clone());
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let (feat, plan, hits) = (feat_c.clone(), plan.clone(), hits_c.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (feat, plan, hits) = (feat.clone(), plan.clone(), hits.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let _ = req.into_body().collect().await;
                                    hits.lock().unwrap().push(path.clone());
                                    let (status, resp) = if path == FEATURES_PATH {
                                        feat.lock().unwrap().clone()
                                    } else if path == PLAN_PATH {
                                        (200, plan.to_string())
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
            .filter(|p| *p == path)
            .count()
    }

    async fn version(&self) -> qorechain::Result<&'static str> {
        evm_auth_digest_version(&RestClient::new(self.base_url.clone()), None).await
    }
}

#[test]
fn feature_name_matches_the_chain() {
    assert_eq!(
        ABSTRACTACCOUNT_HARDENING_FEATURE,
        "abstractaccount-hardening"
    );
}

/// A fork or fest chain runs the v2 rule from genesis with the plan at 0.
#[tokio::test]
async fn feature_enabled_is_v2_without_asking_the_plan() {
    let node = Node::start((200, &features_body(Some(true))), PLAN_NOT_APPLIED).await;
    assert_eq!(node.version().await.unwrap(), "v2");
    assert_eq!(node.count(FEATURES_PATH), 1);
    assert_eq!(node.count(PLAN_PATH), 0);
}

#[tokio::test]
async fn feature_disabled_is_v1_even_with_the_plan_applied() {
    let node = Node::start((200, &features_body(Some(false))), PLAN_APPLIED).await;
    assert_eq!(node.version().await.unwrap(), "v1");
    assert_eq!(node.count(PLAN_PATH), 0);
}

#[tokio::test]
async fn not_served_answers_fall_back_to_the_plan() {
    let absent = features_body(None);
    let cases: [(u16, &str, &str); 5] = [
        (404, r#"{"code":5,"message":"Not Found"}"#, "404"),
        (501, r#"{"code":12,"message":"Not Implemented"}"#, "501"),
        (200, r#"{"features":[],"height":"42"}"#, "empty list"),
        (200, r#"{"height":"42"}"#, "no features key"),
        (200, &absent, "switch absent"),
    ];
    for (status, body, label) in cases {
        for (plan, want) in [(PLAN_APPLIED, "v2"), (PLAN_NOT_APPLIED, "v1")] {
            let node = Node::start((status, body), plan).await;
            assert_eq!(node.version().await.unwrap(), want, "{label} / {plan}");
            assert_eq!(node.count(FEATURES_PATH), 1, "{label}");
            assert_eq!(node.count(PLAN_PATH), 1, "{label}");
        }
    }
}

#[tokio::test]
async fn failing_node_is_an_error_without_a_plan_request() {
    let cases: [(u16, &str, &str); 4] = [
        (500, r#"{"message":"boom"}"#, "500"),
        (503, "", "503"),
        (429, "slow down", "429"),
        (200, "<html>", "unparsable"),
    ];
    for (status, body, label) in cases {
        let node = Node::start((status, body), PLAN_APPLIED).await;
        let err = node.version().await.unwrap_err();
        assert!(matches!(err, Error::Pqc(_)), "{label}: {err:?}");
        assert!(err.to_string().contains("cannot ask"), "{label}: {err}");
        assert_eq!(node.count(PLAN_PATH), 0, "{label}: no plan fall back");
    }
}

#[tokio::test]
async fn connection_refused_is_an_error() {
    let err = evm_auth_digest_version(&RestClient::new("http://127.0.0.1:1"), None)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Pqc(_)), "{err:?}");
}

#[tokio::test]
async fn answers_are_cached_within_the_ttl_and_errors_are_not() {
    let node = Node::start((500, "{}"), PLAN_NOT_APPLIED).await;
    let rest = RestClient::new(node.base_url.clone());
    let key = Some(node.base_url.as_str());
    // An error is not cached: the next call asks again.
    assert!(evm_auth_digest_version(&rest, key).await.is_err());
    node.set_features(200, &features_body(Some(true)));
    assert_eq!(evm_auth_digest_version(&rest, key).await.unwrap(), "v2");
    assert_eq!(node.count(FEATURES_PATH), 2);
    // A success is served from the cache (a trailing slash is the same key).
    node.set_features(200, &features_body(Some(false)));
    let slash = format!("{}/", node.base_url);
    assert_eq!(
        evm_auth_digest_version(&rest, Some(&slash)).await.unwrap(),
        "v2"
    );
    assert_eq!(node.count(FEATURES_PATH), 2);
    // No cache key asks every time.
    assert_eq!(evm_auth_digest_version(&rest, None).await.unwrap(), "v1");
    assert_eq!(node.count(FEATURES_PATH), 3);
    qorechain::authenticator::clear_evm_auth_digest_cache();
    assert_eq!(evm_auth_digest_version(&rest, key).await.unwrap(), "v1");
    assert_eq!(node.count(FEATURES_PATH), 4);
}
