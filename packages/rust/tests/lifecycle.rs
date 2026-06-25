//! Tx lifecycle tests (auto-gas, tracking, search) against a tiny local mock
//! HTTP server that routes by path. No real node or network access.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use qorechain::tx::{
    estimate_fee, get_block, get_latest_block, get_tx, search_txs, wait_for_tx, WaitOptions,
};

/// A path-routed mock server. `routes` maps an exact path to a
/// `(status, body)` response; `default` is used for unmatched paths.
struct MockServer {
    base_url: String,
    hits: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

type Routes = Arc<Mutex<Vec<(String, u16, String)>>>;

impl MockServer {
    async fn start(routes: Vec<(&str, u16, &str)>) -> Self {
        let routes: Routes = Arc::new(Mutex::new(
            routes
                .into_iter()
                .map(|(p, s, b)| (p.to_string(), s, b.to_string()))
                .collect(),
        ));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let hits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();

        let routes_c = routes.clone();
        let hits_c = hits.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let routes = routes_c.clone();
                        let hits = hits_c.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let routes = routes.clone();
                                let hits = hits.clone();
                                async move {
                                    let path = req.uri().path().to_string();
                                    hits.lock().unwrap().push(path.clone());
                                    let _ = req.into_body().collect().await;
                                    let (status, body) = {
                                        let guard = routes.lock().unwrap();
                                        guard
                                            .iter()
                                            .find(|(p, _, _)| *p == path)
                                            .map(|(_, s, b)| (*s, b.clone()))
                                            .unwrap_or((404, "{\"message\":\"not found\"}".into()))
                                    };
                                    let resp = Response::builder()
                                        .status(StatusCode::from_u16(status).unwrap())
                                        .body(Full::new(Bytes::from(body)))
                                        .unwrap();
                                    Ok::<_, Infallible>(resp)
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
            hits,
            _shutdown: tx,
        }
    }

    fn hit_count(&self, path: &str) -> usize {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .filter(|p| *p == path)
            .count()
    }
}

#[tokio::test]
async fn estimate_fee_from_simulated_gas() {
    let server = MockServer::start(vec![(
        "/cosmos/tx/v1beta1/simulate",
        200,
        r#"{"gas_info":{"gas_used":"100000"}}"#,
    )])
    .await;

    let fee = estimate_fee(&server.base_url, &[0x01], 1.4, "0.025uqor")
        .await
        .unwrap();
    assert_eq!(fee.gas, "140000");
    assert_eq!(fee.amount[0].amount, "3500");
    assert_eq!(fee.amount[0].denom, "uqor");
}

#[tokio::test]
async fn get_tx_and_block_paths() {
    let server = MockServer::start(vec![
        (
            "/cosmos/tx/v1beta1/txs/ABC",
            200,
            r#"{"tx_response":{"txhash":"ABC","height":"42","code":0,"gas_used":"1000","gas_wanted":"2000","raw_log":""}}"#,
        ),
        (
            "/cosmos/base/tendermint/v1beta1/blocks/7",
            200,
            r#"{"block":{"header":{"height":"7"}}}"#,
        ),
        (
            "/cosmos/base/tendermint/v1beta1/blocks/latest",
            200,
            r#"{"block":{"header":{"height":"99"}}}"#,
        ),
    ])
    .await;

    let tx = get_tx(&server.base_url, "ABC").await.unwrap();
    assert_eq!(tx.tx_hash, "ABC");
    assert_eq!(tx.height, 42);
    assert_eq!(tx.gas_used, 1000);

    let b = get_block(&server.base_url, 7).await.unwrap();
    assert_eq!(b["block"]["header"]["height"], "7");

    let latest = get_latest_block(&server.base_url).await.unwrap();
    assert_eq!(latest["block"]["header"]["height"], "99");
}

#[tokio::test]
async fn get_tx_not_found_errors() {
    let server = MockServer::start(vec![]).await; // everything 404
    let err = get_tx(&server.base_url, "MISSING").await;
    assert!(err.is_err());
}

#[tokio::test]
async fn search_txs_parses_page() {
    let server = MockServer::start(vec![(
        "/cosmos/tx/v1beta1/txs",
        200,
        r#"{"tx_responses":[{"txhash":"H1","height":"1","code":0},{"txhash":"H2","height":"2","code":0}],"total":"2"}"#,
    )])
    .await;

    let page = search_txs(&server.base_url, &["message.sender=qor1abc"], 1, 100)
        .await
        .unwrap();
    assert_eq!(page.txs.len(), 2);
    assert_eq!(page.txs[0].tx_hash, "H1");
    assert_eq!(page.txs[1].height, 2);
    assert_eq!(page.total, 2);
}

#[tokio::test]
async fn wait_for_tx_polls_then_succeeds() {
    // 404 until found: the mock returns the tx immediately, so one poll suffices.
    let server = MockServer::start(vec![(
        "/cosmos/tx/v1beta1/txs/FOUND",
        200,
        r#"{"tx_response":{"txhash":"FOUND","height":"5","code":0}}"#,
    )])
    .await;

    let res = wait_for_tx(
        &server.base_url,
        "FOUND",
        WaitOptions {
            timeout: Some(Duration::from_secs(5)),
            poll: Some(Duration::from_millis(20)),
        },
    )
    .await
    .unwrap();
    assert_eq!(res.tx_hash, "FOUND");
    assert_eq!(res.height, 5);
}

#[tokio::test]
async fn wait_for_tx_times_out_when_pending() {
    let server = MockServer::start(vec![]).await; // always 404 → pending
    let res = wait_for_tx(
        &server.base_url,
        "NEVER",
        WaitOptions {
            timeout: Some(Duration::from_millis(80)),
            poll: Some(Duration::from_millis(20)),
        },
    )
    .await;
    assert!(res.is_err());
    // Polled more than once before timing out.
    assert!(server.hit_count("/cosmos/tx/v1beta1/txs/NEVER") >= 2);
}

#[tokio::test]
async fn wait_for_tx_returns_typed_error_on_failed_code() {
    let server = MockServer::start(vec![(
        "/cosmos/tx/v1beta1/txs/FAILED",
        200,
        r#"{"tx_response":{"txhash":"FAILED","height":"5","code":5,"codespace":"sdk","raw_log":"insufficient funds"}}"#,
    )])
    .await;
    let err = wait_for_tx(
        &server.base_url,
        "FAILED",
        WaitOptions {
            timeout: Some(Duration::from_secs(2)),
            poll: Some(Duration::from_millis(20)),
        },
    )
    .await
    .unwrap_err();
    let s = err.to_string();
    assert!(s.contains("insufficient funds"), "got: {s}");
}
