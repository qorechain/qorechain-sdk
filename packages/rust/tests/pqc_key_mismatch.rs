//! `ensure_pqc_registered` compares the registered key with the caller's.
//!
//! A tiny hyper mock serves the REST status route
//! (`/qorechain/pqc/v1/account/{addr}`) from a scripted list of answers (one per
//! read; the last repeats), the applied-plan read (not applied) and the
//! broadcast POST. It counts requests per route. No real network access.
//!
//! Each test uses its own server (its own port), so cache entries never collide
//! and no test needs to clear the process-wide cache.

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

use qorechain::accounts::derive_native_account;
use qorechain::pqc::{pqc_keypair_from_seed, PqcKeypair};
use qorechain::pqc_dx::{
    fetch_pqc_status, is_registered_pqc_key, pqc_status_public_key, PqcDx, PqcKeyMismatchError,
};
use qorechain::signbytes::SignBytesMode;
use qorechain::tx::{BroadcastMode, Coin, Fee};
use qorechain::Error;

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const OK_BROADCAST: &str = r#"{"tx_response":{"code":0,"txhash":"SENT"}}"#;
const REFUSED_ALREADY: &str = r#"{"tx_response":{"code":7,"codespace":"pqc","raw_log":"PQC account already registered","txhash":"AB"}}"#;

fn mine() -> PqcKeypair {
    pqc_keypair_from_seed(&[2u8; 32])
}
fn other() -> PqcKeypair {
    pqc_keypair_from_seed(&[3u8; 32])
}

struct MockServer {
    base_url: String,
    paths: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockServer {
    /// `keys`: the registered key each status read answers (`None` = not
    /// registered); the last one repeats.
    async fn start(keys: Vec<Option<Vec<u8>>>, broadcast_body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let paths: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let reads = Arc::new(Mutex::new(0usize));
        let keys = Arc::new(keys);
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let rec = paths.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let (rec, reads, keys) = (rec.clone(), reads.clone(), keys.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (rec, reads, keys) = (rec.clone(), reads.clone(), keys.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let _ = req.into_body().collect().await;
                                    rec.lock().unwrap().push(path.clone());
                                    let resp = if path == "/cosmos/tx/v1beta1/txs" {
                                        broadcast_body.to_string()
                                    } else if path.starts_with("/qorechain/pqc/v1/account/") {
                                        let mut n = reads.lock().unwrap();
                                        let key = &keys[(*n).min(keys.len() - 1)];
                                        *n += 1;
                                        match key {
                                            Some(k) => format!(
                                                r#"{{"found":true,"account":{{"public_key":"{}","algorithm_id":1}}}}"#,
                                                BASE64.encode(k)
                                            ),
                                            None => r#"{"found":false,"account":null}"#.to_string(),
                                        }
                                    } else {
                                        // Applied-plan reads: not applied.
                                        r#"{"height":"0"}"#.to_string()
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

        MockServer {
            base_url,
            paths,
            _shutdown: tx,
        }
    }

    fn count(&self, pred: impl Fn(&str) -> bool) -> usize {
        self.paths
            .lock()
            .unwrap()
            .iter()
            .filter(|p| pred(p))
            .count()
    }
    fn status_reads(&self) -> usize {
        self.count(|p| p.starts_with("/qorechain/pqc/v1/account/"))
    }
    fn broadcasts(&self) -> usize {
        self.count(|p| p == "/cosmos/tx/v1beta1/txs")
    }
}

fn make_dx(url: &str, kp: &PqcKeypair) -> PqcDx {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    PqcDx {
        sender: acc.address.clone(),
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        chain_id: "qorechain-diana".into(),
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

fn mismatch(err: Error) -> PqcKeyMismatchError {
    match err {
        Error::PqcKeyMismatch(e) => e,
        other => panic!("expected a key mismatch, got {other}"),
    }
}

#[tokio::test]
async fn mismatch_is_an_error_and_sends_nothing() {
    let (mine, other) = (mine(), other());
    let server = MockServer::start(vec![Some(other.public_key.clone())], OK_BROADCAST).await;
    let dx = make_dx(&server.base_url, &mine);

    let err = dx.ensure_pqc_registered().await.unwrap_err();
    let msg = err.to_string();
    let e = mismatch(err);
    assert_eq!(e.kind(), "pqc_key_mismatch");
    assert_eq!(e.address, dx.sender);
    assert_eq!(e.registered_public_key, other.public_key);
    assert_eq!(e.public_key, mine.public_key);
    assert!(msg.contains("different PQC key"), "{msg}");
    assert_eq!(server.broadcasts(), 0);
    // The mismatch is confirmed with a fresh (uncached) read before failing.
    assert_eq!(server.status_reads(), 2);
}

#[tokio::test]
async fn cached_old_key_is_re_read_before_failing() {
    // A cached answer from before a rotation must not raise a false alarm.
    let (mine, other) = (mine(), other());
    let server = MockServer::start(
        vec![
            Some(other.public_key.clone()),
            Some(mine.public_key.clone()),
        ],
        OK_BROADCAST,
    )
    .await;
    let dx = make_dx(&server.base_url, &mine);
    let cached = fetch_pqc_status(&server.base_url, &dx.sender)
        .await
        .unwrap();
    assert_eq!(
        pqc_status_public_key(&cached),
        Some(other.public_key.as_slice())
    );

    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(res.already_registered);
    assert_eq!(server.broadcasts(), 0);
    assert_eq!(server.status_reads(), 2);
}

#[tokio::test]
async fn own_key_registered_is_already_registered() {
    let mine = mine();
    let server = MockServer::start(vec![Some(mine.public_key.clone())], OK_BROADCAST).await;
    let dx = make_dx(&server.base_url, &mine);
    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(res.already_registered);
    assert_eq!(res.tx_hash, None);
    assert_eq!(server.broadcasts(), 0);
    assert_eq!(server.status_reads(), 1);
}

#[tokio::test]
async fn migrate_to_hybrid_refuses_a_keypair_the_chain_does_not_hold() {
    let (mine, other) = (mine(), other());
    let server = MockServer::start(vec![Some(other.public_key.clone())], OK_BROADCAST).await;
    let dx = make_dx(&server.base_url, &mine);
    mismatch(dx.migrate_to_hybrid().await.unwrap_err());
    assert_eq!(server.broadcasts(), 0);
}

#[tokio::test]
async fn race_refusal_with_another_key_is_a_mismatch() {
    // First read: not registered. Someone registers OTHER before our tx lands.
    let (mine, other) = (mine(), other());
    let server =
        MockServer::start(vec![None, Some(other.public_key.clone())], REFUSED_ALREADY).await;
    let dx = make_dx(&server.base_url, &mine);
    let e = mismatch(dx.ensure_pqc_registered().await.unwrap_err());
    assert_eq!(e.registered_public_key, other.public_key);
    assert_eq!(server.broadcasts(), 1);
    assert_eq!(server.status_reads(), 2);
}

#[tokio::test]
async fn race_refusal_with_own_key_is_already_registered() {
    let mine = mine();
    let server =
        MockServer::start(vec![None, Some(mine.public_key.clone())], REFUSED_ALREADY).await;
    let dx = make_dx(&server.base_url, &mine);
    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(res.already_registered);
    assert_eq!(res.tx_hash, None);
}

#[tokio::test]
async fn positive_cache_keeps_the_key() {
    let (mine, other) = (mine(), other());
    let server = MockServer::start(vec![Some(mine.public_key.clone())], OK_BROADCAST).await;
    let addr = derive_native_account(TEST_MNEMONIC, 0).unwrap().address;
    let first = fetch_pqc_status(&server.base_url, &addr).await.unwrap();
    let again = fetch_pqc_status(&format!("{}/", server.base_url), &addr)
        .await
        .unwrap();
    assert_eq!(server.status_reads(), 1);
    assert_eq!(again, first);
    assert_eq!(again.algorithm_id, Some(1));
    assert_eq!(
        pqc_status_public_key(&again),
        Some(mine.public_key.as_slice())
    );
    assert_eq!(is_registered_pqc_key(&again, &mine.public_key), Some(true));
    assert_eq!(
        is_registered_pqc_key(&again, &other.public_key),
        Some(false)
    );
}

// Any other CheckTx refusal of the registration is an error, never a
// registration.

const REFUSED_FEE: &str = r#"{"tx_response":{"code":13,"codespace":"sdk","raw_log":"insufficient fee","txhash":"FEE13"}}"#;

#[tokio::test]
async fn check_tx_refusal_is_a_tx_error() {
    let mine = mine();
    let server = MockServer::start(vec![None], REFUSED_FEE).await;
    let dx = make_dx(&server.base_url, &mine);
    match dx.ensure_pqc_registered().await.unwrap_err() {
        Error::Tx(e) => {
            assert_eq!(e.code, 13);
            assert_eq!(e.codespace, "sdk");
            assert_eq!(e.raw_log, "insufficient fee");
            assert_eq!(e.tx_hash, "FEE13");
        }
        other => panic!("expected a tx error, got {other}"),
    }
    assert_eq!(server.broadcasts(), 1);
    // migrate_to_hybrid stops there too.
    assert!(matches!(dx.migrate_to_hybrid().await, Err(Error::Tx(_))));
}

#[tokio::test]
async fn check_tx_code_zero_returns_the_hash() {
    let mine = mine();
    let server = MockServer::start(vec![None], OK_BROADCAST).await;
    let dx = make_dx(&server.base_url, &mine);
    let res = dx.ensure_pqc_registered().await.unwrap();
    assert!(!res.already_registered);
    assert_eq!(res.tx_hash.as_deref(), Some("SENT"));
}
