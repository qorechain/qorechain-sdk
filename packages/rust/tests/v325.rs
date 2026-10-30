//! Client support for chain v3.2.5: exact simulate gas, the KEM key registry,
//! spending-rule save-time checks, MsgUpdateConfig, the crossvm / rdk
//! MsgUpdateParams and the new abstract-account reads.
//!
//! The reads run against a tiny hyper mock LCD that answers each route from a
//! fixed table and records the requested paths. No real network access.

use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use prost::Message as _;
use tokio::net::TcpListener;

use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
use cosmrs::Any;
use qorechain::abstractaccount::{fetch_authenticators, fetch_spending_rules};
use qorechain::kem::{
    fetch_kem_key, kem_error_name, validate_kem_public_key, KEM_ALGORITHM_ML_KEM_1024,
    ML_KEM_1024_PUBLIC_KEY_LEN,
};
use qorechain::msg::abstractaccount::{
    update_config, update_config_any, validate_evm_denom, validate_spending_rules, UPDATE_CONFIG,
};
use qorechain::msg::pqc::{
    register_kem_key, register_kem_key_any, remove_kem_key_any, REGISTER_KEM_KEY, REMOVE_KEM_KEY,
};
use qorechain::proto::qorechain::abstractaccount::v1::{DenomLimit, MsgUpdateConfig, SpendingRule};
use qorechain::proto::qorechain::pqc::v1::{MsgRegisterKemKey, MsgRemoveKemKey};
use qorechain::proto::qorechain::rdk::v1::MsgUpdateParams as RdkParams;
use qorechain::query::RestClient;
use qorechain::tx::{
    decode_refusal_text, decode_tx_error, estimate_fee, estimate_gas_wanted, exact_hybrid_gas,
    hybrid_gas_wanted, is_hybrid_tx, EXACT_GAS_HEADROOM,
};
use qorechain::upgrades::CHAIN_UPGRADE_V3_2_5;
use qorechain::{msg, Error};

const ADDR: &str = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
const GOV: &str = "qor10d07y265gmmuvt4z0w9aw880jnsr700jfvkl8z";

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

fn tx_bytes(hybrid: bool) -> Vec<u8> {
    let body = TxBody {
        messages: vec![],
        memo: String::new(),
        timeout_height: 0,
        extension_options: if hybrid {
            vec![Any {
                type_url: qorechain::HYBRID_SIG_TYPE_URL.into(),
                value: vec![8, 1],
            }]
        } else {
            vec![]
        },
        non_critical_extension_options: vec![],
    };
    TxRaw {
        body_bytes: body.encode_to_vec(),
        auth_info_bytes: vec![],
        signatures: vec![vec![0; 64]],
    }
    .encode_to_vec()
}

const SIMULATE: &str = r#"{"gas_info":{"gas_wanted":"0","gas_used":"166300"}}"#;
const APPLIED: &str = r#"{"height":"3906833"}"#;
const NOT_APPLIED: &str = r#"{"height":"0"}"#;

fn plan_lookups(m: &MockLcd) -> usize {
    m.paths
        .lock()
        .unwrap()
        .iter()
        .filter(|p| p.ends_with("/applied_plan/v3.2.5"))
        .count()
}

// --------------------------------------------------------------------------- //
// Exact gas
// --------------------------------------------------------------------------- //

#[test]
fn exact_hybrid_gas_is_two_percent_plus_2000() {
    assert_eq!(CHAIN_UPGRADE_V3_2_5, "v3.2.5");
    assert_eq!(EXACT_GAS_HEADROOM, 2000);
    // 166_300 * 1.02 = 169_626 exactly.
    assert_eq!(exact_hybrid_gas(166_300), 171_626);
    // 100_000 * 1.02 is 102000.00000000001 in f64; integer math keeps 102000.
    assert_eq!(exact_hybrid_gas(100_000), 104_000);
    // Rounds up.
    assert_eq!(exact_hybrid_gas(1), 2002);
    assert_eq!(exact_hybrid_gas(0), 2000);
}

#[test]
fn hybrid_detection_reads_the_extension() {
    assert!(is_hybrid_tx(&tx_bytes(true)));
    assert!(!is_hybrid_tx(&tx_bytes(false)));
    assert!(!is_hybrid_tx(b"not a tx"));
}

#[tokio::test]
async fn v325_network_gets_exact_gas_and_the_lookup_is_cached() {
    let m = MockLcd::start(&[
        ("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5", APPLIED),
        ("/cosmos/tx/v1beta1/simulate", SIMULATE),
    ])
    .await;
    let e = estimate_gas_wanted(&m.base_url, &tx_bytes(true), 0.0)
        .await
        .unwrap();
    assert_eq!(e.simulated, 166_300);
    assert_eq!(e.gas_wanted, 171_626);
    assert!(e.exact);
    // Once applied, the answer is cached for the endpoint: no second lookup.
    let again = hybrid_gas_wanted(&m.base_url, 166_300, 0.0).await;
    assert_eq!(again.gas_wanted, 171_626);
    assert_eq!(plan_lookups(&m), 1);

    // The fee uses the exact gas: ceil(171_626 * 0.1) = 17_163 uqor.
    let fee = estimate_fee(&m.base_url, &tx_bytes(true), 0.0, "0.1uqor")
        .await
        .unwrap();
    assert_eq!(fee.gas, "171626");
    assert_eq!(fee.amount[0].amount, "17163");
    assert_eq!(plan_lookups(&m), 1);
}

#[tokio::test]
async fn explicit_multiplier_and_classical_txs_keep_the_multiplier_path() {
    let m = MockLcd::start(&[
        ("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5", APPLIED),
        ("/cosmos/tx/v1beta1/simulate", SIMULATE),
    ])
    .await;
    let explicit = estimate_gas_wanted(&m.base_url, &tx_bytes(true), 1.2)
        .await
        .unwrap();
    assert_eq!(explicit.gas_wanted, 199_560);
    assert!(!explicit.exact);
    let classical = estimate_gas_wanted(&m.base_url, &tx_bytes(false), 0.0)
        .await
        .unwrap();
    assert_eq!(classical.gas_wanted, 232_820);
    assert!(!classical.exact);
    // Neither asked about the plan.
    assert_eq!(plan_lookups(&m), 0);
}

#[tokio::test]
async fn older_network_keeps_the_old_path() {
    let m = MockLcd::start(&[
        ("/cosmos/upgrade/v1beta1/applied_plan/v3.2.5", NOT_APPLIED),
        ("/cosmos/tx/v1beta1/simulate", SIMULATE),
    ])
    .await;
    let e = estimate_gas_wanted(&m.base_url, &tx_bytes(true), 0.0)
        .await
        .unwrap();
    // ceil(166_300 * 1.4) = 232_820, as before v3.2.5.
    assert_eq!(e.gas_wanted, 232_820);
    assert!(!e.exact);
}

#[tokio::test]
async fn failed_plan_lookup_keeps_the_old_path() {
    // No applied_plan route: the lookup fails (404), so the larger limit is used.
    let m = MockLcd::start(&[("/cosmos/tx/v1beta1/simulate", SIMULATE)]).await;
    let e = estimate_gas_wanted(&m.base_url, &tx_bytes(true), 0.0)
        .await
        .unwrap();
    assert_eq!(e.gas_wanted, 232_820);
    assert!(!e.exact);
}

// --------------------------------------------------------------------------- //
// KEM registry
// --------------------------------------------------------------------------- //

/// A well-formed ML-KEM-1024 encapsulation key: coefficients below 3329.
fn good_kem_key() -> Vec<u8> {
    let mut k = Vec::with_capacity(ML_KEM_1024_PUBLIC_KEY_LEN);
    for i in 0..512u32 {
        // Pack c0 = i % 3329, c1 = (i * 7) % 3329.
        let (c0, c1) = ((i % 3329) as u16, ((i * 7) % 3329) as u16);
        k.push((c0 & 0xff) as u8);
        k.push(((c0 >> 8) as u8) | (((c1 & 0x0f) as u8) << 4));
        k.push((c1 >> 4) as u8);
    }
    k.extend_from_slice(&[0xab; 32]); // rho
    k
}

#[test]
fn kem_key_checks_follow_fips_203() {
    assert_eq!(KEM_ALGORITHM_ML_KEM_1024, 2);
    let good = good_kem_key();
    assert_eq!(good.len(), 1568);
    validate_kem_public_key(2, &good).unwrap();

    // Wrong size.
    assert!(validate_kem_public_key(2, &good[..1567]).is_err());
    // A coefficient of 4095 (>= 3329).
    let mut bad = good.clone();
    bad[0] = 0xff;
    bad[1] |= 0x0f;
    let err = validate_kem_public_key(2, &bad).unwrap_err().to_string();
    assert!(err.contains("modulus"), "{err}");
    // The high coefficient of a triple.
    let mut bad_hi = good.clone();
    bad_hi[4] |= 0xf0;
    bad_hi[5] = 0xff;
    assert!(validate_kem_public_key(2, &bad_hi).is_err());
    // All-zero t_hat.
    let mut zero = vec![0u8; 1568];
    zero[1540] = 7;
    let err = validate_kem_public_key(2, &zero).unwrap_err().to_string();
    assert!(err.contains("degenerate"), "{err}");
    // Other algorithm ids are the chain's to judge.
    validate_kem_public_key(9, &[1, 2, 3]).unwrap();
}

#[test]
fn kem_composers_encode() {
    let any = register_kem_key_any(ADDR, good_kem_key(), 2).unwrap();
    assert_eq!(any.type_url, REGISTER_KEM_KEY);
    assert_eq!(any.type_url, "/qorechain.pqc.v1.MsgRegisterKEMKey");
    let back = MsgRegisterKemKey::decode(any.value.as_slice()).unwrap();
    assert_eq!(back.sender, ADDR);
    assert_eq!(back.algorithm_id, 2);
    assert_eq!(back.public_key, good_kem_key());
    assert!(register_kem_key(ADDR, vec![0; 1568], 2).is_err());

    let rm = remove_kem_key_any(ADDR);
    assert_eq!(rm.type_url, REMOVE_KEM_KEY);
    assert_eq!(rm.type_url, "/qorechain.pqc.v1.MsgRemoveKEMKey");
    assert_eq!(
        MsgRemoveKemKey::decode(rm.value.as_slice()).unwrap().sender,
        ADDR
    );
}

#[test]
fn kem_refusals_are_named() {
    assert_eq!(kem_error_name(250), Some("ErrKEMRegistryNotEnabled"));
    assert_eq!(kem_error_name(254), Some("ErrKEMNeedsSignatureKey"));
    assert_eq!(kem_error_name(255), None);
    let e = decode_tx_error(253, "pqc", "").unwrap();
    assert_eq!(
        e.reason,
        "this KEM key is already published for this account"
    );
    let e = decode_tx_error(254, "pqc", "").unwrap();
    assert!(e.reason.contains("post-quantum signature key"));
    // Text only (a failed simulation).
    let t = decode_refusal_text(
        "failed to execute message; message index: 0: no KEM key published for this account",
    )
    .unwrap();
    assert_eq!((t.codespace.as_str(), t.code), ("pqc", 252));
    let t = decode_refusal_text("x: invalid KEM public key: bad").unwrap();
    assert_eq!(t.code, 251);
}

#[tokio::test]
async fn kem_key_read() {
    let key = good_kem_key();
    let b64 = {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&key)
    };
    let body: &'static str = Box::leak(
        format!(
            r#"{{"found":true,"key":{{"address":"{ADDR}","algorithm_id":2,"algorithm_name":"mlkem1024","public_key":"{b64}","registered_height":"8979497"}}}}"#
        )
        .into_boxed_str(),
    );
    let m = MockLcd::start(&[
        ("/qorechain/pqc/v1/kem/qor1hkk", body),
        ("/qorechain/pqc/v1/kem/0x", r#"{"found":false,"key":null}"#),
    ])
    .await;
    let got = fetch_kem_key(&m.rest(), ADDR).await.unwrap();
    assert!(got.found);
    let k = got.key.unwrap();
    assert_eq!(k.public_key, key);
    assert_eq!(k.algorithm_id, 2);
    assert_eq!(k.algorithm_name, "mlkem1024");
    assert_eq!(k.registered_height, 8_979_497);
    assert_eq!(m.path(0), format!("/qorechain/pqc/v1/kem/{ADDR}"));
    let none = fetch_kem_key(&m.rest(), "0x0000000000000000000000000000000000000001")
        .await
        .unwrap();
    assert!(!none.found);
    assert!(none.key.is_none());
}

// --------------------------------------------------------------------------- //
// Abstract account
// --------------------------------------------------------------------------- //

const TOKEN: &str = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

fn rule_with_denom(denom: &str) -> SpendingRule {
    SpendingRule {
        id: "r".into(),
        enabled: true,
        denom_limits: vec![DenomLimit {
            denom: denom.into(),
            per_tx_limit: "10".into(),
            daily_limit: String::new(),
        }],
        ..Default::default()
    }
}

#[test]
fn evm_denoms_must_carry_a_contract_address() {
    validate_evm_denom("uqor").unwrap();
    validate_evm_denom(&format!("erc20/{TOKEN}")).unwrap();
    validate_evm_denom(&format!(
        "ERC20/{}",
        TOKEN.to_uppercase().replacen("0X", "0x", 1)
    ))
    .unwrap();
    validate_evm_denom(&format!("erc721/{TOKEN}/42")).unwrap();
    validate_evm_denom(&format!("erc1155/0X{}/7", &TOKEN[2..])).unwrap();
    for bad in [
        "erc20/".to_string(),
        format!("erc20/{}", &TOKEN[2..]),       // no 0x
        format!("erc20/{}", &TOKEN[..41]),      // 19.5 bytes
        format!("erc721/0x{}", "g".repeat(40)), // not hex
        format!("erc20/{TOKEN}/1"),             // erc20 with a tail
        format!("Erc1155/{TOKEN}00/1"),         // 21 bytes
    ] {
        assert!(validate_evm_denom(&bad).is_err(), "{bad}");
    }

    // Enforced inside the rule checks for denom_limits and allowed_denoms.
    validate_spending_rules(&[rule_with_denom(&format!("erc20/{TOKEN}"))]).unwrap();
    let err = validate_spending_rules(&[rule_with_denom("erc20/0xabc")])
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("spending rule 0") && err.contains("contract address"),
        "{err}"
    );
    let mut allowed = rule_with_denom("uqor");
    allowed.allowed_denoms = vec![format!("erc721/{}", &TOKEN[2..])];
    assert!(matches!(
        validate_spending_rules(&[allowed]),
        Err(Error::SpendingRule(_))
    ));

    // The chain names the refusal (code 8).
    let e = decode_tx_error(8, "abstractaccount", "").unwrap();
    assert_eq!(e.reason, "invalid spending rule");
    let t = decode_refusal_text("rule 0: invalid spending rule").unwrap();
    assert_eq!((t.codespace.as_str(), t.code), ("abstractaccount", 8));
    assert_eq!(
        decode_tx_error(9, "abstractaccount", "").unwrap().reason,
        "abstract account module is disabled"
    );
}

#[test]
fn update_config_checks_and_encodes() {
    let any = update_config_any(GOV, true, 10, 5, 86_400).unwrap();
    assert_eq!(any.type_url, UPDATE_CONFIG);
    assert_eq!(
        any.type_url,
        "/qorechain.abstractaccount.v1.MsgUpdateConfig"
    );
    assert_eq!(
        MsgUpdateConfig::decode(any.value.as_slice()).unwrap(),
        MsgUpdateConfig {
            authority: GOV.into(),
            enabled: true,
            max_session_keys: 10,
            max_spending_rules: 5,
            default_session_ttl: 86_400,
        }
    );
    assert!(update_config("", true, 10, 5, 86_400).is_err());
    assert!(update_config(GOV, true, 0, 5, 86_400).is_err());
    assert!(update_config(GOV, true, 10, -1, 86_400).is_err());
    assert!(update_config(GOV, false, 10, 5, 0).is_err());
}

#[tokio::test]
async fn abstractaccount_reads() {
    let m = MockLcd::start(&[
        (
            "/qorechain/abstractaccount/v1/accounts/qor1hkk",
            r#"{"rules":[{"id":"uqor","daily_limit":"1000","per_tx_limit":"1000","allowed_denoms":["uqor"],"enabled":false,"allowed_evm_calls":[],"denom_limits":[{"denom":"uqor","per_tx_limit":"5","daily_limit":""}]}],"authenticator_rules":[{"scheme":"secp256k1","pubkey_hex":"02ab","rule":{"id":"k","daily_limit":"0","per_tx_limit":"7","enabled":true}}],"authenticators":[{"scheme":"secp256k1","pubkey_hex":"020c","permissions":["evm"],"expiry_unix":"1793321768","label":"x","created_at_unix":"1793148971","revoked":false,"has_spend_rule":true}]}"#,
        ),
    ])
    .await;
    let r = fetch_spending_rules(&m.rest(), ADDR).await.unwrap();
    assert_eq!(r.rules.len(), 1);
    assert_eq!(r.rules[0].daily_limit, 1000);
    assert_eq!(r.rules[0].denom_limits[0].per_tx_limit, "5");
    assert_eq!(r.authenticator_rules[0].rule.per_tx_limit, 7);
    assert!(r.authenticator_rules[0].rule.enabled);
    assert_eq!(
        m.path(0),
        format!("/qorechain/abstractaccount/v1/accounts/{ADDR}/spending_rules")
    );
    let a = fetch_authenticators(&m.rest(), ADDR).await.unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].expiry_unix, 1_793_321_768);
    assert_eq!(a[0].permissions, vec!["evm"]);
    assert!(a[0].has_spend_rule && !a[0].revoked);
    assert_eq!(
        m.path(1),
        format!("/qorechain/abstractaccount/v1/accounts/{ADDR}/authenticators")
    );
}

// --------------------------------------------------------------------------- //
// Governance parameter updates
// --------------------------------------------------------------------------- //

#[test]
fn crossvm_update_params() {
    let p = msg::crossvm::update_params(
        GOV,
        65_536,
        1000,
        100,
        true,
        vec![format!("cosmwasm:{ADDR}")],
    )
    .unwrap();
    let any = msg::crossvm::update_params_any(&p);
    assert_eq!(any.type_url, "/qorechain.crossvm.v1.MsgUpdateParams");
    let back =
        qorechain::proto::qorechain::crossvm::v1::MsgUpdateParams::decode(any.value.as_slice())
            .unwrap();
    assert_eq!(
        back.bridge_allowed_targets,
        vec![format!("cosmwasm:{ADDR}")]
    );
    assert!(msg::crossvm::update_params(GOV, 0, 1000, 100, true, vec![]).is_err());
    assert!(msg::crossvm::update_params("", 1, 1, 1, true, vec![]).is_err());
    assert!(msg::crossvm::update_params(GOV, 1, 1, 1, true, vec!["cosmwasm".into()]).is_err());
    assert!(msg::crossvm::update_params(GOV, 1, 1, 1, true, vec![":x".into()]).is_err());
}

#[test]
fn rdk_update_params() {
    let p = RdkParams {
        authority: GOV.into(),
        max_rollups: 100,
        min_stake_for_rollup: 10_000_000_000,
        rollup_creation_burn_rate: "0.01".into(),
        default_challenge_window: 604_800,
        max_da_blob_size: 2_097_152,
        blob_retention_blocks: 432_000,
        max_batches_per_block: 10,
    };
    let any = msg::rdk::update_params_any(p.clone()).unwrap();
    assert_eq!(any.type_url, "/qorechain.rdk.v1.MsgUpdateParams");
    assert_eq!(RdkParams::decode(any.value.as_slice()).unwrap(), p);
    for rate in ["1", "1.0", "", "-0.1", "0.x", "2.5"] {
        let mut q = p.clone();
        q.rollup_creation_burn_rate = rate.into();
        assert!(msg::rdk::update_params(q).is_err(), "{rate}");
    }
    let mut q = p.clone();
    q.rollup_creation_burn_rate = "0".into();
    msg::rdk::update_params(q).unwrap();
    let mut q = p;
    q.authority.clear();
    assert!(msg::rdk::update_params(q).is_err());
}
