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
use qorechain::signbytes::SignBytesVersion;
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

/// A fully-populated `SVMParams` for the governance `MsgUpdateParams` composer.
fn sample_svm_params() -> msg::svm::SvmParams {
    msg::svm::SvmParams {
        max_program_size: 1_048_576,
        max_account_data_size: 10_485_760,
        compute_budget_max: 1_400_000,
        lamports_per_byte: 6_960,
        rent_exemption_multi: "2.0".into(),
        enabled: true,
        svm_slot_offset: 0,
        default_sig_scheme: 1,
        max_cpi: 4,
    }
}

/// The full set of 59 custom-module type URLs, paired with an `Any` produced by
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
        // bridge admin (3)
        (
            "/qorechain.bridge.v1.MsgUpdateEthLightClient",
            msg::bridge::update_eth_light_client_any(addr, vec![1, 2, 3]),
        ),
        (
            "/qorechain.bridge.v1.MsgUpdateChainConfig",
            msg::bridge::update_chain_config_any(
                addr,
                "eth",
                "0xcontract",
                12,
                "evm",
                "active",
                "light_client",
                "0xtopic0",
            ),
        ),
        (
            "/qorechain.bridge.v1.MsgSetVerifierBootstrap",
            msg::bridge::set_verifier_bootstrap_any(
                addr,
                "eth",
                Some(msg::bridge::WormholeGuardianSet {
                    addresses: vec![vec![0u8; 20]],
                    quorum: 1,
                }),
                None,
                None,
                None,
                vec![],
            ),
        ),
        // rdk (8)
        (
            "/qorechain.rdk.v1.MsgCreateRollup",
            msg::rdk::create_rollup_any(addr, "r1", "default", "evm", 1),
        ),
        (
            "/qorechain.rdk.v1.MsgSubmitBatch",
            msg::rdk::submit_batch_any(addr, "r1", 0, vec![], vec![], 0, vec![], vec![], vec![]),
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
        (
            "/qorechain.rdk.v1.MsgExecuteWithdrawal",
            msg::rdk::execute_withdrawal_any(
                addr,
                "r1",
                0,
                0,
                addr,
                "uqor",
                1,
                vec![vec![0u8; 32]],
            ),
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
        // pqc (6)
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
        (
            "/qorechain.pqc.v1.MsgRotatePQCKey",
            msg::pqc::rotate_pqc_key_any(
                addr,
                vec![1u8; 4],
                vec![2u8; 4],
                vec![3u8; 4],
                vec![4u8; 4],
            ),
        ),
        (
            "/qorechain.pqc.v1.MsgOpenEVMWindow",
            msg::pqc::open_evm_window_any(addr, 300, 5, "2000000").unwrap(),
        ),
        (
            "/qorechain.pqc.v1.MsgCloseEVMWindow",
            msg::pqc::close_evm_window_any(addr),
        ),
        // svm (5)
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
        (
            "/qorechain.svm.v1.MsgUpdateParams",
            msg::svm::update_params_any(addr, sample_svm_params()),
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
        // abstractaccount (4)
        (
            "/qorechain.abstractaccount.v1.MsgCreateAbstractAccount",
            msg::abstractaccount::create_abstract_account_any(addr, "smart"),
        ),
        (
            "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
            msg::abstractaccount::update_spending_rules_any(addr, addr, vec![]),
        ),
        (
            "/qorechain.abstractaccount.v1.MsgExecuteEVM",
            msg::abstractaccount::execute_evm_any(
                addr,
                addr,
                "ed25519",
                vec![1u8; 32],
                vec![9u8; 64],
                "0xabc",
                "1000",
                vec![2, 2, 2],
                100_000,
                5,
            ),
        ),
        (
            "/qorechain.abstractaccount.v1.MsgExecuteCosmos",
            msg::abstractaccount::execute_cosmos_any(
                addr,
                addr,
                "ed25519",
                vec![1u8; 32],
                vec![9u8; 64],
                addr,
                vec![coin("100")],
                3,
            ),
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
                false,
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
        59,
        "exactly 59 custom messages must be covered"
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

/// `MsgExecuteWithdrawal` round-trips through `Any`, including the repeated-bytes
/// `proof` field.
#[test]
fn execute_withdrawal_round_trips_through_any() {
    let proof = vec![vec![1u8; 32], vec![2u8; 32], vec![3u8; 32]];
    let m = msg::rdk::execute_withdrawal(
        "qor1submitter000000000000000000000000000000",
        "rollup-1",
        7,
        3,
        "qor1recipient00000000000000000000000000000",
        "uqor",
        12345,
        proof.clone(),
    );
    let any = msg::to_any(&m, msg::rdk::EXECUTE_WITHDRAWAL);
    assert_eq!(any.type_url, "/qorechain.rdk.v1.MsgExecuteWithdrawal");

    let decoded: qorechain::proto::qorechain::rdk::v1::MsgExecuteWithdrawal =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.submitter, m.submitter);
    assert_eq!(decoded.rollup_id, "rollup-1");
    assert_eq!(decoded.batch_index, 7);
    assert_eq!(decoded.withdrawal_index, 3);
    assert_eq!(decoded.recipient, m.recipient);
    assert_eq!(decoded.denom, "uqor");
    assert_eq!(decoded.amount, 12345);
    assert_eq!(decoded.proof, proof);
}

/// `MsgExecuteEVM` round-trips through `Any`, preserving the authenticator lane
/// fields (scheme/pubkey/signature/to/value/data/gas/nonce).
#[test]
fn execute_evm_round_trips_through_any() {
    let m = msg::abstractaccount::execute_evm(
        "qor1relayer00000000000000000000000000000000",
        "qor1account00000000000000000000000000000000",
        "ed25519",
        vec![1u8; 32],
        vec![9u8; 64],
        "0xdeadbeef",
        "1000",
        vec![2, 2, 2],
        100_000,
        5,
    );
    let any = msg::to_any(&m, msg::abstractaccount::EXECUTE_EVM);
    assert_eq!(any.type_url, "/qorechain.abstractaccount.v1.MsgExecuteEVM");

    let decoded: qorechain::proto::qorechain::abstractaccount::v1::MsgExecuteEvm =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.relayer, m.relayer);
    assert_eq!(decoded.account, m.account);
    assert_eq!(decoded.scheme, "ed25519");
    assert_eq!(decoded.pubkey, vec![1u8; 32]);
    assert_eq!(decoded.signature, vec![9u8; 64]);
    assert_eq!(decoded.to, "0xdeadbeef");
    assert_eq!(decoded.value, "1000");
    assert_eq!(decoded.data, vec![2, 2, 2]);
    assert_eq!(decoded.gas_limit, 100_000);
    assert_eq!(decoded.nonce, 5);
}

/// `MsgExecuteCosmos` round-trips through `Any`, including the repeated `Coin`
/// `amount` field.
#[test]
fn execute_cosmos_round_trips_through_any() {
    let m = msg::abstractaccount::execute_cosmos(
        "qor1relayer00000000000000000000000000000000",
        "qor1account00000000000000000000000000000000",
        "secp256k1",
        vec![7u8; 20],
        vec![8u8; 65],
        "qor1recipient00000000000000000000000000000",
        vec![coin("100")],
        3,
    );
    let any = msg::to_any(&m, msg::abstractaccount::EXECUTE_COSMOS);
    assert_eq!(
        any.type_url,
        "/qorechain.abstractaccount.v1.MsgExecuteCosmos"
    );

    let decoded: qorechain::proto::qorechain::abstractaccount::v1::MsgExecuteCosmos =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.relayer, m.relayer);
    assert_eq!(decoded.account, m.account);
    assert_eq!(decoded.scheme, "secp256k1");
    assert_eq!(decoded.pubkey, vec![7u8; 20]);
    assert_eq!(decoded.signature, vec![8u8; 65]);
    assert_eq!(decoded.to, m.to);
    assert_eq!(decoded.amount.len(), 1);
    assert_eq!(decoded.amount[0].denom, "uqor");
    assert_eq!(decoded.amount[0].amount, "100");
    assert_eq!(decoded.nonce, 3);
}

/// `MsgRotatePQCKey` round-trips through `Any`, preserving both key/signature pairs.
#[test]
fn rotate_pqc_key_round_trips_through_any() {
    let m = msg::pqc::rotate_pqc_key(
        "qor1sender0000000000000000000000000000000000",
        vec![0xaa; 8],
        vec![0xbb; 8],
        vec![0xcc; 16],
        vec![0xdd; 16],
    );
    let any = msg::to_any(&m, msg::pqc::ROTATE_PQC_KEY);
    assert_eq!(any.type_url, "/qorechain.pqc.v1.MsgRotatePQCKey");

    let decoded: qorechain::proto::qorechain::pqc::v1::MsgRotatePqcKey =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.sender, m.sender);
    assert_eq!(decoded.old_public_key, vec![0xaa; 8]);
    assert_eq!(decoded.new_public_key, vec![0xbb; 8]);
    assert_eq!(decoded.old_signature, vec![0xcc; 16]);
    assert_eq!(decoded.new_signature, vec![0xdd; 16]);
}

/// `MsgUpdateParams` (svm governance) round-trips through `Any`, preserving every
/// `SVMParams` field — the message replaces the parameters wholesale, so a field
/// lost in transit would silently reset a runtime limit.
#[test]
fn svm_update_params_round_trips_through_any() {
    const GOV: &str = "qor10d07y265gmmuvt4z0w9aw880jnsr700j6z2nqt";
    let params = sample_svm_params();
    let m = msg::svm::update_params(GOV, params.clone());
    let any = msg::to_any(&m, msg::svm::UPDATE_PARAMS);
    assert_eq!(any.type_url, "/qorechain.svm.v1.MsgUpdateParams");
    assert_eq!(msg::svm::UPDATE_PARAMS, "/qorechain.svm.v1.MsgUpdateParams");

    let decoded: qorechain::proto::qorechain::svm::v1::MsgUpdateParams =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.authority, GOV);
    let got = decoded.params.expect("params must be present");
    assert_eq!(got.max_program_size, params.max_program_size);
    assert_eq!(got.max_account_data_size, params.max_account_data_size);
    assert_eq!(got.compute_budget_max, params.compute_budget_max);
    assert_eq!(got.lamports_per_byte, params.lamports_per_byte);
    assert_eq!(got.rent_exemption_multi, params.rent_exemption_multi);
    assert!(got.enabled);
    assert_eq!(got.svm_slot_offset, params.svm_slot_offset);
    assert_eq!(got.default_sig_scheme, params.default_sig_scheme);
    assert_eq!(got.max_cpi, params.max_cpi);

    // `enabled = false` is what closes the SVM lane by governance; it must
    // survive the round-trip even though `false` is the proto default and is
    // therefore absent from the wire.
    let off = msg::svm::update_params_any(
        GOV,
        msg::svm::SvmParams {
            enabled: false,
            ..sample_svm_params()
        },
    );
    let decoded_off: qorechain::proto::qorechain::svm::v1::MsgUpdateParams =
        msg::from_any(&off).expect("decode");
    assert!(!decoded_off.params.expect("params").enabled);
}

/// `MsgUpdateEthLightClient` round-trips through `Any`.
#[test]
fn update_eth_light_client_round_trips_through_any() {
    let m = msg::bridge::update_eth_light_client(
        "qor1relayer00000000000000000000000000000000",
        vec![9, 8, 7, 6],
    );
    let any = msg::to_any(&m, msg::bridge::UPDATE_ETH_LIGHT_CLIENT);
    assert_eq!(any.type_url, "/qorechain.bridge.v1.MsgUpdateEthLightClient");

    let decoded: qorechain::proto::qorechain::bridge::v1::MsgUpdateEthLightClient =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.relayer, m.relayer);
    assert_eq!(decoded.update, vec![9, 8, 7, 6]);
}

/// `MsgUpdateChainConfig` round-trips through `Any` (all scalar fields).
#[test]
fn update_chain_config_round_trips_through_any() {
    let m = msg::bridge::update_chain_config(
        "qor1admin000000000000000000000000000000000",
        "ethereum",
        "0xBridgeContract",
        12,
        "evm",
        "active",
        "light_client",
        "0xddf252ad",
    );
    let any = msg::to_any(&m, msg::bridge::UPDATE_CHAIN_CONFIG);
    assert_eq!(any.type_url, "/qorechain.bridge.v1.MsgUpdateChainConfig");

    let decoded: qorechain::proto::qorechain::bridge::v1::MsgUpdateChainConfig =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.admin, m.admin);
    assert_eq!(decoded.chain_id, "ethereum");
    assert_eq!(decoded.bridge_contract, "0xBridgeContract");
    assert_eq!(decoded.confirmations_required, 12);
    assert_eq!(decoded.architecture, "evm");
    assert_eq!(decoded.status, "active");
    assert_eq!(decoded.verifier, "light_client");
    assert_eq!(decoded.lock_event_sig, "0xddf252ad");
}

/// `MsgSetVerifierBootstrap` round-trips through `Any`, including a populated
/// nested verifier sub-message.
#[test]
fn set_verifier_bootstrap_round_trips_through_any() {
    let m = msg::bridge::set_verifier_bootstrap(
        "qor1admin000000000000000000000000000000000",
        "ethereum",
        Some(msg::bridge::WormholeGuardianSet {
            addresses: vec![vec![0xaa; 20], vec![0xbb; 20]],
            quorum: 2,
        }),
        None,
        None,
        None,
        vec![],
    );
    let any = msg::to_any(&m, msg::bridge::SET_VERIFIER_BOOTSTRAP);
    assert_eq!(any.type_url, "/qorechain.bridge.v1.MsgSetVerifierBootstrap");

    let decoded: qorechain::proto::qorechain::bridge::v1::MsgSetVerifierBootstrap =
        msg::from_any(&any).expect("decode");
    assert_eq!(decoded.admin, m.admin);
    assert_eq!(decoded.chain_id, "ethereum");
    let wh = decoded.wormhole.expect("wormhole set");
    assert_eq!(wh.quorum, 2);
    assert_eq!(wh.addresses.len(), 2);
    assert_eq!(wh.addresses[0], vec![0xaa; 20]);
    assert!(decoded.ed25519.is_none());
    assert!(decoded.bls.is_none());
    assert!(decoded.bitcoin.is_none());
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
        sign_bytes_version: Some(SignBytesVersion::V1),
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
