//! Per-network hybrid sign-bytes (v1 / v2) tests.
//!
//! - Every known-answer vector in `fixtures/signbytes-kat-v3.1.98.json` (copied
//!   from the chain release) is reproduced byte-exact.
//! - The v1 (legacy) forms keep their old layouts.
//! - `sign_bytes_version_for` mirrors the chain's switch.
//! - The resolver is exercised against a tiny local mock HTTP server (no real
//!   network): heights, `{}`, non-legacy chains, missing REST URL, HTTP
//!   failures, the cache TTL and a forced refresh.
//! - The one-shot retry on a `pqc` code-21 refusal runs over a fake transport.
//! - A hybrid tx signed with v2 verifies over the v2 bytes and NOT the v1 bytes.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cosmrs::proto::cosmos::bank::v1beta1::MsgSend;
use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
use cosmrs::proto::traits::Message as ProstMessage;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use tokio::net::TcpListener;

use qorechain::accounts::derive_native_account;
use qorechain::pqc::{generate_pqc_keypair, pqc_verify};
use qorechain::pqc_dx::PqcDx;
use qorechain::sign_eth::{sign_hybrid_eth, EthSignParams};
use qorechain::signbytes::{
    bridge_attestation_sign_bytes, bridge_attestation_sign_bytes_v1,
    bridge_attestation_sign_bytes_v2, broadcast_with_sign_bytes_retry, hybrid_sign_bytes,
    hybrid_sign_bytes_v1, hybrid_sign_bytes_v2, is_hybrid_sign_bytes_rejection,
    is_hybrid_sign_bytes_rejection_error, is_hybrid_sign_bytes_rejection_response,
    migration_sign_bytes, migration_sign_bytes_v1, migration_sign_bytes_v2, sign_bytes_version_for,
    BridgeAttestationSignFields, MigrationSignFields, SignBytesMode, SignBytesResolver,
    SignBytesVersion, HYBRID_SIGN_BYTES_DOMAIN, SIGN_BYTES_V2_UPGRADE, SIGN_BYTES_V2_UPGRADES,
};
use qorechain::tx::{
    build_hybrid_tx, BroadcastMode, BuildHybridTxParams, Coin, Fee, Message as TxMessage,
    QoreTxError,
};
use qorechain::unified::unified_account_from_seed;
use qorechain::Error;

/// Public test mnemonic only (BIP-39 test vector); never a real secret.
const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const APPLIED_PLAN_PREFIX: &str = "/cosmos/upgrade/v1beta1/applied_plan/";
/// The primary (mainnet) plan name: asked first by the resolver.
const PLAN_PATH_PRIMARY: &str = "/cosmos/upgrade/v1beta1/applied_plan/v3.2.0";
/// The name the testnet took the same switch under: asked second.
const PLAN_PATH_LEGACY: &str = "/cosmos/upgrade/v1beta1/applied_plan/v3.1.98";
const BROADCAST_PATH: &str = "/cosmos/tx/v1beta1/txs";

// ---------------------------------------------------------------------------
// Known-answer vectors
// ---------------------------------------------------------------------------

fn kat() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/signbytes-kat-v3.1.98.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str()
        .unwrap_or_else(|| panic!("missing string field {k}"))
}

fn hx(v: &Value, k: &str) -> Vec<u8> {
    hex::decode(s(v, k)).unwrap()
}

#[test]
fn kat_vectors_reproduce_byte_exact() {
    let kat = kat();
    let mut checked = 0;

    for v in kat["hybrid_v2"].as_array().unwrap() {
        let (b0, a) = (hx(v, "body_without_pqc_ext_hex"), hx(v, "auth_info_hex"));
        let want = hx(v, "sign_bytes_hex");
        let chain_id = s(v, "chain_id");
        assert_eq!(
            hybrid_sign_bytes_v2(chain_id, &b0, &a),
            want,
            "hybrid {}",
            s(v, "name")
        );
        assert_eq!(
            hybrid_sign_bytes(SignBytesVersion::V2, chain_id, &b0, &a),
            want,
            "hybrid dispatch {}",
            s(v, "name")
        );
        checked += 1;
    }

    for v in kat["migration_v2"].as_array().unwrap() {
        let (old, new) = (hx(v, "old_public_key_hex"), hx(v, "new_public_key_hex"));
        let f = MigrationSignFields {
            chain_id: s(v, "chain_id"),
            account: s(v, "account"),
            from_algorithm_id: v["from_algorithm_id"].as_u64().unwrap() as u32,
            to_algorithm_id: v["to_algorithm_id"].as_u64().unwrap() as u32,
            execution_height: v["execution_height"].as_i64().unwrap(),
            old_public_key: &old,
            new_public_key: &new,
        };
        let want = hx(v, "sign_bytes_hex");
        assert_eq!(
            migration_sign_bytes_v2(&f),
            want,
            "migration {}",
            s(v, "name")
        );
        assert_eq!(
            migration_sign_bytes(SignBytesVersion::V2, &f),
            want,
            "migration dispatch {}",
            s(v, "name")
        );
        checked += 1;
    }

    for v in kat["bridge_attestation_v2"].as_array().unwrap() {
        let f = BridgeAttestationSignFields {
            chain: s(v, "chain"),
            event_type: s(v, "event_type"),
            operation_id: s(v, "operation_id"),
            tx_hash: s(v, "tx_hash"),
            amount: s(v, "amount"),
            asset: s(v, "asset"),
        };
        let want = hx(v, "sign_bytes_hex");
        let chain_id = s(v, "chain_id");
        assert_eq!(
            bridge_attestation_sign_bytes_v2(chain_id, &f),
            want,
            "bridge {}",
            s(v, "name")
        );
        assert_eq!(
            bridge_attestation_sign_bytes(SignBytesVersion::V2, chain_id, &f),
            want,
            "bridge dispatch {}",
            s(v, "name")
        );
        checked += 1;
    }

    assert_eq!(checked, 11, "all 11 KAT vectors must be exercised");
    assert_eq!(kat["hybrid_domain"], HYBRID_SIGN_BYTES_DOMAIN);
}

// ---------------------------------------------------------------------------
// Legacy (v1) layouts
// ---------------------------------------------------------------------------

#[test]
fn hybrid_v1_is_the_be32_frame() {
    let b0 = [0x0a, 0x01, 0x02];
    let a = [0x12, 0x03, 0x04, 0x05];
    let want = hex::decode("000000030a01020000000412030405").unwrap();
    assert_eq!(hybrid_sign_bytes_v1(&b0, &a), want);
    // v1 ignores the chain id.
    assert_eq!(
        hybrid_sign_bytes(SignBytesVersion::V1, "qorechain-vladi", &b0, &a),
        want
    );
    assert_eq!(
        hybrid_sign_bytes(SignBytesVersion::V1, "other", &b0, &a),
        want
    );
    assert_eq!(hybrid_sign_bytes_v1(&[], &[]), vec![0u8; 8]);
    // v2 differs and binds the chain id.
    assert_ne!(hybrid_sign_bytes_v2("qorechain-vladi", &b0, &a), want);
    assert_ne!(
        hybrid_sign_bytes_v2("qorechain-vladi", &b0, &a),
        hybrid_sign_bytes_v2("qorechain-diana", &b0, &a)
    );
}

#[test]
fn migration_v1_is_the_legacy_ascii_string() {
    let f = MigrationSignFields {
        chain_id: "qorechain-vladi",
        account: "qor1account",
        from_algorithm_id: 1,
        to_algorithm_id: 3,
        execution_height: 4200,
        old_public_key: b"old-key",
        new_public_key: b"new-key",
    };
    let want = b"qorechain-key-migration:chain=qorechain-vladi:from=1:to=3:account=qor1account:height=4200";
    assert_eq!(migration_sign_bytes_v1(&f), want.to_vec());
    assert_eq!(
        migration_sign_bytes(SignBytesVersion::V1, &f),
        want.to_vec()
    );
    // v1 does not bind the keys.
    let g = MigrationSignFields {
        new_public_key: b"attacker-key",
        ..f
    };
    assert_eq!(migration_sign_bytes_v1(&g), migration_sign_bytes_v1(&f));
    assert_ne!(migration_sign_bytes_v2(&g), migration_sign_bytes_v2(&f));
}

#[test]
fn bridge_v1_is_the_pipe_joined_string() {
    let f = BridgeAttestationSignFields {
        chain: "ethereum",
        event_type: "deposit",
        operation_id: "op-0001",
        tx_hash: "0xabc123",
        amount: "1000000",
        asset: "uqor",
    };
    let want = b"ethereum|deposit|op-0001|0xabc123|1000000|uqor".to_vec();
    assert_eq!(bridge_attestation_sign_bytes_v1(&f), want);
    // v1 binds no chain id.
    assert_eq!(
        bridge_attestation_sign_bytes(SignBytesVersion::V1, "qorechain-vladi", &f),
        want
    );
    assert_eq!(
        bridge_attestation_sign_bytes(SignBytesVersion::V1, "qorechain-diana", &f),
        want
    );
}

// ---------------------------------------------------------------------------
// Version selection
// ---------------------------------------------------------------------------

#[test]
fn version_for_truth_table() {
    use SignBytesVersion::{V1, V2};
    let cases = [
        ("qorechain-vladi", 0, V1),
        ("qorechain-vladi", 5_746_000, V2),
        ("qorechain-diana", 0, V1),
        ("qorechain-diana", 5_746_000, V2),
        ("qorechain-other", 0, V2),
        ("qorechain-other", 5_746_000, V2),
    ];
    for (chain, height, want) in cases {
        assert_eq!(
            sign_bytes_version_for(chain, height),
            want,
            "{chain} @ {height}"
        );
    }
}

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

/// A mock node: every `applied_plan` name answers `(status, plan_body)` (both
/// mutable), unless `set_plan_for` overrides one name; each broadcast POST pops
/// the next queued response (the last one repeats).
struct MockNode {
    base_url: String,
    plan: Arc<Mutex<(u16, String)>>,
    plan_overrides: Arc<Mutex<HashMap<String, (u16, String)>>>,
    hits: Arc<Mutex<Vec<(String, String)>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockNode {
    async fn start(plan_body: &str, broadcasts: &[&str]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let plan = Arc::new(Mutex::new((200u16, plan_body.to_string())));
        let plan_overrides: Arc<Mutex<HashMap<String, (u16, String)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let queued = Arc::new(Mutex::new(
            broadcasts.iter().map(|b| b.to_string()).collect::<Vec<_>>(),
        ));
        let hits: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let (plan_c, over_c, queued_c, hits_c) = (
            plan.clone(),
            plan_overrides.clone(),
            queued.clone(),
            hits.clone(),
        );
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let (plan, over, queued, hits) =
                            (plan_c.clone(), over_c.clone(), queued_c.clone(), hits_c.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (plan, over, queued, hits) =
                                    (plan.clone(), over.clone(), queued.clone(), hits.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let bytes = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&bytes).to_string();
                                    hits.lock().unwrap().push((path.clone(), body));
                                    let (status, resp) = if let Some(name) =
                                        path.strip_prefix(APPLIED_PLAN_PREFIX)
                                    {
                                        over.lock()
                                            .unwrap()
                                            .get(name)
                                            .cloned()
                                            .unwrap_or_else(|| plan.lock().unwrap().clone())
                                    } else if path == BROADCAST_PATH {
                                        let mut q = queued.lock().unwrap();
                                        let next = if q.len() > 1 { q.remove(0) } else { q[0].clone() };
                                        (200, next)
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

        MockNode {
            base_url,
            plan,
            plan_overrides,
            hits,
            _shutdown: tx,
        }
    }

    /// The answer every `applied_plan` name gives (unless overridden).
    fn set_plan(&self, status: u16, body: &str) {
        *self.plan.lock().unwrap() = (status, body.to_string());
    }

    /// The answer ONE plan name gives, e.g. only `v3.1.98` (as on the testnet).
    fn set_plan_for(&self, plan_name: &str, status: u16, body: &str) {
        self.plan_overrides
            .lock()
            .unwrap()
            .insert(plan_name.to_string(), (status, body.to_string()));
    }

    fn hits_on(&self, path: &str) -> Vec<String> {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .filter(|(p, _)| p == path)
            .map(|(_, b)| b.clone())
            .collect()
    }

    /// Every `applied_plan` path requested, in order.
    fn plan_hits(&self) -> Vec<String> {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .map(|(p, _)| p.clone())
            .filter(|p| p.starts_with(APPLIED_PLAN_PREFIX))
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

#[test]
fn upgrade_names_are_ordered_and_primary_is_first() {
    // The mainnet name leads, so mainnet costs ONE request once it has upgraded.
    assert_eq!(SIGN_BYTES_V2_UPGRADES, &["v3.2.0", "v3.1.98"]);
    assert_eq!(SIGN_BYTES_V2_UPGRADE, SIGN_BYTES_V2_UPGRADES[0]);
}

#[tokio::test]
async fn resolver_height_above_zero_is_v2() {
    let node = MockNode::start(r#"{"height":"5746000"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let v = r
        .resolve(SignBytesMode::Auto, "qorechain-diana", Some(&node.base_url))
        .await
        .unwrap();
    assert_eq!(v, SignBytesVersion::V2);
    assert_eq!(node.plan_hits(), vec![PLAN_PATH_PRIMARY.to_string()]);
}

/// Mainnet after its own upgrade: the first name answers, nothing else is asked.
#[tokio::test]
async fn resolver_first_name_applied_is_v2_in_one_request() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    node.set_plan_for("v3.2.0", 200, r#"{"height":"9100000"}"#);
    let v = SignBytesResolver::new()
        .resolve(SignBytesMode::Auto, "qorechain-vladi", Some(&node.base_url))
        .await
        .unwrap();
    assert_eq!(v, SignBytesVersion::V2);
    assert_eq!(node.plan_hits(), vec![PLAN_PATH_PRIMARY.to_string()]);
}

/// The testnet took the switch as `v3.1.98` only: the second name decides.
#[tokio::test]
async fn resolver_second_name_applied_is_v2_in_two_requests() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    node.set_plan_for("v3.1.98", 200, r#"{"height":"5746000"}"#);
    let v = SignBytesResolver::new()
        .resolve(SignBytesMode::Auto, "qorechain-diana", Some(&node.base_url))
        .await
        .unwrap();
    assert_eq!(v, SignBytesVersion::V2);
    assert_eq!(
        node.plan_hits(),
        vec![PLAN_PATH_PRIMARY.to_string(), PLAN_PATH_LEGACY.to_string()]
    );
}

/// Mainnet before its upgrade: every name answers 0 (or `{}`), so v1 — and only
/// after ALL of them were asked.
#[tokio::test]
async fn resolver_height_zero_is_v1() {
    for body in [r#"{"height":"0"}"#, "{}"] {
        let node = MockNode::start(body, &["{}"]).await;
        let v = SignBytesResolver::new()
            .resolve(SignBytesMode::Auto, "qorechain-vladi", Some(&node.base_url))
            .await
            .unwrap();
        assert_eq!(v, SignBytesVersion::V1, "body {body}");
        assert_eq!(
            node.plan_hits(),
            vec![PLAN_PATH_PRIMARY.to_string(), PLAN_PATH_LEGACY.to_string()],
            "body {body}"
        );
    }
}

/// A failing query still raises, even when an earlier name already answered 0.
#[tokio::test]
async fn resolver_error_when_a_later_name_fails() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    node.set_plan_for("v3.1.98", 500, r#"{"message":"boom"}"#);
    let err = SignBytesResolver::new()
        .resolve(SignBytesMode::Auto, "qorechain-vladi", Some(&node.base_url))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::SignBytes(_)), "{err:?}");
    let msg = err.to_string();
    // The message names both plan names, so the reader knows what was asked.
    for name in SIGN_BYTES_V2_UPGRADES {
        assert!(msg.contains(name), "{msg}");
    }
}

/// The single-name fetch helper defaults to the primary name.
#[tokio::test]
async fn fetch_helper_defaults_to_the_primary_name() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    node.set_plan_for("v3.2.0", 200, r#"{"height":"7"}"#);
    let r = SignBytesResolver::new();
    assert_eq!(
        r.fetch_v2_applied_height(&node.base_url, None)
            .await
            .unwrap(),
        7
    );
    assert_eq!(
        r.fetch_v2_applied_height(&node.base_url, Some("v3.1.98"))
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        r.fetch_v2_applied_height_any(&node.base_url).await.unwrap(),
        7
    );
    assert_eq!(
        node.plan_hits(),
        vec![
            PLAN_PATH_PRIMARY.to_string(),
            PLAN_PATH_LEGACY.to_string(),
            PLAN_PATH_PRIMARY.to_string()
        ]
    );
}

#[tokio::test]
async fn resolver_non_legacy_chain_is_v2_without_http() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let v = r
        .resolve(
            SignBytesMode::Auto,
            "qorechain-future",
            Some(&node.base_url),
        )
        .await
        .unwrap();
    assert_eq!(v, SignBytesVersion::V2);
    // No REST URL is needed either.
    let v = r
        .resolve(SignBytesMode::Auto, "qorechain-future", None)
        .await
        .unwrap();
    assert_eq!(v, SignBytesVersion::V2);
    assert!(node.plan_hits().is_empty());
}

#[tokio::test]
async fn resolver_explicit_versions_skip_http() {
    let node = MockNode::start(r#"{"height":"5746000"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let url = Some(node.base_url.as_str());
    assert_eq!(
        r.resolve(SignBytesMode::V1, "qorechain-diana", url)
            .await
            .unwrap(),
        SignBytesVersion::V1
    );
    assert_eq!(
        r.resolve(SignBytesMode::V2, "qorechain-vladi", None)
            .await
            .unwrap(),
        SignBytesVersion::V2
    );
    assert!(node.plan_hits().is_empty());
}

#[tokio::test]
async fn resolver_legacy_without_rest_url_is_an_error() {
    let r = SignBytesResolver::new();
    for url in [None, Some("")] {
        let err = r
            .resolve(SignBytesMode::Auto, "qorechain-vladi", url)
            .await
            .unwrap_err();
        assert!(matches!(err, Error::SignBytes(_)), "{err:?}");
        let msg = err.to_string();
        assert!(msg.contains("REST URL"), "{msg}");
        assert!(msg.contains("v1 or v2"), "{msg}");
    }
}

#[tokio::test]
async fn resolver_http_failure_is_an_error() {
    let r = SignBytesResolver::new();
    // Transport failure (closed port).
    let err = r
        .resolve(
            SignBytesMode::Auto,
            "qorechain-vladi",
            Some("http://127.0.0.1:1"),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::SignBytes(_)), "{err:?}");
    assert!(err.to_string().contains("v1 or v2"), "{err}");

    // Non-2xx status.
    let node = MockNode::start("{}", &["{}"]).await;
    node.set_plan(500, r#"{"message":"boom"}"#);
    let err = r
        .resolve(SignBytesMode::Auto, "qorechain-diana", Some(&node.base_url))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::SignBytes(_)), "{err:?}");

    // Unparsable height.
    node.set_plan(200, r#"{"height":"soon"}"#);
    assert!(r
        .resolve(SignBytesMode::Auto, "qorechain-diana", Some(&node.base_url))
        .await
        .is_err());
}

#[tokio::test]
async fn resolver_caches_within_ttl_and_force_refresh_bypasses() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let url = Some(node.base_url.as_str());

    assert_eq!(
        r.resolve(SignBytesMode::Auto, "qorechain-diana", url)
            .await
            .unwrap(),
        SignBytesVersion::V1
    );
    // The node upgrades; within the TTL the cached answer is served.
    node.set_plan(200, r#"{"height":"5746000"}"#);
    assert_eq!(
        r.resolve(SignBytesMode::Auto, "qorechain-diana", url)
            .await
            .unwrap(),
        SignBytesVersion::V1
    );
    // Not applied under EITHER name, so the first lookup asked both.
    assert_eq!(
        node.plan_hits(),
        vec![PLAN_PATH_PRIMARY.to_string(), PLAN_PATH_LEGACY.to_string()],
        "second call is a cache hit"
    );

    // A trailing slash is the same cache entry.
    let slash = format!("{}/", node.base_url);
    assert_eq!(
        r.resolve(SignBytesMode::Auto, "qorechain-diana", Some(&slash))
            .await
            .unwrap(),
        SignBytesVersion::V1
    );
    assert_eq!(node.plan_hits().len(), 2);

    // Force refresh re-asks and updates the cache; the first name now answers a
    // height, so it short-circuits after ONE request.
    assert_eq!(
        r.force_refresh("qorechain-diana", url).await.unwrap(),
        SignBytesVersion::V2
    );
    assert_eq!(node.plan_hits().len(), 3);
    assert_eq!(
        r.resolve(SignBytesMode::Auto, "qorechain-diana", url)
            .await
            .unwrap(),
        SignBytesVersion::V2
    );
    assert_eq!(node.plan_hits().len(), 3);

    // Clearing the cache forces a new query.
    r.clear_cache();
    r.resolve(SignBytesMode::Auto, "qorechain-diana", url)
        .await
        .unwrap();
    assert_eq!(node.plan_hits().len(), 4);
}

#[tokio::test]
async fn resolver_expired_ttl_requeries() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    let r = SignBytesResolver::new().with_ttl(Duration::from_millis(20));
    let url = Some(node.base_url.as_str());
    r.resolve(SignBytesMode::Auto, "qorechain-vladi", url)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    node.set_plan(200, r#"{"height":"9"}"#);
    assert_eq!(
        r.resolve(SignBytesMode::Auto, "qorechain-vladi", url)
            .await
            .unwrap(),
        SignBytesVersion::V2
    );
    // Two requests for the first (unapplied) lookup, one for the re-query.
    assert_eq!(node.plan_hits().len(), 3);
}

// ---------------------------------------------------------------------------
// Rejection detection + retry
// ---------------------------------------------------------------------------

const REFUSED_PQC_21: &str = r#"{"tx_response":{"code":21,"codespace":"pqc","raw_log":"hybrid PQC signature verification failed","txhash":"A"}}"#;
const REFUSED_SDK_21: &str =
    r#"{"tx_response":{"code":21,"codespace":"sdk","raw_log":"tx too large","txhash":"B"}}"#;
const ACCEPTED: &str = r#"{"tx_response":{"code":0,"txhash":"OK"}}"#;

#[test]
fn rejection_detector() {
    assert!(is_hybrid_sign_bytes_rejection("pqc", 21, ""));
    assert!(!is_hybrid_sign_bytes_rejection("sdk", 21, "tx too large"));
    assert!(!is_hybrid_sign_bytes_rejection("bank", 21, ""));
    assert!(!is_hybrid_sign_bytes_rejection("pqc", 20, ""));
    assert!(is_hybrid_sign_bytes_rejection(
        "",
        4,
        "unauthorized: hybrid PQC signature verification failed"
    ));

    assert!(is_hybrid_sign_bytes_rejection_response(
        &serde_json::from_str(REFUSED_PQC_21).unwrap()
    ));
    assert!(!is_hybrid_sign_bytes_rejection_response(
        &serde_json::from_str(REFUSED_SDK_21).unwrap()
    ));
    assert!(!is_hybrid_sign_bytes_rejection_response(
        &serde_json::from_str(ACCEPTED).unwrap()
    ));
    assert!(is_hybrid_sign_bytes_rejection_response(
        &json!({"code": 2, "message": "hybrid PQC signature verification failed: x"})
    ));

    let tx_err = Error::Tx(QoreTxError {
        code: 21,
        codespace: "pqc".into(),
        reason: String::new(),
        raw_log: String::new(),
        tx_hash: String::new(),
    });
    assert!(is_hybrid_sign_bytes_rejection_error(&tx_err));
    let other = Error::Tx(QoreTxError {
        code: 21,
        codespace: "sdk".into(),
        reason: "tx too large".into(),
        raw_log: String::new(),
        tx_hash: String::new(),
    });
    assert!(!is_hybrid_sign_bytes_rejection_error(&other));
    assert!(is_hybrid_sign_bytes_rejection_error(&Error::Http {
        status: 400,
        url: "u".into(),
        body: REFUSED_PQC_21.into(),
    }));
    assert!(!is_hybrid_sign_bytes_rejection_error(&Error::Transport(
        "x".into()
    )));
}

/// A fake transport: records which version each attempt was built with and
/// answers from a queue.
struct FakeTransport {
    built: Mutex<Vec<SignBytesVersion>>,
    answers: Mutex<Vec<&'static str>>,
}

impl FakeTransport {
    fn new(answers: &[&'static str]) -> Self {
        Self {
            built: Mutex::new(Vec::new()),
            answers: Mutex::new(answers.to_vec()),
        }
    }

    fn build(&self, v: SignBytesVersion) -> qorechain::Result<Vec<u8>> {
        self.built.lock().unwrap().push(v);
        Ok(vec![v.number()])
    }

    async fn send(&self, _tx: Vec<u8>) -> qorechain::Result<Value> {
        let next = self.answers.lock().unwrap().remove(0);
        Ok(serde_json::from_str(next).unwrap())
    }

    fn built(&self) -> Vec<SignBytesVersion> {
        self.built.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn auto_retries_once_after_pqc_21_with_re_resolved_version() {
    // Cached answer says v1; the network has since upgraded.
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let url = Some(node.base_url.as_str());
    r.resolve(SignBytesMode::Auto, "qorechain-diana", url)
        .await
        .unwrap();
    node.set_plan(200, r#"{"height":"5746000"}"#);

    let t = FakeTransport::new(&[REFUSED_PQC_21, ACCEPTED]);
    let out = broadcast_with_sign_bytes_retry(
        &r,
        SignBytesMode::Auto,
        "qorechain-diana",
        url,
        |v| t.build(v),
        |tx| t.send(tx),
    )
    .await
    .unwrap();

    assert!(out.retried);
    assert_eq!(out.sign_bytes_version, SignBytesVersion::V2);
    assert_eq!(out.response["tx_response"]["txhash"], "OK");
    assert_eq!(t.built(), vec![SignBytesVersion::V1, SignBytesVersion::V2]);
    // First lookup asked both names (neither applied); the refresh short-circuits.
    assert_eq!(node.plan_hits().len(), 3, "re-resolved once");
}

#[tokio::test]
async fn auto_retries_only_once_and_surfaces_second_refusal() {
    let node = MockNode::start(r#"{"height":"0"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let t = FakeTransport::new(&[REFUSED_PQC_21, REFUSED_PQC_21]);
    let out = broadcast_with_sign_bytes_retry(
        &r,
        SignBytesMode::Auto,
        "qorechain-vladi",
        Some(&node.base_url),
        |v| t.build(v),
        |tx| t.send(tx),
    )
    .await
    .unwrap();
    assert!(out.retried);
    assert_eq!(out.response["tx_response"]["code"], 21);
    assert_eq!(t.built().len(), 2, "exactly one retry");
}

#[tokio::test]
async fn explicit_version_is_never_retried() {
    let r = SignBytesResolver::new();
    let t = FakeTransport::new(&[REFUSED_PQC_21, ACCEPTED]);
    let out = broadcast_with_sign_bytes_retry(
        &r,
        SignBytesMode::V1,
        "qorechain-vladi",
        None,
        |v| t.build(v),
        |tx| t.send(tx),
    )
    .await
    .unwrap();
    assert!(!out.retried);
    assert_eq!(out.sign_bytes_version, SignBytesVersion::V1);
    assert_eq!(out.response["tx_response"]["code"], 21);
    assert_eq!(t.built(), vec![SignBytesVersion::V1]);
}

#[tokio::test]
async fn code_21_from_another_codespace_is_not_retried() {
    let node = MockNode::start(r#"{"height":"5746000"}"#, &["{}"]).await;
    let r = SignBytesResolver::new();
    let t = FakeTransport::new(&[REFUSED_SDK_21, ACCEPTED]);
    let out = broadcast_with_sign_bytes_retry(
        &r,
        SignBytesMode::Auto,
        "qorechain-diana",
        Some(&node.base_url),
        |v| t.build(v),
        |tx| t.send(tx),
    )
    .await
    .unwrap();
    assert!(!out.retried);
    assert_eq!(t.built(), vec![SignBytesVersion::V2]);
    assert_eq!(out.response["tx_response"]["codespace"], "sdk");
}

#[tokio::test]
async fn pqc_dx_send_hybrid_retries_against_mock_node() {
    // End-to-end through the high-level path and the real broadcast: the node
    // reports no upgrade (v1), refuses the v1 tx with pqc/21, then reports the
    // upgrade; the retry is signed v2 and accepted.
    let node = MockNode::start(r#"{"height":"0"}"#, &[REFUSED_PQC_21, ACCEPTED]).await;
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = generate_pqc_keypair().unwrap();
    let dx = PqcDx {
        sender: acc.address.clone(),
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        chain_id: "qorechain-diana".into(),
        account_number: 1,
        sequence: 0,
        fee: sample_fee(),
        key_type: String::new(),
        rest_url: node.base_url.clone(),
        mode: BroadcastMode::Sync,
        qor: None,
        sign_bytes: SignBytesMode::Auto,
    };

    // The sync builder cannot resolve a legacy chain offline.
    let err = dx.build_hybrid(vec![send_msg(&acc.address)]).unwrap_err();
    assert!(matches!(err, Error::SignBytes(_)), "{err:?}");

    // Flip the plan after the first resolution by answering v1 first.
    let first = dx.resolve_sign_bytes_version().await.unwrap();
    assert_eq!(first, SignBytesVersion::V1);
    node.set_plan(200, r#"{"height":"5746000"}"#);

    let out = dx
        .send_hybrid_detailed(vec![send_msg(&acc.address)])
        .await
        .unwrap();
    assert!(out.retried);
    assert_eq!(out.sign_bytes_version, SignBytesVersion::V2);
    assert_eq!(out.response["tx_response"]["txhash"], "OK");

    // Two broadcasts: the first signed v1, the second v2.
    let posted = node.hits_on(BROADCAST_PATH);
    assert_eq!(posted.len(), 2);
    let versions: Vec<SignBytesVersion> = posted
        .iter()
        .map(|b| {
            let v: Value = serde_json::from_str(b).unwrap();
            let bytes = base64_decode(v["tx_bytes"].as_str().unwrap());
            pqc_version_of(&bytes, &kp.public_key, "qorechain-diana")
        })
        .collect();
    assert_eq!(versions, vec![SignBytesVersion::V1, SignBytesVersion::V2]);
}

// ---------------------------------------------------------------------------
// Hybrid tx built with v2
// ---------------------------------------------------------------------------

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

fn send_msg(from: &str) -> TxMessage {
    let msg = MsgSend {
        from_address: from.into(),
        to_address: "qor1recipient00000000000000000000000000000".into(),
        amount: vec![cosmrs::proto::cosmos::base::v1beta1::Coin {
            denom: "uqor".into(),
            amount: "1".into(),
        }],
    };
    TxMessage {
        type_url: "/cosmos.bank.v1beta1.MsgSend".into(),
        value: msg.encode_to_vec(),
    }
}

fn base64_decode(s: &str) -> Vec<u8> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    BASE64.decode(s).unwrap()
}

/// Strips the PQC extension from a broadcast `TxRaw` and reports which sign-bytes
/// form its ML-DSA signature verifies over.
fn pqc_version_of(tx_raw_bytes: &[u8], pqc_pub: &[u8], chain_id: &str) -> SignBytesVersion {
    let tx_raw = TxRaw::decode(tx_raw_bytes).unwrap();
    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    let ext = qorechain::proto::qorechain::pqc::v1::PqcHybridSignature::decode(
        body.extension_options[0].value.as_slice(),
    )
    .unwrap();
    let mut stripped = body.clone();
    stripped.extension_options.clear();
    let b0 = stripped.encode_to_vec();
    let v1 = hybrid_sign_bytes_v1(&b0, &tx_raw.auth_info_bytes);
    let v2 = hybrid_sign_bytes_v2(chain_id, &b0, &tx_raw.auth_info_bytes);
    match (
        pqc_verify(pqc_pub, &v1, &ext.pqc_signature),
        pqc_verify(pqc_pub, &v2, &ext.pqc_signature),
    ) {
        (true, false) => SignBytesVersion::V1,
        (false, true) => SignBytesVersion::V2,
        other => panic!("signature must verify over exactly one form, got {other:?}"),
    }
}

fn hybrid_params(chain_id: &str, version: Option<SignBytesVersion>) -> BuildHybridTxParams {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = qorechain::pqc::pqc_keypair_from_seed(&[0x42; 32]);
    BuildHybridTxParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        messages: vec![send_msg(&acc.address)],
        fee: sample_fee(),
        chain_id: chain_id.into(),
        account_number: 3,
        sequence: 1,
        memo: "v2".into(),
        timeout_height: 0,
        include_pqc_public_key: false,
        sign_bytes_version: version,
    }
}

#[test]
fn hybrid_tx_v2_signature_verifies_over_v2_not_v1() {
    let kp = qorechain::pqc::pqc_keypair_from_seed(&[0x42; 32]);
    let built =
        build_hybrid_tx(hybrid_params("qorechain-diana", Some(SignBytesVersion::V2))).unwrap();
    assert_eq!(built.sign_bytes_version, Some(SignBytesVersion::V2));
    assert!(built
        .pqc_signed_message
        .starts_with(HYBRID_SIGN_BYTES_DOMAIN.as_bytes()));

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    let mut stripped = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    stripped.extension_options.clear();
    let b0 = stripped.encode_to_vec();
    let v2 = hybrid_sign_bytes_v2("qorechain-diana", &b0, &tx_raw.auth_info_bytes);
    let v1 = hybrid_sign_bytes_v1(&b0, &tx_raw.auth_info_bytes);
    assert_eq!(built.pqc_signed_message, v2);
    assert!(pqc_verify(&kp.public_key, &v2, &built.pqc_signature));
    assert!(!pqc_verify(&kp.public_key, &v1, &built.pqc_signature));
    // Nor over the v2 bytes of another network.
    let other = hybrid_sign_bytes_v2("qorechain-vladi", &b0, &tx_raw.auth_info_bytes);
    assert!(!pqc_verify(&kp.public_key, &other, &built.pqc_signature));
    assert_eq!(
        pqc_version_of(&built.tx_raw_bytes, &kp.public_key, "qorechain-diana"),
        SignBytesVersion::V2
    );
}

#[test]
fn hybrid_tx_v1_signature_verifies_over_v1_not_v2() {
    let kp = qorechain::pqc::pqc_keypair_from_seed(&[0x42; 32]);
    let built =
        build_hybrid_tx(hybrid_params("qorechain-vladi", Some(SignBytesVersion::V1))).unwrap();
    assert_eq!(built.sign_bytes_version, Some(SignBytesVersion::V1));
    assert_eq!(
        pqc_version_of(&built.tx_raw_bytes, &kp.public_key, "qorechain-vladi"),
        SignBytesVersion::V1
    );
}

#[test]
fn hybrid_tx_without_version_fails_on_legacy_and_is_v2_elsewhere() {
    for chain in ["qorechain-vladi", "qorechain-diana"] {
        let err = build_hybrid_tx(hybrid_params(chain, None)).unwrap_err();
        assert!(matches!(err, Error::SignBytes(_)), "{chain}: {err:?}");
    }
    let built = build_hybrid_tx(hybrid_params("qorechain-next", None)).unwrap();
    assert_eq!(built.sign_bytes_version, Some(SignBytesVersion::V2));
}

#[test]
fn eth_hybrid_v2_signature_verifies_over_v2_not_v1() {
    let acct = unified_account_from_seed([0x07u8; 32]).unwrap();
    let params = |version| EthSignParams {
        private_key: acct.private_key,
        public_key: acct.public_key.clone(),
        messages: vec![cosmrs::Any {
            type_url: "/cosmos.bank.v1beta1.MsgSend".to_string(),
            value: vec![1, 2, 3],
        }],
        chain_id: "qorechain-diana".to_string(),
        account_number: 7,
        sequence: 3,
        fee: sample_fee(),
        memo: String::new(),
        timeout_height: 0,
        sign_bytes_version: version,
    };
    let built = sign_hybrid_eth(params(Some(SignBytesVersion::V2)), &acct.pqc, false).unwrap();
    assert_eq!(built.sign_bytes_version, Some(SignBytesVersion::V2));
    assert_eq!(
        pqc_version_of(&built.tx_raw_bytes, &acct.pqc.public_key, "qorechain-diana"),
        SignBytesVersion::V2
    );
    let err = sign_hybrid_eth(params(None), &acct.pqc, false).unwrap_err();
    assert!(matches!(err, Error::SignBytes(_)), "{err:?}");
}
