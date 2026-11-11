//! Client support for chain v3.2.8: authenticator possession proofs and the
//! value-permission spending-rule check, execute-lane results, the wholesale
//! crossvm / svm / rdk MsgUpdateParams composers, async cross-VM gas terms and
//! the paginated pending query, EVM window grants, gas caps and the opt-in
//! minimum gas price.
//!
//! Network reads run against a small hyper mock that answers from a closure.
//! No real network access.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use prost::Message as _;
use serde_json::{json, Value};
use tokio::net::TcpListener;

use qorechain::abstractaccount::{
    execution_results, require_executions_succeeded, ExecutionLane, EXECUTE_COSMOS_RESPONSE,
    EXECUTE_EVM_RESPONSE,
};
use qorechain::authenticator::{
    authenticator_link_message, authenticator_link_proof_ed25519, authenticator_link_proof_eip191,
    authenticator_link_proof_secp256k1, eip191_digest, evm_auth_sign_bytes_v2,
    verify_authenticator_link_proof,
};
use qorechain::cross_vm::{CallOptions, CrossVm, VM_TYPE_COSMWASM, VM_TYPE_EVM};
use qorechain::evm_window::{validate_evm_window_scope, EvmWindowScope};
use qorechain::msg::abstractaccount::{
    check_value_permission_rules, link_authenticator_msgs, register_authenticator,
    LinkAuthenticatorParams, REGISTER_AUTHENTICATOR, UPDATE_SPENDING_RULES,
};
use qorechain::proto::qorechain::abstractaccount::v1::{
    DenomLimit, MsgExecuteCosmosResponse, MsgExecuteEvmResponse, MsgRegisterAuthenticator,
    SpendingRule,
};
use qorechain::proto::qorechain::crossvm::v1 as xpb;
use qorechain::query::RestClient;
use qorechain::tx::{
    fetch_evm_limits, fetch_min_gas_price_uqor, needs_simulated_gas, parse_evm_limits,
    recommended_gas_price_from_min, recommended_gas_price_uqor, refuse_fixed_gas_for,
    send_messages, validate_evm_gas_limit, Fee, GasPrice, SendMessagesParams,
    DEFAULT_EVM_TX_MAX_GAS, MAX_COSMOS_TX_GAS,
};
use qorechain::{msg, Error, TypedQueryClient};

const CHAIN: &str = "qorechain-diana";
const ACCOUNT: &str = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
const GOV: &str = "qor10d07y265gmmuvt4z0w9aw880jnsr700jfvkl8z";

type Handler = Arc<dyn Fn(&str, &str) -> (u16, String) + Send + Sync>;

/// A mock HTTP server answering every request from `handler(path, body)`.
struct Mock {
    base_url: String,
    paths: Arc<Mutex<Vec<String>>>,
    _shutdown: tokio::sync::oneshot::Sender<()>,
}

impl Mock {
    async fn start(handler: Handler) -> Self {
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
                        let (stream, _) = match accepted { Ok(v) => v, Err(_) => continue };
                        let io = TokioIo::new(stream);
                        let (recorded, handler) = (recorded.clone(), handler.clone());
                        tokio::spawn(async move {
                            let svc = service_fn(move |req: Request<hyper::body::Incoming>| {
                                let (recorded, handler) = (recorded.clone(), handler.clone());
                                async move {
                                    let path = req.uri().path().to_string();
                                    let body = req.into_body().collect().await.unwrap().to_bytes();
                                    let body = String::from_utf8_lossy(&body).to_string();
                                    recorded.lock().unwrap().push(path.clone());
                                    let (status, out) = handler(&path, &body);
                                    Ok::<_, Infallible>(
                                        Response::builder()
                                            .status(StatusCode::from_u16(status).unwrap())
                                            .body(Full::new(Bytes::from(out)))
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

    async fn fixed(routes: Vec<(&'static str, String)>) -> Self {
        Self::start(Arc::new(move |path, _| {
            routes
                .iter()
                .find(|(p, _)| path.starts_with(p))
                .map(|(_, b)| (200, b.clone()))
                .unwrap_or((404, "{}".into()))
        }))
        .await
    }

    fn rest(&self) -> RestClient {
        RestClient::new(self.base_url.clone())
    }
}

// --------------------------------------------------------------------------- //
// 1. Authenticator link
// --------------------------------------------------------------------------- //

#[test]
fn link_message_known_answer() {
    let text = authenticator_link_message(CHAIN, ACCOUNT, "ed25519", &[7u8; 32]);
    assert_eq!(
        text,
        "QoreChain authenticator link v1\nchain: qorechain-diana\naccount: qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj\nscheme: ed25519\nkey: 0707070707070707070707070707070707070707070707070707070707070707"
    );
}

#[test]
fn ed25519_proof_verifies_with_ed25519() {
    use ed25519_dalek::Verifier;
    let p = authenticator_link_proof_ed25519(&[3u8; 32], CHAIN, ACCOUNT).unwrap();
    assert_eq!(p.scheme, "ed25519");
    assert_eq!(p.pubkey.len(), 32);
    let key =
        ed25519_dalek::VerifyingKey::from_bytes(&p.pubkey.clone().try_into().unwrap()).unwrap();
    let sig = ed25519_dalek::Signature::from_slice(&p.possession_proof).unwrap();
    let text = authenticator_link_message(CHAIN, ACCOUNT, "ed25519", &p.pubkey);
    key.verify(text.as_bytes(), &sig).unwrap();
    verify_authenticator_link_proof(CHAIN, ACCOUNT, &p.scheme, &p.pubkey, &p.possession_proof)
        .unwrap();
    // Bound to the chain and the account.
    assert!(verify_authenticator_link_proof(
        "qorechain-vladi",
        ACCOUNT,
        &p.scheme,
        &p.pubkey,
        &p.possession_proof
    )
    .is_err());
    assert!(authenticator_link_proof_ed25519(&[3u8; 31], CHAIN, ACCOUNT).is_err());
}

#[test]
fn secp256k1_proof_verifies_with_ecdsa_over_sha256() {
    use k256::ecdsa::signature::Verifier;
    let p = authenticator_link_proof_secp256k1(&[5u8; 32], CHAIN, ACCOUNT).unwrap();
    assert_eq!(p.scheme, "secp256k1");
    assert_eq!(p.pubkey.len(), 33);
    assert_eq!(p.possession_proof.len(), 64);
    let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(&p.pubkey).unwrap();
    let sig = k256::ecdsa::Signature::from_slice(&p.possession_proof).unwrap();
    assert!(sig.normalize_s().is_none(), "low-S");
    let text = authenticator_link_message(CHAIN, ACCOUNT, "secp256k1", &p.pubkey);
    // The standard ECDSA verify hashes the message with SHA-256.
    key.verify(text.as_bytes(), &sig).unwrap();
    verify_authenticator_link_proof(CHAIN, ACCOUNT, &p.scheme, &p.pubkey, &p.possession_proof)
        .unwrap();
}

#[test]
fn eip191_proof_recovers_the_address() {
    let p = authenticator_link_proof_eip191(&[9u8; 32], CHAIN, ACCOUNT).unwrap();
    assert_eq!(p.pubkey.len(), 20);
    assert_eq!(p.possession_proof.len(), 65);
    let v = p.possession_proof[64];
    assert!(v == 27 || v == 28);
    let text = authenticator_link_message(CHAIN, ACCOUNT, "secp256k1", &p.pubkey);
    let sig = k256::ecdsa::Signature::from_slice(&p.possession_proof[..64]).unwrap();
    let rec = k256::ecdsa::RecoveryId::from_byte(v - 27).unwrap();
    let key =
        k256::ecdsa::VerifyingKey::recover_from_prehash(&eip191_digest(text.as_bytes()), &sig, rec)
            .unwrap();
    let point = key.to_encoded_point(false);
    let addr = &qorechain::keccak256(&point.as_bytes()[1..])[12..];
    assert_eq!(addr, p.pubkey.as_slice());
    verify_authenticator_link_proof(CHAIN, ACCOUNT, &p.scheme, &p.pubkey, &p.possession_proof)
        .unwrap();
    // v = 0/1 is accepted too.
    let mut low = p.possession_proof.clone();
    low[64] -= 27;
    verify_authenticator_link_proof(CHAIN, ACCOUNT, &p.scheme, &p.pubkey, &low).unwrap();
    // The EIP-191 digest of a known message.
    assert_eq!(
        hex::encode(eip191_digest(b"hello")),
        "50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750"
    );
}

#[test]
fn register_authenticator_requires_a_proof() {
    let err = register_authenticator(
        ACCOUNT,
        ACCOUNT,
        "ed25519",
        vec![7; 32],
        vec!["send".into()],
        0,
        "",
        vec![],
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("authenticator_link_message"),
        "{err}"
    );
    assert!(register_authenticator(
        ACCOUNT,
        ACCOUNT,
        "secp256k1",
        vec![4; 65],
        vec![],
        0,
        "",
        vec![1]
    )
    .is_err());
    let m = register_authenticator(
        ACCOUNT,
        ACCOUNT,
        "ed25519",
        vec![7; 32],
        vec![],
        0,
        "x",
        vec![1, 2],
    )
    .unwrap();
    assert_eq!(m.possession_proof, vec![1, 2]);
}

fn bounding_rule() -> SpendingRule {
    SpendingRule {
        id: "r".into(),
        daily_limit: 1_000_000,
        enabled: true,
        ..Default::default()
    }
}

#[test]
fn value_permissions_need_a_bounding_first_enabled_rule() {
    let send = vec!["send".to_string()];
    assert!(check_value_permission_rules(&send, &[]).is_err());
    assert!(check_value_permission_rules(&["query".into()], &[]).is_ok());
    check_value_permission_rules(&send, &[bounding_rule()]).unwrap();
    // A disabled rule does not count; the FIRST enabled rule is the one applied.
    let disabled = SpendingRule {
        enabled: false,
        ..bounding_rule()
    };
    assert!(check_value_permission_rules(&send, std::slice::from_ref(&disabled)).is_err());
    let loose_first = SpendingRule {
        id: "loose".into(),
        enabled: true,
        allowed_evm_calls: vec!["0x0000000000000000000000000000000000000001".into()],
        ..Default::default()
    };
    assert!(
        check_value_permission_rules(&send, &[disabled, loose_first, bounding_rule()]).is_err()
    );
    // Allowed denoms, each with a denom limit amount (matched case-insensitively).
    let by_denom = SpendingRule {
        id: "d".into(),
        enabled: true,
        allowed_denoms: vec!["UQOR".into()],
        denom_limits: vec![DenomLimit {
            denom: "uqor".into(),
            per_tx_limit: "100".into(),
            daily_limit: String::new(),
        }],
        ..Default::default()
    };
    check_value_permission_rules(&["all".into()], std::slice::from_ref(&by_denom)).unwrap();
    let mut gap = by_denom;
    gap.allowed_denoms.push("ufoo".into());
    assert!(check_value_permission_rules(&["evm".into()], &[gap]).is_err());
}

#[test]
fn link_authenticator_msgs_builds_the_pair() {
    let proof = authenticator_link_proof_ed25519(&[3u8; 32], CHAIN, ACCOUNT).unwrap();
    let mut p = LinkAuthenticatorParams {
        owner: ACCOUNT.into(),
        chain_id: CHAIN.into(),
        scheme: proof.scheme.clone(),
        pubkey: proof.pubkey.clone(),
        permissions: vec!["send".into()],
        expiry_unix: 4_000_000_000,
        label: "phantom".into(),
        possession_proof: proof.possession_proof.clone(),
        spending_rules: vec![bounding_rule()],
    };
    let msgs = link_authenticator_msgs(&p).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].type_url, UPDATE_SPENDING_RULES);
    assert_eq!(msgs[1].type_url, REGISTER_AUTHENTICATOR);
    let reg = MsgRegisterAuthenticator::decode(msgs[1].value.as_slice()).unwrap();
    assert_eq!(reg.account_address, ACCOUNT);
    assert_eq!(reg.possession_proof, proof.possession_proof);

    // Without rules: refused for a value permission, register-only otherwise.
    p.spending_rules.clear();
    assert!(matches!(
        link_authenticator_msgs(&p),
        Err(Error::SpendingRule(_))
    ));
    p.permissions = vec!["query".into()];
    assert_eq!(link_authenticator_msgs(&p).unwrap().len(), 1);

    // A proof for another key / no proof is refused.
    p.possession_proof = vec![0; 64];
    assert!(link_authenticator_msgs(&p).is_err());
    p.possession_proof.clear();
    assert!(link_authenticator_msgs(&p).is_err());
}

// --------------------------------------------------------------------------- //
// 2. Execute-lane results
// --------------------------------------------------------------------------- //

fn any_json(type_url: &str, bytes: Vec<u8>) -> Value {
    json!({ "@type": type_url, "value": BASE64.encode(bytes) })
}

#[test]
fn execution_results_read_responses_and_events() {
    let ok = MsgExecuteEvmResponse {
        success: true,
        ret: vec![1, 2],
        gas_used: 21_000,
        vm_error: String::new(),
    };
    let bad = MsgExecuteCosmosResponse { success: false };
    let tx = json!({
        "tx_response": {
            "code": 0,
            "msg_responses": [
                any_json(EXECUTE_EVM_RESPONSE, ok.encode_to_vec()),
                any_json(EXECUTE_COSMOS_RESPONSE, bad.encode_to_vec()),
            ],
            "events": [
                {"type": "message", "attributes": []},
                {"type": "abstractaccount_execution_failed", "attributes": [
                    {"key": "account", "value": ACCOUNT},
                    {"key": "lane", "value": "cosmos"},
                    {"key": "nonce", "value": "4"},
                    {"key": "reason", "value": "insufficient funds"}
                ]}
            ]
        }
    });
    let r = execution_results(&tx).unwrap();
    assert_eq!(r.len(), 2);
    assert_eq!(r[0].lane, ExecutionLane::Evm);
    assert!(r[0].success);
    assert_eq!(r[0].gas_used, 21_000);
    assert_eq!(r[0].ret, vec![1, 2]);
    assert_eq!(r[1].lane, ExecutionLane::Cosmos);
    assert!(!r[1].success);
    assert_eq!(r[1].reason.as_deref(), Some("insufficient funds"));
    let err = require_executions_succeeded(&tx).unwrap_err();
    assert!(matches!(err, Error::ExecutionFailed(ref m) if m.contains("insufficient funds")));

    // Only successes: passes.
    let good = json!({"tx_response": {"msg_responses": [any_json(EXECUTE_EVM_RESPONSE, ok.encode_to_vec())]}});
    assert_eq!(require_executions_succeeded(&good).unwrap().len(), 1);
    // A sync answer with nothing yet.
    assert!(execution_results(&json!({"tx_response": {"code": 0}}))
        .unwrap()
        .is_empty());
}

#[test]
fn execution_results_fall_back_to_tx_data() {
    use cosmrs::proto::cosmos::base::abci::v1beta1::TxMsgData;
    let failed = MsgExecuteEvmResponse {
        success: false,
        ret: vec![],
        gas_used: 5,
        vm_error: "execution reverted".into(),
    };
    let data = TxMsgData {
        msg_responses: vec![cosmrs::Any {
            type_url: EXECUTE_EVM_RESPONSE.into(),
            value: failed.encode_to_vec(),
        }],
        ..Default::default()
    };
    let tx = json!({"data": hex::encode_upper(data.encode_to_vec()), "events": []});
    let r = execution_results(&tx).unwrap();
    assert_eq!(r.len(), 1);
    assert!(!r[0].success);
    let err = require_executions_succeeded(&tx).unwrap_err();
    assert!(err.to_string().contains("execution reverted"), "{err}");
}

// --------------------------------------------------------------------------- //
// 3. Governance params
// --------------------------------------------------------------------------- //

const CROSSVM_PARAMS: &str = r#"{
  "max_message_size":"65536","max_queue_size":1000,"queue_timeout_blocks":"100","enabled":true,
  "bridge_allowed_targets":["cosmwasm:qor1c"],
  "bridge_target_pins":[{"target":"cosmwasm:qor1c","code_id":"12","history_len":"2"}],
  "max_pending_per_sender":100,"max_cosmos_tx_gas":"50000000","record_retention_blocks":"100000",
  "max_block_wasm_gas":"3000000","max_tx_wasm_share_bps":5000,"max_block_level_wasm_gas":"10000000",
  "queue_wasm_reserve_bps":2500,"wasm_congestion_max_factor":1000,"wasm_congestion_target_bps":5000,
  "wasm_congestion_factor_micro":"1000000","max_block_upload_bps":5000,"max_queue_timeouts_per_block":100
}"#;

#[test]
fn crossvm_update_params_requires_every_field() {
    let err = msg::crossvm::update_params(GOV, &Default::default()).unwrap_err();
    let m = err.to_string();
    assert!(
        m.contains("bridge_target_pins") && m.contains("max_queue_timeouts_per_block"),
        "{m}"
    );
    let full = msg::crossvm::CrossvmParamsUpdate::from_rest_json(
        &serde_json::from_str(CROSSVM_PARAMS).unwrap(),
    )
    .unwrap();
    assert!(full.missing().is_empty());
    let mut partial = full.clone();
    partial.max_cosmos_tx_gas = None;
    let m = msg::crossvm::update_params(GOV, &partial)
        .unwrap_err()
        .to_string();
    assert!(m.contains("missing: max_cosmos_tx_gas"), "{m}");
    // A pin must name a listed target.
    let mut stray = full.clone();
    stray.bridge_allowed_targets = Some(vec![]);
    assert!(msg::crossvm::update_params(GOV, &stray).is_err());
}

#[tokio::test]
async fn crossvm_update_params_from_current_keeps_pins() {
    let mock = Mock::fixed(vec![(
        "/qorechain/crossvm/v1/params",
        CROSSVM_PARAMS.into(),
    )])
    .await;
    let changes = msg::crossvm::CrossvmParamsUpdate {
        max_queue_size: Some(2000),
        ..Default::default()
    };
    let m = msg::crossvm::update_params_from_current(&mock.rest(), GOV, &changes)
        .await
        .unwrap();
    assert_eq!(m.max_queue_size, 2000);
    assert_eq!(m.max_message_size, 65_536);
    assert_eq!(m.bridge_target_pins.len(), 1);
    assert_eq!(m.bridge_target_pins[0].code_id, 12);
    assert_eq!(m.bridge_target_pins[0].history_len, 2);
    assert_eq!(m.max_cosmos_tx_gas, 50_000_000);
    assert_eq!(m.max_queue_timeouts_per_block, 100);
    let back =
        xpb::MsgUpdateParams::decode(msg::crossvm::update_params_any(&m).value.as_slice()).unwrap();
    assert_eq!(back, m);
}

const SVM_PARAMS: &str = r#"{"params":{
  "max_program_size":"1048576","max_account_data_size":"10485760","compute_budget_max":"1400000",
  "lamports_per_byte":"6960","rent_exemption_multi":"2.0","enabled":false,"svm_slot_offset":"0",
  "default_sig_scheme":1,"max_cpi":4,"max_custody_uqor":"1000000000",
  "max_custody_hard_uqor":"0","max_account_excess_uqor":"10000000"}}"#;

#[tokio::test]
async fn svm_update_params_requires_a_hard_ceiling_to_open() {
    let mock = Mock::fixed(vec![("/qorechain/svm/v1/params", SVM_PARAMS.into())]).await;
    let open = msg::svm::SvmParamsUpdate {
        enabled: Some(true),
        ..Default::default()
    };
    let err = msg::svm::update_params_from_current(&mock.rest(), GOV, &open)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("hard custody ceiling"), "{err}");
    let with_ceiling = msg::svm::SvmParamsUpdate {
        enabled: Some(true),
        max_custody_hard_uqor: Some(5_000_000_000),
        ..Default::default()
    };
    let m = msg::svm::update_params_from_current(&mock.rest(), GOV, &with_ceiling)
        .await
        .unwrap();
    let p = m.params.unwrap();
    assert!(p.enabled);
    assert_eq!(p.max_custody_uqor, 1_000_000_000);
    assert_eq!(p.max_custody_hard_uqor, 5_000_000_000);
    assert_eq!(p.max_account_excess_uqor, 10_000_000);
    assert_eq!(p.rent_exemption_multi, "2.0");
    let m = msg::svm::update_params(GOV, &Default::default())
        .unwrap_err()
        .to_string();
    assert!(m.contains("max_custody_hard_uqor"), "{m}");
}

#[tokio::test]
async fn rdk_update_params_from_current() {
    let body = r#"{"params":{"max_rollups":100,"min_stake_for_rollup":"10000000000",
      "rollup_creation_burn_rate":"0.01","default_challenge_window":"604800","max_da_blob_size":"2097152",
      "blob_retention_blocks":"432000","max_batches_per_block":10,"finalized_batch_retention_blocks":"50000",
      "max_posted_data_bytes":"131072","max_posted_data_bytes_per_block":"1048576",
      "posted_data_fee_per_byte":"2","posted_data_retention_blocks":"100000","min_submitter_bond":"1000000"}}"#;
    let mock = Mock::fixed(vec![("/qorechain/rdk/v1/params", body.into())]).await;
    let m = msg::rdk::update_params_from_current(
        &mock.rest(),
        GOV,
        &msg::rdk::RdkParamsUpdate {
            max_rollups: Some(200),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(m.max_rollups, 200);
    assert_eq!(m.finalized_batch_retention_blocks, 50_000);
    assert_eq!(m.posted_data_fee_per_byte, 2);
    assert_eq!(m.min_submitter_bond, 1_000_000);
    let partial = msg::rdk::RdkParamsUpdate {
        max_rollups: Some(1),
        ..Default::default()
    };
    let e = msg::rdk::update_params(GOV, &partial)
        .unwrap_err()
        .to_string();
    assert!(e.contains("min_submitter_bond"), "{e}");
}

// --------------------------------------------------------------------------- //
// 4. Cross-VM
// --------------------------------------------------------------------------- //

#[test]
fn async_gas_terms_are_checked() {
    let m = msg::crossvm::cross_vm_call_async(
        ACCOUNT,
        "evm",
        "cosmwasm",
        "qor1c",
        b"{}".to_vec(),
        vec![],
        300_000,
        2_000_000,
    )
    .unwrap();
    assert!(m.r#async);
    assert_eq!(m.async_gas_limit, 300_000);
    assert_eq!(m.async_max_factor, 2_000_000);
    for bad in [1, 249_999, 10_000_001] {
        assert!(msg::crossvm::cross_vm_call_async(
            ACCOUNT,
            "evm",
            "cosmwasm",
            "qor1c",
            vec![],
            vec![],
            bad,
            0
        )
        .is_err());
    }
    assert!(
        msg::crossvm::cross_vm_call_async(ACCOUNT, "evm", "evm", "0x1", vec![], vec![], 0, 0)
            .is_err()
    );
    // Synchronous / non-CosmWasm calls refuse the fields.
    assert!(msg::crossvm::validate_async_gas("cosmwasm", false, 300_000, 0).is_err());
    assert!(msg::crossvm::validate_async_gas("svm", true, 0, 1_000_000).is_err());
    msg::crossvm::validate_async_gas("evm", false, 0, 0).unwrap();
}

fn xvm(gas: &str) -> CrossVm {
    let acct = qorechain::derive_native_account(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        0,
    )
    .unwrap();
    CrossVm {
        sender: acct.address.clone(),
        private_key: acct.private_key.to_vec(),
        public_key: acct.public_key.to_vec(),
        chain_id: CHAIN.into(),
        account_number: 1,
        sequence: 0,
        fee: Fee {
            amount: vec![],
            gas: gas.into(),
            granter: String::new(),
            payer: String::new(),
        },
        rest_url: "http://127.0.0.1:9".into(),
        mode: qorechain::BroadcastMode::Sync,
        qor: None,
    }
}

#[test]
fn cross_vm_build_carries_async_terms_and_refuses_fixed_gas() {
    let opts =
        CallOptions::new(VM_TYPE_COSMWASM, "qor1c", json!({"ping": {}})).async_gas(400_000, 0);
    let built = xvm("900000").build_call(&opts).unwrap();
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    let raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    let body = TxBody::decode(raw.body_bytes.as_slice()).unwrap();
    let call = xpb::MsgCrossVmCall::decode(body.messages[0].value.as_slice()).unwrap();
    assert!(call.r#async);
    assert_eq!(call.async_gas_limit, 400_000);

    // Gas terms on a synchronous call are refused.
    let mut sync = opts.clone();
    sync.queue = false;
    assert!(xvm("900000").build_call(&sync).is_err());
    // An EVM target cannot take them either.
    let evm = CallOptions::new(VM_TYPE_EVM, "0x1", vec![1u8]).async_gas(300_000, 0);
    assert!(xvm("900000").build_call(&evm).is_err());
    // No fixed / missing gas, and "auto" needs the async path.
    for gas in ["", "0", "auto"] {
        assert!(
            xvm(gas).build_call(&opts).is_err(),
            "gas {gas:?} must be refused"
        );
    }
}

#[tokio::test]
async fn cross_vm_auto_gas_simulates_with_wasm_headroom() {
    let mock = Mock::start(Arc::new(|path: &str, _: &str| {
        if path.ends_with("/simulate") {
            (200, r#"{"gas_info":{"gas_used":"100000"}}"#.into())
        } else if path.ends_with("/txs") {
            (200, r#"{"tx_response":{"code":0,"txhash":"AB"}}"#.into())
        } else {
            (404, "{}".into())
        }
    }))
    .await;
    let mut x = xvm("auto");
    x.rest_url = mock.base_url.clone();
    let opts = CallOptions::new(VM_TYPE_COSMWASM, "qor1c", json!({"ping": {}}));
    let built = x
        .build_atomic_auto(std::slice::from_ref(&opts))
        .await
        .unwrap();
    use cosmrs::proto::cosmos::tx::v1beta1::{AuthInfo, TxRaw};
    let raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    let auth = AuthInfo::decode(raw.auth_info_bytes.as_slice()).unwrap();
    // Classical tx: the default 1.4 multiplier, above the 1.3 wasm floor.
    assert_eq!(auth.fee.as_ref().unwrap().gas_limit, 140_000);
    assert_eq!(auth.fee.unwrap().amount[0].amount, "21000");
    let resp = x.call(&opts).await.unwrap();
    assert_eq!(resp["tx_response"]["txhash"], "AB");
}

#[test]
fn wasm_and_cross_vm_need_simulated_gas() {
    assert!(needs_simulated_gas([
        "/cosmwasm.wasm.v1.MsgExecuteContract"
    ]));
    assert!(needs_simulated_gas([
        "/qorechain.crossvm.v1.MsgCrossVMCall"
    ]));
    assert!(!needs_simulated_gas(["/cosmos.bank.v1beta1.MsgSend"]));
    assert!(refuse_fixed_gas_for(["/cosmwasm.wasm.v1.MsgMigrateContract"]).is_err());
    refuse_fixed_gas_for(["/cosmos.bank.v1beta1.MsgSend"]).unwrap();
}

#[tokio::test]
async fn exact_hybrid_rule_is_raised_to_1_3_for_wasm() {
    use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
    let body = TxBody {
        messages: vec![cosmrs::Any {
            type_url: "/cosmwasm.wasm.v1.MsgExecuteContract".into(),
            value: vec![],
        }],
        extension_options: vec![cosmrs::Any {
            type_url: qorechain::HYBRID_SIG_TYPE_URL.into(),
            value: vec![8, 1],
        }],
        ..Default::default()
    };
    let tx = TxRaw {
        body_bytes: body.encode_to_vec(),
        auth_info_bytes: vec![],
        signatures: vec![vec![0; 64]],
    }
    .encode_to_vec();
    let mock = Mock::start(Arc::new(|path: &str, _: &str| {
        if path.ends_with("/simulate") {
            (200, r#"{"gas_info":{"gas_used":"533000"}}"#.into())
        } else if path.contains("/applied_plan/") {
            (200, r#"{"height":"10"}"#.into())
        } else {
            (404, "{}".into())
        }
    }))
    .await;
    let est = qorechain::tx::estimate_gas_wanted(&mock.base_url, &tx, 0.0)
        .await
        .unwrap();
    assert_eq!(est.gas_wanted, 692_900);
    assert!(!est.exact);
}

#[tokio::test]
async fn pending_query_follows_next_key() {
    // A JSON-RPC mock: page 1 (no key) -> 2 messages + next_key "k2";
    // page 2 (key "k2") -> 1 message, no next_key.
    let mock = Mock::start(Arc::new(|_: &str, body: &str| {
        let v: Value = serde_json::from_str(body).unwrap();
        let data = hex::decode(v["params"]["data"].as_str().unwrap()).unwrap();
        let req = xpb::QueryPendingMessagesRequest::decode(data.as_slice()).unwrap();
        let page = req.pagination.unwrap();
        assert_eq!(page.limit, 100);
        let view = |id: &str| xpb::CrossVmMessageView {
            id: id.into(),
            ..Default::default()
        };
        use cosmrs::proto::cosmos::base::query::v1beta1::PageResponse;
        let resp = if page.key.is_empty() {
            xpb::QueryPendingMessagesResponse {
                messages: vec![view("1"), view("2")],
                count: 2,
                pagination: Some(PageResponse {
                    next_key: b"k2".to_vec(),
                    total: 0,
                }),
            }
        } else {
            assert_eq!(page.key, b"k2");
            xpb::QueryPendingMessagesResponse {
                messages: vec![view("3")],
                count: 1,
                pagination: Some(PageResponse::default()),
            }
        };
        let out = json!({"jsonrpc":"2.0","id":v["id"].clone(),"result":{"response":{
            "code":0,"value": BASE64.encode(resp.encode_to_vec())}}});
        (200, out.to_string())
    }))
    .await;
    let q = TypedQueryClient::new(mock.base_url.clone());
    let all = q.crossvm_pending_messages().await.unwrap();
    let ids: Vec<_> = all.messages.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["1", "2", "3"]);
    assert_eq!(all.count, 3);
    assert_eq!(mock.paths.lock().unwrap().len(), 2);
}

// --------------------------------------------------------------------------- //
// 5. EVM window grants
// --------------------------------------------------------------------------- //

#[test]
fn evm_window_scope_fields() {
    let valoper =
        bech32::encode::<bech32::Bech32>(bech32::Hrp::parse("qorvaloper").unwrap(), &[1u8; 20])
            .unwrap();
    let scope = EvmWindowScope {
        native_only: false,
        allowed_targets: vec![],
        validators: vec!["0x00000000000000000000000000000000000000aa".into()],
        staking_validators: vec![valoper.clone()],
        ibc_receivers: vec!["channel-0/cosmos1abc".into()],
    };
    let m = msg::pqc::open_evm_window_with_scope(ACCOUNT, 100, 5, "1000", &scope).unwrap();
    assert_eq!(m.validators, scope.validators);
    assert_eq!(m.staking_validators, vec![valoper.clone()]);
    assert_eq!(m.ibc_receivers, vec!["channel-0/cosmos1abc".to_string()]);
    let any = msg::pqc::open_evm_window_with_scope_any(ACCOUNT, 100, 5, "1000", &scope).unwrap();
    assert_eq!(any.type_url, msg::pqc::OPEN_EVM_WINDOW);
    // An unscoped window keeps the new fields off the wire.
    let plain = msg::pqc::open_evm_window(ACCOUNT, 100, 5, "1000").unwrap();
    assert!(plain.validators.is_empty() && plain.ibc_receivers.is_empty());

    for bad in [
        EvmWindowScope {
            validators: vec!["0x12".into()],
            ..Default::default()
        },
        EvmWindowScope {
            staking_validators: vec![ACCOUNT.into()],
            ..Default::default()
        },
        EvmWindowScope {
            ibc_receivers: vec!["cosmos1abc".into()],
            ..Default::default()
        },
        EvmWindowScope {
            ibc_receivers: vec!["channel-0/a,b".into()],
            ..Default::default()
        },
        EvmWindowScope {
            staking_validators: vec![valoper.clone(), valoper.clone()],
            ..Default::default()
        },
    ] {
        assert!(validate_evm_window_scope(&bad).is_err(), "{bad:?}");
    }
}

// --------------------------------------------------------------------------- //
// 6. Gas caps
// --------------------------------------------------------------------------- //

#[test]
fn cosmos_gas_cap_is_enforced_before_signing() {
    let acct = qorechain::derive_native_account(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        0,
    )
    .unwrap();
    let params = |gas: u64| SendMessagesParams {
        private_key: acct.private_key.to_vec(),
        public_key: acct.public_key.to_vec(),
        messages: vec![],
        chain_id: CHAIN.into(),
        account_number: 1,
        sequence: 0,
        fee: Fee {
            amount: vec![],
            gas: gas.to_string(),
            granter: String::new(),
            payer: String::new(),
        },
        memo: String::new(),
        timeout_height: 0,
    };
    send_messages(params(MAX_COSMOS_TX_GAS)).unwrap();
    assert!(send_messages(params(MAX_COSMOS_TX_GAS + 1)).is_err());
}

#[tokio::test]
async fn evm_gas_cap_and_limits_query() {
    validate_evm_gas_limit(DEFAULT_EVM_TX_MAX_GAS, None).unwrap();
    assert!(validate_evm_gas_limit(DEFAULT_EVM_TX_MAX_GAS + 1, None).is_err());
    assert!(validate_evm_gas_limit(20_000_001, Some(20_000_000)).is_err());
    assert!(
        evm_auth_sign_bytes_v2(CHAIN, ACCOUNT, &[1; 32], "0x", "0", &[], 0, 30_000_001).is_err()
    );
    evm_auth_sign_bytes_v2(CHAIN, ACCOUNT, &[1; 32], "0x", "0", &[], 0, 30_000_000).unwrap();

    let top = parse_evm_limits(&json!({"limits": null, "tx_max_gas": "30000000",
        "precompile_input_max_bytes": "131072"}))
    .unwrap();
    assert_eq!(top.tx_max_gas, 30_000_000);
    let nested = parse_evm_limits(&json!({"limits": {"tx_max_gas": "25000000",
        "precompile_input_max_bytes": "65536"}}))
    .unwrap();
    assert_eq!(nested.tx_max_gas, 25_000_000);
    assert_eq!(nested.precompile_input_max_bytes, 65_536);

    let mock = Mock::fixed(vec![(
        "/qorechain/pqc/v1/evm_limits",
        r#"{"tx_max_gas":"30000000","precompile_input_max_bytes":"131072"}"#.into(),
    )])
    .await;
    let l = fetch_evm_limits(&mock.rest()).await.unwrap();
    assert_eq!(l.precompile_input_max_bytes, 131_072);
}

// --------------------------------------------------------------------------- //
// 8. Minimum gas price (opt-in)
// --------------------------------------------------------------------------- //

#[tokio::test]
async fn min_gas_price_is_read_exactly() {
    let mock = Mock::fixed(vec![(
        "/cosmos/evm/feemarket/v1/params",
        r#"{"params":{"min_gas_price":"200000000000.000000000000000000"}}"#.into(),
    )])
    .await;
    let min = fetch_min_gas_price_uqor(&mock.rest()).await.unwrap();
    assert_eq!(min.to_string(), "0.2uqor");
    let rec = recommended_gas_price_uqor(&mock.rest(), "1.5")
        .await
        .unwrap();
    assert_eq!(rec.to_string(), "0.3uqor");
    assert_eq!(
        GasPrice::parse(&rec.to_string()).unwrap(),
        rec,
        "round-trips through GasPrice::parse"
    );

    // Below the floor: the floors apply.
    let low = Mock::fixed(vec![(
        "/cosmos/evm/feemarket/v1/params",
        r#"{"params":{"min_gas_price":"1000.5"}}"#.into(),
    )])
    .await;
    assert_eq!(
        fetch_min_gas_price_uqor(&low.rest())
            .await
            .unwrap()
            .to_string(),
        "0.1uqor"
    );
    assert_eq!(
        recommended_gas_price_uqor(&low.rest(), "1.5")
            .await
            .unwrap()
            .to_string(),
        "0.15uqor"
    );
    let odd =
        recommended_gas_price_from_min(&GasPrice::parse("0.123uqor").unwrap(), "1.5").unwrap();
    assert_eq!(odd.to_string(), "0.1845uqor");
    assert!(recommended_gas_price_from_min(&odd, "x").is_err());
}
