//! Client support for chain v3.2.3: registration integrity, proof of
//! possession, the EVM window scope, the abstract-account v2 digest.

use prost::Message as _;
use serde_json::json;
use sha3::digest::{ExtendableOutput, Update, XofReader};

use qorechain::authenticator::{evm_auth_sign_bytes, evm_auth_sign_bytes_v2};
use qorechain::evm_window::{parse_evm_window, MAX_EVM_WINDOW_TARGETS};
use qorechain::key_integrity::{
    is_degenerate_pqc_public_key, proof_of_possession_sign_bytes, sign_proof_of_possession,
    validate_registered_pqc_key, verify_proof_of_possession, KEY_TYPE_CLASSICAL_ONLY,
};
use qorechain::msg::license::{update_authority_any, UPDATE_AUTHORITY};
use qorechain::msg::pqc::{open_evm_window, open_evm_window_scoped};
use qorechain::pqc::pqc_keypair_from_seed;
use qorechain::tx::decode_tx_error;

const SENDER: &str = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq";
const TARGET: &str = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B";

fn shake16(data: &[u8]) -> String {
    let mut h = sha3::Shake256::default();
    h.update(data);
    let mut out = [0u8; 16];
    h.finalize_xof().read(&mut out);
    hex::encode(out)
}

#[test]
fn registration_integrity() {
    let kp = pqc_keypair_from_seed(&[1u8; 32]);
    assert!(validate_registered_pqc_key(KEY_TYPE_CLASSICAL_ONLY, &kp.public_key).is_err());
    assert!(validate_registered_pqc_key("hybrid", &[]).is_err());
    let mut degenerate = kp.public_key[..32].to_vec();
    degenerate.resize(2592, 0);
    assert!(is_degenerate_pqc_public_key(&degenerate));
    assert!(validate_registered_pqc_key("hybrid", &degenerate).is_err());
    assert!(!is_degenerate_pqc_public_key(&kp.public_key));
    assert!(validate_registered_pqc_key("hybrid", &kp.public_key).is_ok());
}

#[test]
fn proof_of_possession() {
    let kp = pqc_keypair_from_seed(&[1u8; 32]);
    let bytes =
        proof_of_possession_sign_bytes("qorechain-diana", 1, SENDER, &[0xab, 0xcd]).unwrap();
    assert_eq!(
        bytes,
        format!("qorechain-pqc-pop-v1|qorechain-diana|1|{SENDER}|abcd").into_bytes()
    );
    let a = sign_proof_of_possession("qorechain-diana", SENDER, &kp.public_key, &kp.secret_key)
        .unwrap();
    let b = sign_proof_of_possession("qorechain-diana", SENDER, &kp.public_key, &kp.secret_key)
        .unwrap();
    assert_eq!(a, b);
    assert_eq!(a.len(), 4627);
    // Same vector as every other SDK.
    assert_eq!(shake16(&a), "5b767a00efb7ad721f5416a4bd7fcdad");
    assert!(verify_proof_of_possession(
        "qorechain-diana",
        SENDER,
        &kp.public_key,
        &a
    ));
    assert!(!verify_proof_of_possession(
        "qorechain-vladi",
        SENDER,
        &kp.public_key,
        &a
    ));
}

#[test]
fn evm_window_scope() {
    let scoped = open_evm_window_scoped(SENDER, 10, 1, "1", true, vec![TARGET.into()]).unwrap();
    assert!(scoped.native_only);
    assert_eq!(scoped.allowed_targets, vec![TARGET.to_string()]);
    let plain = open_evm_window(SENDER, 10, 1, "1").unwrap();
    assert!(plain.encode_to_vec().len() < scoped.encode_to_vec().len());
    assert!(open_evm_window_scoped(SENDER, 10, 1, "1", false, vec!["0x12".into()]).is_err());
    assert!(open_evm_window_scoped(
        SENDER,
        10,
        1,
        "1",
        false,
        vec![TARGET.into(), TARGET.to_lowercase()]
    )
    .is_err());
    let many: Vec<String> = (0..=MAX_EVM_WINDOW_TARGETS)
        .map(|i| format!("0x{i:040x}"))
        .collect();
    assert!(open_evm_window_scoped(SENDER, 10, 1, "1", false, many).is_err());

    let w = parse_evm_window(
        &json!({"found": true, "live": true, "native_only": true, "allowed_targets": [TARGET]}),
    )
    .unwrap();
    assert!(w.native_only);
    assert_eq!(w.allowed_targets, vec![TARGET.to_string()]);
}

#[test]
fn aa_digest_matches_chain() {
    // Computed with the chain's own EVMAuthSignBytes / EVMAuthSignBytesV2.
    let pubkey =
        hex::decode("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74").unwrap();
    let data = hex::decode("a9059cbb").unwrap();
    let acct = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";
    let to = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
    assert_eq!(
        hex::encode(evm_auth_sign_bytes(
            "qorechain-diana",
            acct,
            &pubkey,
            to,
            "1000",
            &data,
            7
        )),
        "c2614c477a15020777adb1e889748557debc6dece7207ded95d30ee6d7bd778a"
    );
    assert_eq!(
        hex::encode(
            evm_auth_sign_bytes_v2(
                "qorechain-diana",
                acct,
                &pubkey,
                to,
                "1000",
                &data,
                7,
                250_000
            )
            .unwrap()
        ),
        "19d7518ad25079dff616819b7554d7d39700fb9e4331a6cbc635685122f0c18b"
    );
    assert!(
        evm_auth_sign_bytes_v2("qorechain-diana", acct, &pubkey, to, "1000", &data, 7, 0).is_err()
    );
}

#[test]
fn v323_codes_and_messages() {
    for code in 230..=234 {
        let reason = decode_tx_error(code, "pqc", "").unwrap().reason;
        assert!(!reason.starts_with("unknown"), "{code}: {reason}");
    }
    assert_eq!(
        update_authority_any("qor1gov", "qor1new").type_url,
        UPDATE_AUTHORITY
    );
}
