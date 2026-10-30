//! Client support for chain v3.2.4: staking tiers, the authenticator nonce,
//! protocol features, `possession_proven`, the IBC timeout helper.
//!
//! The reads run against a tiny hyper mock LCD that answers each route from a
//! fixed table and records the requested paths. No real network access.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use prost::Message as _;
use tokio::net::TcpListener;

use qorechain::authenticator::{auth_nonce_path, fetch_auth_nonce, AuthNonce};
use qorechain::msg::cosmos::{ibc_timeout_timestamp, ibc_timeout_timestamp_at};
use qorechain::msg::stakingtier::{
    claim_bonus_any, lock_delegation, lock_delegation_any, unlock_early_any, CLAIM_BONUS,
    LOCK_DELEGATION, UNLOCK_EARLY,
};
use qorechain::pqc_dx::fetch_pqc_status;
use qorechain::proto::qorechain::stakingtier::v1::MsgLockDelegation;
use qorechain::protocol_features::{
    fetch_protocol_features, is_protocol_feature_enabled, ProtocolFeature,
};
use qorechain::query::RestClient;
use qorechain::stakingtier::{
    fetch_staking_locks, fetch_staking_tier_params, fetch_staking_tier_pool,
    stakingtier_error_kind, StakingLockTier, STAKING_LOCK_MONTHS,
};
use qorechain::tx::{decode_refusal_text, decode_tx_error, error_from_text, REGISTERED_ERRORS};
use qorechain::upgrades::CHAIN_UPGRADE_V3_2_4;
use qorechain::Error;

const ADDR: &str = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
const VAL: &str = "qorvaloper1hkkxx5jmmw02wcz26c74lsp74qysj6h4ewkcwk";

/// A mock LCD: `routes` maps a path prefix to the body it answers; any other
/// path is a 404.
struct MockLcd {
    base_url: String,
    paths: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockLcd {
    async fn start(routes: &[(&'static str, &'static str)]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let paths: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let routes: Arc<HashMap<&'static str, &'static str>> =
            Arc::new(routes.iter().copied().collect());
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        let recorded = paths.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    accepted = listener.accept() => {
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let (recorded, routes) = (recorded.clone(), routes.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (recorded, routes) = (recorded.clone(), routes.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let _ = req.into_body().collect().await;
                                    recorded.lock().unwrap().push(path.clone());
                                    let body = routes
                                        .iter()
                                        .find(|(prefix, _)| path.starts_with(**prefix))
                                        .map(|(_, b)| *b);
                                    let resp = match body {
                                        Some(b) => Response::new(Full::new(Bytes::from(b))),
                                        None => Response::builder()
                                            .status(StatusCode::NOT_FOUND)
                                            .body(Full::new(Bytes::from("{}")))
                                            .unwrap(),
                                    };
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
        Self {
            base_url,
            paths,
            _shutdown: tx,
        }
    }

    fn rest(&self) -> RestClient {
        RestClient::new(self.base_url.clone())
    }

    fn path(&self, i: usize) -> String {
        self.paths.lock().unwrap()[i].clone()
    }
}

// --------------------------------------------------------------------------- //
// Staking tiers
// --------------------------------------------------------------------------- //

#[test]
fn lock_delegation_encodes_and_round_trips() {
    let any = lock_delegation_any(ADDR, VAL, "10000000", 6).unwrap();
    assert_eq!(any.type_url, LOCK_DELEGATION);
    assert_eq!(any.type_url, "/qorechain.stakingtier.v1.MsgLockDelegation");
    let back = MsgLockDelegation::decode(any.value.as_slice()).unwrap();
    assert_eq!(
        back,
        MsgLockDelegation {
            delegator: ADDR.into(),
            validator: VAL.into(),
            amount: "10000000".into(),
            months: 6,
        }
    );
}

#[test]
fn lock_delegation_applies_the_chain_checks() {
    assert_eq!(STAKING_LOCK_MONTHS, [3, 6, 12]);
    let err = |r: qorechain::Result<MsgLockDelegation>| match r.unwrap_err() {
        Error::StakingTier(m) => m,
        other => panic!("expected a staking-tier error, got {other}"),
    };
    assert!(
        err(lock_delegation(ADDR, VAL, "10000000", 4)).contains("months must be one of 3, 6, 12")
    );
    assert!(err(lock_delegation(ADDR, VAL, "0", 3)).contains("positive integer"));
    assert!(err(lock_delegation(ADDR, VAL, "1.5", 3)).contains("positive integer"));
    assert!(err(lock_delegation(ADDR, VAL, "", 3)).contains("positive integer"));
    assert!(err(lock_delegation(ADDR, "", "10000000", 3)).contains("validator"));
    assert!(err(lock_delegation("", VAL, "10000000", 3)).contains("delegator"));
    for months in STAKING_LOCK_MONTHS {
        assert!(lock_delegation(ADDR, VAL, "1", months).is_ok());
    }
}

#[test]
fn unlock_early_and_claim_bonus_type_urls() {
    let u = unlock_early_any(ADDR, 7);
    assert_eq!(u.type_url, UNLOCK_EARLY);
    assert_eq!(u.type_url, "/qorechain.stakingtier.v1.MsgUnlockEarly");
    let c = claim_bonus_any(ADDR);
    assert_eq!(c.type_url, CLAIM_BONUS);
    assert_eq!(c.type_url, "/qorechain.stakingtier.v1.MsgClaimBonus");
}

#[tokio::test]
async fn reads_params_locks_and_pool() {
    let server = MockLcd::start(&[
        (
            "/qorechain/stakingtier/v1/params",
            r#"{"lock_tiers":[{"months":3,"bonus_bps":150},{"months":12,"bonus_bps":500}],
                "light_node_bonus_bps":200,"validator_bonus_bps":300,"max_total_apy_bps":2500,
                "early_unlock_penalty_bps":500,"enabled":true,"min_lock_amount":"10000000"}"#,
        ),
        (
            "/qorechain/stakingtier/v1/locks/",
            r#"{"locks":[{"id":"1","validator":"qorvaloper1x","locked_amount":"20000000",
                "months":6,"end_time":"1800000000","accrued_bonus":"5","released":false,
                "projected_bonus_bps":"512.5"}],"claimable":"5","total_claimable":"5"}"#,
        ),
        (
            "/qorechain/stakingtier/v1/pool",
            r#"{"balance":"0","lock_count":"3","last_base_apy_bps":"4510.47",
                "total_minted":"340282366920938463463374607431768211455"}"#,
        ),
    ])
    .await;

    let params = fetch_staking_tier_params(&server.rest()).await.unwrap();
    assert_eq!(
        params.lock_tiers,
        vec![
            StakingLockTier {
                months: 3,
                bonus_bps: 150
            },
            StakingLockTier {
                months: 12,
                bonus_bps: 500
            }
        ]
    );
    assert_eq!(params.min_lock_amount, 10_000_000);
    assert!(params.enabled);
    assert_eq!(params.max_total_apy_bps, 2500);

    let rest = RestClient::new(format!("{}/", server.base_url));
    let locks = fetch_staking_locks(&rest, ADDR).await.unwrap();
    assert_eq!(
        server.path(1),
        format!("/qorechain/stakingtier/v1/locks/{ADDR}")
    );
    let l = &locks.locks[0];
    assert_eq!(
        (l.id, l.locked_amount, l.months, l.end_time, l.released),
        (1, 20_000_000, 6, 1_800_000_000, false)
    );
    assert_eq!(l.projected_bonus_bps, "512.5");
    assert_eq!(locks.claimable, 5);

    let pool = fetch_staking_tier_pool(&server.rest()).await.unwrap();
    assert_eq!(pool.lock_count, 3);
    assert_eq!(pool.last_base_apy_bps, "4510.47");
    assert_eq!(pool.total_minted, u128::MAX);
}

#[test]
fn decodes_the_module_errors() {
    let e = decode_tx_error(5, "stakingtier", "").unwrap();
    assert_eq!(
        e.reason,
        "this lock term is not offered (see the module parameters)"
    );
    assert_eq!(stakingtier_error_kind(5), Some("stakingtier_invalid_term"));
    let e = decode_tx_error(13, "stakingtier", "").unwrap();
    assert!(e.reason.starts_with("this stake is locked"), "{}", e.reason);
    assert_eq!(stakingtier_error_kind(13), Some("stakingtier_stake_locked"));
    assert_eq!(stakingtier_error_kind(1), None);
    assert_eq!(
        decode_tx_error(99, "stakingtier", "").unwrap().reason,
        "unknown stakingtier error"
    );
}

// --------------------------------------------------------------------------- //
// Chain v3.2.4 reads
// --------------------------------------------------------------------------- //

#[tokio::test]
async fn protocol_features() {
    let server = MockLcd::start(&[(
        "/qorechain/pqc/v1/protocol_features",
        r#"{"features":[{"name":"pqc-sign-bytes-v2","enabled":true,"known":true,"staged":false},
            {"name":"x","enabled":false,"known":true,"staged":true}],"height":"3758400"}"#,
    )])
    .await;
    let rest = server.rest();
    let r = fetch_protocol_features(&rest).await.unwrap();
    assert_eq!(r.height, 3_758_400);
    assert_eq!(
        r.features[1],
        ProtocolFeature {
            name: "x".into(),
            enabled: false,
            known: true,
            staged: true
        }
    );
    assert!(is_protocol_feature_enabled(&rest, "pqc-sign-bytes-v2")
        .await
        .unwrap());
    assert!(!is_protocol_feature_enabled(&rest, "x").await.unwrap());
    assert!(!is_protocol_feature_enabled(&rest, "absent").await.unwrap());
}

#[tokio::test]
async fn protocol_features_below_v324_is_an_error() {
    let server = MockLcd::start(&[]).await;
    assert!(fetch_protocol_features(&server.rest()).await.is_err());
}

#[tokio::test]
async fn auth_nonce_bytes_or_hex_key() {
    let server = MockLcd::start(&[(
        "/qorechain/abstractaccount/v1/auth_nonce/",
        r#"{"nonce":"7","linked":true}"#,
    )])
    .await;
    let rest = server.rest();
    let r = fetch_auth_nonce(&rest, ADDR, &[0xab_u8, 0x01])
        .await
        .unwrap();
    assert_eq!(
        r,
        AuthNonce {
            nonce: 7,
            linked: true
        }
    );
    assert_eq!(
        server.path(0),
        format!("/qorechain/abstractaccount/v1/auth_nonce/{ADDR}/ab01")
    );
    fetch_auth_nonce(&rest, ADDR, "0xAB01").await.unwrap();
    assert!(server.path(1).ends_with("/AB01"));

    for bad in ["zz", "", "0x", "abc"] {
        assert!(
            matches!(
                fetch_auth_nonce(&rest, ADDR, bad).await,
                Err(Error::InvalidInput(_))
            ),
            "{bad:?}"
        );
    }
    assert!(auth_nonce_path(ADDR, &[] as &[u8]).is_err());
    // Refused keys never reach the node.
    assert_eq!(server.paths.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn pqc_status_carries_possession_proven() {
    let server = MockLcd::start(&[(
        "/qorechain/pqc/v1/account/",
        r#"{"found":true,"account":{"public_key":"AQID","possession_proven":true}}"#,
    )])
    .await;
    let s = fetch_pqc_status(&server.base_url, ADDR).await.unwrap();
    assert_eq!(s.possession_proven, Some(true));
    assert_eq!(s.pubkey.as_deref(), Some(&[1u8, 2, 3][..]));
}

#[test]
fn ibc_timeout_is_absolute_unix_nanoseconds() {
    let now = UNIX_EPOCH + Duration::from_secs(1_792_886_400); // 2026-10-25T00:00:00Z
    assert_eq!(
        ibc_timeout_timestamp_at(600, now).unwrap(),
        (1_792_886_400 + 600) * 1_000_000_000
    );
    assert!(matches!(
        ibc_timeout_timestamp(0),
        Err(Error::InvalidInput(m)) if m.contains("positive")
    ));
    assert!(ibc_timeout_timestamp_at(u64::MAX, now).is_err());
    assert!(ibc_timeout_timestamp(60).unwrap() > 1_700_000_000 * 1_000_000_000);
}

#[test]
fn upgrade_constant() {
    assert_eq!(CHAIN_UPGRADE_V3_2_4, "v3.2.4");
}

#[test]
fn decode_tx_error_on_a_failed_simulation_text_only() {
    let sim = "Query failed with (6): rpc error: code = Unknown desc = failed to execute message; \
               message index: 0: no bonus to claim [baseapp.go:1052] with gas used: '111685': \
               unknown request";
    let e = decode_refusal_text(sim).expect("named");
    assert_eq!((e.codespace.as_str(), e.code), ("stakingtier", 12));
    assert_eq!(
        stakingtier_error_kind(e.code),
        Some("stakingtier_nothing_to_claim")
    );
    assert_eq!(e.raw_log, sim);
    // The longest match wins: the hybrid failure is not the plain PQC one.
    assert_eq!(
        error_from_text("hybrid PQC signature verification failed"),
        Some(("pqc", 21))
    );
    // A coded error is left alone.
    assert_eq!(
        decode_tx_error(5, "sdk", "no bonus to claim").unwrap().code,
        5
    );
    // Text that names nothing stays None, and code 0 is success whatever the log says.
    assert!(decode_refusal_text("").is_none());
    assert!(decode_refusal_text("something else").is_none());
    assert!(decode_tx_error(0, "", sim).is_none());
    // 36 through v3.2.4, plus pqc 250-254 and abstractaccount 9 from v3.2.5.
    assert_eq!(REGISTERED_ERRORS.len(), 42);
}
