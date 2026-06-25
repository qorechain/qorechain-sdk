//! Composer tests: every custom-module type URL is produced exactly, a custom
//! message round-trips through `Any`, a tx carries a custom message, and the
//! hybrid B0 exclude-extension property holds with a custom message.

use cosmrs::proto::cosmos::base::v1beta1::Coin as ProtoCoin;
use cosmrs::proto::cosmos::tx::v1beta1::{TxBody, TxRaw};
use cosmrs::proto::traits::Message as ProstMessage;

use qorechain::accounts::derive_native_account;
use qorechain::msg;
use qorechain::pqc::{
    generate_pqc_keypair, pqc_verify, HYBRID_SIG_TYPE_URL, MLDSA87_SIGNATURE_LEN,
};
use qorechain::tx::{
    bank_send, build_hybrid_tx, send_messages, BuildHybridTxParams, Coin, Fee,
    Message as TxMessage, SendMessagesParams,
};

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_CHAIN_ID: &str = "qorechain-diana";

fn coin(amount: &str) -> ProtoCoin {
    ProtoCoin {
        denom: "uqor".into(),
        amount: amount.into(),
    }
}

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

/// The full set of 49 custom-module type URLs, paired with an `Any` produced by
/// the matching `*_any` composer. Asserts every exact string AND that the
/// composer emits it.
#[test]
fn all_custom_type_urls_are_produced() {
    let addr = "qor1example00000000000000000000000000000000";
    let cases: Vec<(&str, cosmrs::Any)> = vec![
        // amm (7)
        (
            "/qorechain.amm.v1.MsgCreatePool",
            msg::amm::create_pool_any(addr, "weighted", coin("1"), coin("1"), 0),
        ),
        (
            "/qorechain.amm.v1.MsgAddLiquidity",
            msg::amm::add_liquidity_any(addr, 1, coin("1"), coin("1"), "1"),
        ),
        (
            "/qorechain.amm.v1.MsgRemoveLiquidity",
            msg::amm::remove_liquidity_any(addr, 1, "1", "1", "1"),
        ),
        (
            "/qorechain.amm.v1.MsgSwapExactIn",
            msg::amm::swap_exact_in_any(addr, 1, coin("1"), "uqor", "1"),
        ),
        (
            "/qorechain.amm.v1.MsgSwapExactOut",
            msg::amm::swap_exact_out_any(addr, 1, "uqor", coin("1"), "1"),
        ),
        (
            "/qorechain.amm.v1.MsgPausePool",
            msg::amm::pause_pool_any(addr, 1, "r"),
        ),
        (
            "/qorechain.amm.v1.MsgResumePool",
            msg::amm::resume_pool_any(addr, 1),
        ),
        // bridge (4)
        (
            "/qorechain.bridge.v1.MsgBridgeDeposit",
            msg::bridge::bridge_deposit_any(addr, "eth", "0x", "QOR", "1", vec![], vec![]),
        ),
        (
            "/qorechain.bridge.v1.MsgBridgeWithdraw",
            msg::bridge::bridge_withdraw_any(addr, "eth", "0xabc", "QOR", "1"),
        ),
        (
            "/qorechain.bridge.v1.MsgRegisterBridgeValidator",
            msg::bridge::register_bridge_validator_any(addr, vec![], vec!["eth".into()]),
        ),
        (
            "/qorechain.bridge.v1.MsgBridgeAttestation",
            msg::bridge::bridge_attestation_any(
                addr,
                "eth",
                "deposit",
                "op1",
                "0x",
                "1",
                "QOR",
                vec![],
                vec![],
            ),
        ),
        // rdk (7)
        (
            "/qorechain.rdk.v1.MsgCreateRollup",
            msg::rdk::create_rollup_any(addr, "r1", "default", "evm", 1),
        ),
        (
            "/qorechain.rdk.v1.MsgSubmitBatch",
            msg::rdk::submit_batch_any(addr, "r1", 0, vec![], vec![], 0, vec![], vec![]),
        ),
        (
            "/qorechain.rdk.v1.MsgChallengeBatch",
            msg::rdk::challenge_batch_any(addr, "r1", 0, vec![]),
        ),
        (
            "/qorechain.rdk.v1.MsgResolveChallenge",
            msg::rdk::resolve_challenge_any(addr, "r1", 0, true),
        ),
        (
            "/qorechain.rdk.v1.MsgPauseRollup",
            msg::rdk::pause_rollup_any(addr, "r1", "r"),
        ),
        (
            "/qorechain.rdk.v1.MsgResumeRollup",
            msg::rdk::resume_rollup_any(addr, "r1"),
        ),
        (
            "/qorechain.rdk.v1.MsgStopRollup",
            msg::rdk::stop_rollup_any(addr, "r1"),
        ),
        // multilayer (6)
        (
            "/qorechain.multilayer.v1.MsgRegisterSidechain",
            msg::multilayer::register_sidechain_any(addr, "l1", "d", 0, 0, 0, 0, vec![], vec![]),
        ),
        (
            "/qorechain.multilayer.v1.MsgRegisterPaychain",
            msg::multilayer::register_paychain_any(addr, "l1", "d", 0, 0, "1"),
        ),
        (
            "/qorechain.multilayer.v1.MsgAnchorState",
            msg::multilayer::anchor_state_any(addr, "l1", 0, vec![], vec![], vec![], 0, vec![]),
        ),
        (
            "/qorechain.multilayer.v1.MsgRouteTransaction",
            msg::multilayer::route_transaction_any(addr, vec![], "l1", 0, "1"),
        ),
        (
            "/qorechain.multilayer.v1.MsgUpdateLayerStatus",
            msg::multilayer::update_layer_status_any(addr, "l1", "active", "r"),
        ),
        (
            "/qorechain.multilayer.v1.MsgChallengeAnchor",
            msg::multilayer::challenge_anchor_any(addr, "l1", 0, vec![], "r"),
        ),
        // pqc (5)
        (
            "/qorechain.pqc.v1.MsgRegisterPQCKey",
            msg::pqc::register_pqc_key_any(addr, vec![], vec![], "dilithium5"),
        ),
        (
            "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
            msg::pqc::register_pqc_key_v2_any(addr, vec![], 1, vec![], "dilithium5"),
        ),
        (
            "/qorechain.pqc.v1.MsgMigratePQCKey",
            msg::pqc::migrate_pqc_key_any(addr, vec![], vec![], 1, vec![], vec![]),
        ),
        (
            "/qorechain.pqc.v1.MsgDeprecateAlgorithm",
            msg::pqc::deprecate_algorithm_any(addr, 1, 0, 2),
        ),
        (
            "/qorechain.pqc.v1.MsgDisableAlgorithm",
            msg::pqc::disable_algorithm_any(addr, 1, "r"),
        ),
        // svm (4)
        (
            "/qorechain.svm.v1.MsgDeployProgram",
            msg::svm::deploy_program_any(addr, vec![]),
        ),
        (
            "/qorechain.svm.v1.MsgCreateAccount",
            msg::svm::create_account_any(addr, vec![0u8; 32], 0, 0, vec![]),
        ),
        (
            "/qorechain.svm.v1.MsgExecuteProgram",
            msg::svm::execute_program_any(addr, vec![0u8; 32], vec![], vec![]),
        ),
        (
            "/qorechain.svm.v1.MsgRegisterSVMPQCKey",
            msg::svm::register_svm_pqc_key_any(addr, vec![0u8; 32], vec![]),
        ),
        // lightnode (4)
        (
            "/qorechain.lightnode.v1.MsgRegisterLightNode",
            msg::lightnode::register_light_node_any(addr, "full", "1.0", vec![]),
        ),
        (
            "/qorechain.lightnode.v1.MsgHeartbeat",
            msg::lightnode::heartbeat_any(addr),
        ),
        (
            "/qorechain.lightnode.v1.MsgDeregisterLightNode",
            msg::lightnode::deregister_light_node_any(addr),
        ),
        (
            "/qorechain.lightnode.v1.MsgClaimLightNodeRewards",
            msg::lightnode::claim_light_node_rewards_any(addr),
        ),
        // license (4)
        (
            "/qorechain.license.v1.MsgGrantLicense",
            msg::license::grant_license_any(addr, addr, "f", 0, ""),
        ),
        (
            "/qorechain.license.v1.MsgRevokeLicense",
            msg::license::revoke_license_any(addr, addr, "f"),
        ),
        (
            "/qorechain.license.v1.MsgSuspendLicense",
            msg::license::suspend_license_any(addr, addr, "f"),
        ),
        (
            "/qorechain.license.v1.MsgResumeLicense",
            msg::license::resume_license_any(addr, addr, "f"),
        ),
        // abstractaccount (2)
        (
            "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
            msg::abstractaccount::create_abstract_account_any(addr, "smart"),
        ),
        (
            "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
            msg::abstractaccount::update_spending_rules_any(addr, addr, vec![]),
        ),
        // crossvm (2)
        (
            "/qorechain.crossvm.v1.MsgCrossVMCall",
            msg::crossvm::cross_vm_call_any(
                addr,
                "VM_TYPE_EVM",
                "VM_TYPE_SVM",
                "c",
                vec![],
                vec![],
            ),
        ),
        (
            "/qorechain.crossvm.v1.MsgProcessQueue",
            msg::crossvm::process_queue_any(addr),
        ),
        // rlconsensus (4)
        (
            "/qorechain.rlconsensus.v1.MsgSetAgentMode",
            msg::rlconsensus::set_agent_mode_any(addr, 1),
        ),
        (
            "/qorechain.rlconsensus.v1.MsgResumeAgent",
            msg::rlconsensus::resume_agent_any(addr),
        ),
        (
            "/qorechain.rlconsensus.v1.MsgUpdatePolicy",
            msg::rlconsensus::update_policy_any(addr, "{}"),
        ),
        (
            "/qorechain.rlconsensus.v1.MsgUpdateRewardWeights",
            msg::rlconsensus::update_reward_weights_any(addr, "1", "1", "1", "1", "1"),
        ),
    ];

    assert_eq!(
        cases.len(),
        49,
        "exactly 49 custom messages must be covered"
    );
    for (want_url, any) in &cases {
        assert_eq!(&any.type_url, want_url, "type URL mismatch");
        assert!(
            !any.value.is_empty()
                || want_url.ends_with("MsgProcessQueue")
                || want_url.ends_with("MsgResumeAgent")
                || want_url.ends_with("MsgHeartbeat")
                || want_url.ends_with("MsgDeregisterLightNode")
                || want_url.ends_with("MsgClaimLightNodeRewards"),
            "expected non-empty value for {want_url}"
        );
    }

    // Every type URL is unique.
    let mut urls: Vec<&str> = cases.iter().map(|(u, _)| *u).collect();
    urls.sort_unstable();
    let before = urls.len();
    urls.dedup();
    assert_eq!(before, urls.len(), "type URLs must be unique");
}

/// A custom message encodes into an `Any` and decodes back (prost round-trip).
#[test]
fn custom_msg_round_trips_through_any() {
    let m = msg::amm::swap_exact_in(
        "qor1sender0000000000000000000000000000000000",
        42,
        coin("1000"),
        "uatom",
        "990",
    );
    let any = msg::to_any(&m, msg::amm::SWAP_EXACT_IN);
    assert_eq!(any.type_url, "/qorechain.amm.v1.MsgSwapExactIn");

    let decoded: qorechain::proto::qorechain::amm::v1::MsgSwapExactIn =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.sender, m.sender);
    assert_eq!(decoded.pool_id, 42);
    assert_eq!(decoded.token_in.as_ref().unwrap().amount, "1000");
    assert_eq!(decoded.denom_out, "uatom");
    assert_eq!(decoded.min_out, "990");
}

/// A tx carrying a custom message builds and signs (via `send_messages`), and the
/// custom message survives the body round-trip.
#[test]
fn tx_carries_custom_message() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let any = msg::amm::swap_exact_in_any(acc.address.clone(), 7, coin("500"), "uatom", "490");

    let built = send_messages(SendMessagesParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        messages: vec![any],
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 1,
        sequence: 0,
        fee: sample_fee(),
        memo: String::new(),
        timeout_height: 0,
    })
    .unwrap();

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    assert_eq!(tx_raw.signatures.len(), 1);
    assert_eq!(tx_raw.signatures[0].len(), 64);
    let body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    assert_eq!(body.messages.len(), 1);
    assert_eq!(
        body.messages[0].type_url,
        "/qorechain.amm.v1.MsgSwapExactIn"
    );
    let decoded: qorechain::proto::qorechain::amm::v1::MsgSwapExactIn =
        prost::Message::decode(body.messages[0].value.as_slice()).unwrap();
    assert_eq!(decoded.pool_id, 7);
}

/// The hybrid B0 exclude-extension property holds with a custom message: the
/// signed bytes frame the body WITHOUT the PQC extension.
#[test]
fn hybrid_tx_b0_excludes_extension_with_custom_message() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let kp = generate_pqc_keypair().unwrap();
    let any = msg::amm::swap_exact_in_any(acc.address.clone(), 3, coin("100"), "uatom", "99");

    let built = build_hybrid_tx(BuildHybridTxParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        pqc_secret_key: kp.secret_key.clone(),
        pqc_public_key: kp.public_key.clone(),
        messages: vec![TxMessage {
            type_url: any.type_url.clone(),
            value: any.value.clone(),
        }],
        fee: sample_fee(),
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 9,
        sequence: 2,
        memo: String::new(),
        timeout_height: 0,
        include_pqc_public_key: false,
    })
    .unwrap();

    assert_eq!(built.pqc_signature.len(), MLDSA87_SIGNATURE_LEN);
    assert!(pqc_verify(
        &kp.public_key,
        &built.pqc_signed_message,
        &built.pqc_signature
    ));

    let tx_raw = TxRaw::decode(built.tx_raw_bytes.as_slice()).unwrap();
    let final_body = TxBody::decode(tx_raw.body_bytes.as_slice()).unwrap();
    assert_eq!(final_body.extension_options.len(), 1);
    assert_eq!(
        final_body.extension_options[0].type_url,
        HYBRID_SIG_TYPE_URL
    );
    // The custom message is still in the body.
    assert_eq!(
        final_body.messages[0].type_url,
        "/qorechain.amm.v1.MsgSwapExactIn"
    );

    // Strip the extension, re-encode B0', re-frame, and assert it equals the
    // signed message — the exclude-extension contract.
    let mut stripped = final_body.clone();
    stripped.extension_options.clear();
    let b0_prime = stripped.encode_to_vec();
    let mut reframed = Vec::new();
    reframed.extend_from_slice(&(b0_prime.len() as u32).to_be_bytes());
    reframed.extend_from_slice(&b0_prime);
    reframed.extend_from_slice(&(tx_raw.auth_info_bytes.len() as u32).to_be_bytes());
    reframed.extend_from_slice(&tx_raw.auth_info_bytes);
    assert_eq!(reframed, built.pqc_signed_message);

    // Framing over the WITH-ext body must differ.
    let mut with_ext = Vec::new();
    with_ext.extend_from_slice(&(tx_raw.body_bytes.len() as u32).to_be_bytes());
    with_ext.extend_from_slice(&tx_raw.body_bytes);
    with_ext.extend_from_slice(&(tx_raw.auth_info_bytes.len() as u32).to_be_bytes());
    with_ext.extend_from_slice(&tx_raw.auth_info_bytes);
    assert_ne!(with_ext, built.pqc_signed_message);
}

/// bank_send still works (regression guard for the tx module refactor).
#[test]
fn bank_send_still_builds() {
    let acc = derive_native_account(TEST_MNEMONIC, 0).unwrap();
    let built = bank_send(qorechain::tx::BankSendParams {
        private_key: acc.private_key.clone(),
        public_key: acc.public_key.clone(),
        from_address: acc.address.clone(),
        to_address: "qor1recipient00000000000000000000000000000".into(),
        amount: vec![Coin {
            denom: "uqor".into(),
            amount: "1".into(),
        }],
        chain_id: TEST_CHAIN_ID.into(),
        account_number: 0,
        sequence: 0,
        fee: sample_fee(),
        memo: String::new(),
        timeout_height: 0,
    })
    .unwrap();
    assert!(!built.tx_raw_bytes.is_empty());
}
