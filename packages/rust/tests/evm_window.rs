//! Tests for the v3.2.0 EVM authorisation window client surface.
//!
//! Covers the composer round-trip (type URL + encoded bytes), the client-side
//! bounds that mirror the chain's `ValidateBasic`, parsing of both shapes the
//! `evm_window` query returns (with exact integers well above 2^53), and the
//! refusal classifier over codes, the chain's own texts, and an unrelated error.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use prost::Message as _;
use serde_json::json;
use tokio::net::TcpListener;

use qorechain::evm_window::{
    classify_evm_window_error, classify_tx_error, evm_window_path, get_evm_window,
    parse_evm_window, validate_evm_window_params, EvmWindowRefusal, EvmWindowStatus,
    ERR_EVM_WINDOW_EXHAUSTED, ERR_INVALID_EVM_WINDOW, ERR_NO_EVM_WINDOW, EVM_WINDOW_QUERY_PATH,
    MAX_EVM_WINDOW_BLOCKS, MAX_EVM_WINDOW_TXS,
};
use qorechain::msg;
use qorechain::proto::qorechain::pqc::v1 as pb;
use qorechain::query::RestClient;
use qorechain::tx::{decode_tx_error, QoreTxError};

const ADDR: &str = "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

/// The live shape, verified on the testnet after the v3.2.0 upgrade. Every
/// number is a JSON string.
const LIVE_BODY: &str = r#"{"found":true,"live":true,"opened_height":"6069608",
 "expiry_height":"6069908","max_txs":"5","used_txs":"1","max_value":"2000000",
 "used_value":"3363","remaining_blocks":"286","remaining_txs":"4",
 "remaining_value":"1996637"}"#;

/// The chain's own refusal texts, as they arrive over EVM JSON-RPC (a broadcast
/// error carrying the message, with no codespace attached).
const NO_WINDOW_TEXT: &str = "account qor1abc has no open EVM authorisation window; open one \
     with MsgOpenEVMWindow, signed on the Cosmos lane with the account's post-quantum key";
const NO_PQC_KEY_TEXT: &str = "account qor1abc has no registered post-quantum key";

// --------------------------------------------------------------------------- //
// Composers
// --------------------------------------------------------------------------- //

#[test]
fn open_evm_window_round_trips_type_url_and_bytes() {
    let m = msg::pqc::open_evm_window(ADDR, 300, 5, "2000000").unwrap();
    assert_eq!(m.sender, ADDR);
    assert_eq!(m.blocks, 300);
    assert_eq!(m.max_txs, 5);
    assert_eq!(m.max_value, "2000000");

    let any = msg::pqc::open_evm_window_any(ADDR, 300, 5, "2000000").unwrap();
    assert_eq!(any.type_url, "/qorechain.pqc.v1.MsgOpenEVMWindow");
    assert_eq!(any.type_url, msg::pqc::OPEN_EVM_WINDOW);
    assert_eq!(any.value, m.encode_to_vec());

    // Decoding the Any's bytes back gives the same message.
    let decoded: pb::MsgOpenEvmWindow = msg::from_any(&any).unwrap();
    assert_eq!(decoded, m);
}

#[test]
fn close_evm_window_round_trips_type_url_and_bytes() {
    let m = msg::pqc::close_evm_window(ADDR);
    let any = msg::pqc::close_evm_window_any(ADDR);
    assert_eq!(any.type_url, "/qorechain.pqc.v1.MsgCloseEVMWindow");
    assert_eq!(any.type_url, msg::pqc::CLOSE_EVM_WINDOW);
    assert_eq!(any.value, m.encode_to_vec());
    let decoded: pb::MsgCloseEvmWindow = msg::from_any(&any).unwrap();
    assert_eq!(decoded.sender, ADDR);
}

// --------------------------------------------------------------------------- //
// Validation bounds (mirror of the chain's ValidateBasic)
// --------------------------------------------------------------------------- //

#[test]
fn blocks_outside_the_bound_is_refused_naming_the_bound() {
    for blocks in [0u64, MAX_EVM_WINDOW_BLOCKS + 1] {
        let err = msg::pqc::open_evm_window(ADDR, blocks, 1, "1").unwrap_err();
        let text = err.to_string();
        assert!(text.contains("blocks"), "{text}");
        assert!(text.contains("17280"), "{text}");
    }
}

#[test]
fn blocks_at_the_bound_is_accepted() {
    for blocks in [1u64, MAX_EVM_WINDOW_BLOCKS] {
        let m = msg::pqc::open_evm_window(ADDR, blocks, 1, "1").unwrap();
        assert_eq!(m.blocks, blocks);
    }
}

#[test]
fn max_txs_outside_the_bound_is_refused_naming_the_bound() {
    for max_txs in [0u64, MAX_EVM_WINDOW_TXS + 1] {
        let err = msg::pqc::open_evm_window(ADDR, 10, max_txs, "1").unwrap_err();
        let text = err.to_string();
        assert!(text.contains("max_txs"), "{text}");
        assert!(text.contains("1000"), "{text}");
    }
}

#[test]
fn max_txs_at_the_bound_is_accepted() {
    for max_txs in [1u64, MAX_EVM_WINDOW_TXS] {
        let m = msg::pqc::open_evm_window(ADDR, 10, max_txs, "1").unwrap();
        assert_eq!(m.max_txs, max_txs);
    }
}

#[test]
fn non_positive_max_value_is_refused_naming_the_bound() {
    for max_value in ["0", "-1"] {
        let err = msg::pqc::open_evm_window(ADDR, 10, 1, max_value).unwrap_err();
        let text = err.to_string();
        assert!(text.contains("max_value"), "{text}");
        assert!(text.contains("greater than 0"), "{text}");
    }
}

#[test]
fn non_integer_max_value_is_refused() {
    for max_value in ["1.5", "abc", "", "1e6"] {
        let err = msg::pqc::open_evm_window(ADDR, 10, 1, max_value).unwrap_err();
        assert!(err.to_string().contains("max_value"), "{err}");
    }
}

#[test]
fn validate_params_returns_the_normalized_bounds() {
    let params = validate_evm_window_params(300, 5, " 2000000 ").unwrap();
    assert_eq!(params.blocks, 300);
    assert_eq!(params.max_txs, 5);
    assert_eq!(params.max_value, "2000000");
}

// --------------------------------------------------------------------------- //
// Query parsing
// --------------------------------------------------------------------------- //

#[test]
fn parses_an_absent_window() {
    let status = parse_evm_window(&json!({"found": false})).unwrap();
    assert_eq!(status, EvmWindowStatus::default());
    assert!(!status.found);
    assert!(!status.live);
}

#[test]
fn parses_the_live_window() {
    let body: serde_json::Value = serde_json::from_str(LIVE_BODY).unwrap();
    let status = parse_evm_window(&body).unwrap();
    assert!(status.found);
    assert!(status.live);
    assert_eq!(status.opened_height, 6_069_608);
    assert_eq!(status.expiry_height, 6_069_908);
    assert_eq!(status.max_txs, 5);
    assert_eq!(status.used_txs, 1);
    assert_eq!(status.max_value, 2_000_000);
    // The measured cost of a 1,000 uqor transfer with 21,000 gas at 112.5 gwei:
    // max_value bounds value PLUS the maximum fee, and wei -> uqor rounds up.
    assert_eq!(status.used_value, 3_363);
    assert_eq!(status.remaining_blocks, 286);
    assert_eq!(status.remaining_txs, 4);
    assert_eq!(status.remaining_value, 1_996_637);
}

#[test]
fn keeps_cosmos_int_exact_above_2_to_the_53() {
    // A float would round this to ...992000000; a u128 keeps every digit.
    let huge = "9007199254740993000000";
    let body = json!({
        "found": true,
        "live": true,
        "max_value": huge,
        "remaining_value": huge,
    });
    let status = parse_evm_window(&body).unwrap();
    assert_eq!(status.max_value, 9_007_199_254_740_993_000_000u128);
    assert_eq!(status.max_value.to_string(), huge);
    assert_eq!(status.remaining_value.to_string(), huge);
}

#[test]
fn refuses_a_float_field() {
    let body = json!({"found": true, "max_value": 2_000_000.5});
    let err = parse_evm_window(&body).unwrap_err();
    assert!(err.to_string().contains("max_value"), "{err}");
}

#[test]
fn path_and_grpc_route_are_the_documented_ones() {
    assert_eq!(
        evm_window_path("qor1abc"),
        "/qorechain/pqc/v1/evm_window/qor1abc"
    );
    assert_eq!(EVM_WINDOW_QUERY_PATH, "/qorechain.pqc.v1.Query/EVMWindow");
}

// --------------------------------------------------------------------------- //
// Query over a mock REST server
// --------------------------------------------------------------------------- //

/// A minimal mock LCD that records the requested path and answers one body.
struct MockLcd {
    base_url: String,
    paths: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockLcd {
    async fn start(body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let paths: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        let recorded = paths.clone();
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
                        let recorded = recorded.clone();
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let recorded = recorded.clone();
                                let path = req.uri().path().to_string();
                                async move {
                                    let _ = req.into_body().collect().await;
                                    recorded.lock().unwrap().push(path);
                                    Ok::<_, Infallible>(
                                        Response::builder()
                                            .header("content-type", "application/json")
                                            .body(Full::new(Bytes::from(body)))
                                            .unwrap(),
                                    )
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
        Self {
            base_url,
            paths,
            _shutdown: tx,
        }
    }

    fn last_path(&self) -> String {
        self.paths.lock().unwrap().last().cloned().unwrap()
    }
}

#[tokio::test]
async fn get_evm_window_reads_the_documented_route() {
    let server = MockLcd::start(
        r#"{"found":true,"live":true,"opened_height":"6069608","expiry_height":"6069908",
            "max_txs":"5","used_txs":"1","max_value":"2000000","used_value":"3363",
            "remaining_blocks":"286","remaining_txs":"4","remaining_value":"1996637"}"#,
    )
    .await;
    let rest = RestClient::new(server.base_url.clone());
    let status = get_evm_window(&rest, "qor1abc").await.unwrap();
    assert_eq!(server.last_path(), "/qorechain/pqc/v1/evm_window/qor1abc");
    assert_eq!(status.remaining_value, 1_996_637);
}

#[tokio::test]
async fn get_evm_window_absent_is_a_200() {
    let server = MockLcd::start(r#"{"found":false}"#).await;
    let rest = RestClient::new(server.base_url.clone());
    let status = get_evm_window(&rest, "qor1abc").await.unwrap();
    assert!(!status.found);
    assert!(!status.live);
    assert_eq!(status.remaining_txs, 0);
}

// --------------------------------------------------------------------------- //
// Refusal classifier
// --------------------------------------------------------------------------- //

#[test]
fn classifies_the_pqc_codes() {
    assert_eq!(
        classify_evm_window_error(Some(ERR_NO_EVM_WINDOW), "pqc", ""),
        Some(EvmWindowRefusal::NoWindow)
    );
    assert_eq!(
        classify_evm_window_error(Some(ERR_EVM_WINDOW_EXHAUSTED), "pqc", ""),
        Some(EvmWindowRefusal::WindowExhausted)
    );
    assert_eq!(
        classify_evm_window_error(Some(ERR_INVALID_EVM_WINDOW), "pqc", ""),
        Some(EvmWindowRefusal::InvalidWindow)
    );
}

#[test]
fn classifies_the_chain_texts_without_a_codespace() {
    assert_eq!(
        classify_evm_window_error(None, "", NO_WINDOW_TEXT),
        Some(EvmWindowRefusal::NoWindow)
    );
    assert_eq!(
        classify_evm_window_error(None, "", NO_PQC_KEY_TEXT),
        Some(EvmWindowRefusal::NoPqcKey)
    );
    assert_eq!(
        classify_evm_window_error(None, "", "EVM authorisation window is exhausted"),
        Some(EvmWindowRefusal::WindowExhausted)
    );
    assert_eq!(
        classify_evm_window_error(None, "", "invalid EVM authorization window"),
        Some(EvmWindowRefusal::InvalidWindow)
    );
}

#[test]
fn no_pqc_key_is_its_own_state_under_code_28() {
    // Code 28 covers two states; the text decides, and the remedies differ.
    assert_eq!(
        classify_evm_window_error(Some(ERR_INVALID_EVM_WINDOW), "pqc", NO_PQC_KEY_TEXT),
        Some(EvmWindowRefusal::NoPqcKey)
    );
    assert!(EvmWindowRefusal::NoPqcKey
        .remedy()
        .contains("register a post-quantum key"));
    assert!(EvmWindowRefusal::NoWindow
        .remedy()
        .contains("open an EVM authorisation window"));
    // The ordering trap is part of the remedy a wallet shows.
    assert!(EvmWindowRefusal::NoWindow.remedy().contains("read the"));
    assert_eq!(EvmWindowRefusal::NoPqcKey.as_str(), "no_pqc_key");
    assert_eq!(EvmWindowRefusal::NoWindow.to_string(), "no_window");
}

#[test]
fn unrelated_errors_do_not_match() {
    assert_eq!(
        classify_evm_window_error(Some(5), "sdk", "insufficient funds"),
        None
    );
    assert_eq!(classify_evm_window_error(None, "", "nonce too low"), None);
    // A numeric code means nothing outside its codespace.
    assert_eq!(
        classify_evm_window_error(Some(ERR_NO_EVM_WINDOW), "sdk", ""),
        None
    );
    assert_eq!(classify_evm_window_error(None, "", ""), None);
    // An unmapped pqc code is not a window refusal either.
    assert_eq!(classify_evm_window_error(Some(21), "pqc", ""), None);
}

#[test]
fn classifies_a_decoded_tx_error() {
    let err: QoreTxError = decode_tx_error(ERR_NO_EVM_WINDOW, "pqc", NO_WINDOW_TEXT).unwrap();
    assert_eq!(classify_tx_error(&err), Some(EvmWindowRefusal::NoWindow));
    assert!(err.reason.contains("no open EVM authorisation window"));

    let other = decode_tx_error(5, "sdk", "insufficient funds").unwrap();
    assert_eq!(classify_tx_error(&other), None);
}

#[test]
fn decode_tx_error_knows_the_window_codes() {
    assert!(decode_tx_error(ERR_EVM_WINDOW_EXHAUSTED, "pqc", "")
        .unwrap()
        .reason
        .contains("exhausted"));
    assert!(decode_tx_error(ERR_INVALID_EVM_WINDOW, "pqc", "")
        .unwrap()
        .reason
        .contains("no registered"));
}
