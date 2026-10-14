//! Client support for chain v3.2.2: delegation consent, the ecdsa_pubkey rule,
//! upgrade detection and the new error reasons.

use k256::ecdsa::SigningKey;
use prost::Message as _;
use serde_json::json;

use qorechain::classical_key::{validate_classical_key_for_sender, ClassicalKeyMatch};
use qorechain::evm_delegation::{
    classify_evm_delegation_error, parse_evm_delegation_consent, EvmDelegationRefusal,
    EVM_DELEGATION_CLEAR, MAX_EVM_DELEGATION_CONSENT_BLOCKS,
};
use qorechain::msg::pqc::{
    authorize_evm_delegation, authorize_evm_delegation_any, clear_evm_delegation_any,
    AUTHORIZE_EVM_DELEGATION, CLEAR_EVM_DELEGATION,
};
use qorechain::msg::{bridge, multilayer};
use qorechain::proto::qorechain::pqc::v1::MsgAuthorizeEvmDelegation;
use qorechain::tx::decode_tx_error;
use qorechain::upgrades::parse_applied_height;
use qorechain::utils::{ripemd160, sha256};

const SENDER: &str = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
const DELEGATE: &str = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";

#[test]
fn authorize_evm_delegation_round_trips_lower_cased() {
    let any = authorize_evm_delegation_any(SENDER, DELEGATE, 600).unwrap();
    assert_eq!(any.type_url, AUTHORIZE_EVM_DELEGATION);
    let back = MsgAuthorizeEvmDelegation::decode(any.value.as_slice()).unwrap();
    assert_eq!(back.sender, SENDER);
    assert_eq!(back.delegate, DELEGATE.to_ascii_lowercase());
    assert_eq!(back.blocks, 600);
    assert!(authorize_evm_delegation(SENDER, EVM_DELEGATION_CLEAR, 1).is_ok());
}

#[test]
fn authorize_evm_delegation_enforces_bounds() {
    for (delegate, blocks) in [
        (DELEGATE, 0),
        (DELEGATE, MAX_EVM_DELEGATION_CONSENT_BLOCKS + 1),
        ("63c0c19a", 5),
        ("0x63c0", 5),
    ] {
        assert!(
            authorize_evm_delegation(SENDER, delegate, blocks).is_err(),
            "{delegate} {blocks}"
        );
    }
}

#[test]
fn new_message_type_urls() {
    assert_eq!(
        clear_evm_delegation_any(SENDER).type_url,
        CLEAR_EVM_DELEGATION
    );
    assert_eq!(
        bridge::update_circuit_breaker_limits_any("qor1", "ethereum", "0", "0").type_url,
        "/qorechain.bridge.v1.MsgUpdateCircuitBreakerLimits"
    );
    assert_eq!(
        multilayer::update_params_any(&Default::default()).type_url,
        "/qorechain.multilayer.v1.MsgUpdateParams"
    );
}

#[test]
fn consent_parse_and_tuple_nonce() {
    let c = parse_evm_delegation_consent(&json!({
        "found": true, "live": true,
        "delegate": DELEGATE.to_ascii_lowercase(),
        "granted_height": "6905100", "expiry_height": "6905700",
        "current_delegate": "", "nonce": "7"
    }))
    .unwrap();
    assert!(c.found && c.live);
    assert_eq!((c.expiry_height, c.nonce), (6_905_700, 7));
    assert_eq!(c.tuple_nonce(true), 7);
    assert_eq!(c.tuple_nonce(false), 8);
}

#[test]
fn classify_delegation_refusals() {
    assert_eq!(
        classify_evm_delegation_error(
            0,
            "",
            "no post-quantum consent for this EIP-7702 delegation: authority 0xabc"
        ),
        Some(EvmDelegationRefusal::NoConsent)
    );
    assert_eq!(
        classify_evm_delegation_error(61, "pqc", ""),
        Some(EvmDelegationRefusal::InvalidDelegation)
    );
    assert_eq!(classify_evm_delegation_error(26, "pqc", ""), None);
}

#[test]
fn classical_key_rule() {
    // Accepted on diana at h 7,911,828 with the v3.2.2 rule on (eth-native).
    let diana =
        hex::decode("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74").unwrap();
    assert_eq!(
        validate_classical_key_for_sender("qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k", &diana)
            .unwrap(),
        ClassicalKeyMatch::Eth
    );

    let sk = SigningKey::from_slice(&[0x11; 32]).unwrap();
    let pubkey = sk
        .verifying_key()
        .to_encoded_point(true)
        .as_bytes()
        .to_vec();
    let addr = bech32::encode::<bech32::Bech32>(
        bech32::Hrp::parse("qor").unwrap(),
        &ripemd160(&sha256(&pubkey)),
    )
    .unwrap();
    assert_eq!(
        validate_classical_key_for_sender(&addr, &pubkey).unwrap(),
        ClassicalKeyMatch::Cosmos
    );
    assert_eq!(
        validate_classical_key_for_sender(SENDER, &[]).unwrap(),
        ClassicalKeyMatch::Empty
    );

    let foreign = validate_classical_key_for_sender(SENDER, &pubkey)
        .unwrap_err()
        .to_string();
    assert!(foreign.contains("does not belong"), "{foreign}");
    let uncompressed = sk
        .verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec();
    let long = validate_classical_key_for_sender(SENDER, &uncompressed)
        .unwrap_err()
        .to_string();
    assert!(long.contains("33-byte"), "{long}");
}

#[test]
fn applied_height_parsing() {
    assert_eq!(
        parse_applied_height(&json!({"height": "6905034"})).unwrap(),
        6_905_034
    );
    // Mainnet's answer before the plan: a truthy string that means "no".
    assert_eq!(parse_applied_height(&json!({"height": "0"})).unwrap(), 0);
    assert!(parse_applied_height(&json!({"height": "x"})).is_err());
}

#[test]
fn decode_tx_error_v322() {
    let log = "sender qor1abc has sent 600 transactions in the last 30 blocks, at the configured limit of 600 per minute";
    let rl = qorechain::tx::errors::RATE_LIMITED_REASON;
    assert_eq!(decode_tx_error(3, "ai", log).unwrap().reason, rl);
    assert_eq!(decode_tx_error(3, "", log).unwrap().reason, rl);
    assert_ne!(
        decode_tx_error(3, "ai", "transaction rejected by AI engine")
            .unwrap()
            .reason,
        rl
    );
    assert_ne!(decode_tx_error(2, "ai", log).unwrap().reason, rl);
    assert!(decode_tx_error(60, "pqc", "")
        .unwrap()
        .reason
        .contains("EIP-7702"));
}

#[test]
fn decode_pqc_key_requirement() {
    use qorechain::tx::errors::{
        HYBRID_SIGNATURE_REQUIRED_REASON as H, PQC_KEY_REQUIRED_REASON as K,
    };
    assert_eq!(
        decode_tx_error(
            8,
            "pqc",
            "account has no PQC key and classical fallback is disabled"
        )
        .unwrap()
        .reason,
        K
    );
    assert_eq!(decode_tx_error(8, "pqc", "").unwrap().reason, K);
    assert_eq!(decode_tx_error(20, "pqc", "account qor1abc has no registered PQC key, so its hybrid extension cannot be verified; register the key first (hybrid mode: required)").unwrap().reason, K);
    assert_eq!(
        decode_tx_error(
            20,
            "pqc",
            "account qor1abc must include a PQC hybrid signature extension (hybrid mode: required)"
        )
        .unwrap()
        .reason,
        K
    );
    assert_eq!(decode_tx_error(20, "pqc", "account qor1abc has a registered PQC key and must include the hybrid signature extension (hybrid mode: required)").unwrap().reason, H);
    let bare = decode_tx_error(20, "pqc", "").unwrap().reason;
    assert!(bare != K && bare != H);
}
