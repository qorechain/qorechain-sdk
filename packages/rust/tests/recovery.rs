//! Seed-path PQC key: recovery codes, the second-secret requirement on
//! `unified_account_from_seed`, and the known-answer vectors shared by every
//! QoreChain SDK language and the wallet adapter.

use qorechain::error::Error;
use qorechain::recovery::{
    generate_pqc_recovery_code, is_valid_recovery_code, pqc_key_from_recovery_code,
    pqc_recovery_code_from_secret,
};
use qorechain::unified::{unified_account_from_seed, SeedPqcOptions};
use sha2::{Digest, Sha256};

const SEED_01: [u8; 32] = [0x01; 32];
const SECRET_07: [u8; 32] = [0x07; 32];
const ADDR_01: &str = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
const CODE_07: &str = "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK";
const PK_SHA_RECOVERY: &str = "cf50dca6c9a0d86eeac9d6a50ee54e567e2126184143be694b8df1f31c8e23ef";
const PK_SHA_LEGACY: &str = "3710d198ff5d3206601e9dfd7e0e4bac0656de0fee28f5a20b39e05c81e46bd0";

fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

#[test]
fn kat_code_from_secret() {
    assert_eq!(pqc_recovery_code_from_secret(&SECRET_07), CODE_07);
    assert!(is_valid_recovery_code(CODE_07));
}

#[test]
fn kat_seed_with_recovery_code() {
    let acct = unified_account_from_seed(SEED_01, SeedPqcOptions::recovery_code(CODE_07)).unwrap();
    assert_eq!(acct.cosmos, ADDR_01);
    assert_eq!(acct.pqc.public_key.len(), 2592);
    assert_eq!(sha256_hex(&acct.pqc.public_key), PK_SHA_RECOVERY);
}

#[test]
fn kat_seed_with_pqc_secret_matches_recovery_code() {
    let acct = unified_account_from_seed(SEED_01, SeedPqcOptions::pqc_secret(SECRET_07)).unwrap();
    assert_eq!(acct.cosmos, ADDR_01);
    assert_eq!(sha256_hex(&acct.pqc.public_key), PK_SHA_RECOVERY);
}

#[test]
fn kat_pqc_key_from_recovery_code() {
    let kp = pqc_key_from_recovery_code(CODE_07, ADDR_01).unwrap();
    assert_eq!(sha256_hex(&kp.public_key), PK_SHA_RECOVERY);
    // The address is read case-insensitively.
    let kp_upper = pqc_key_from_recovery_code(CODE_07, &ADDR_01.to_uppercase()).unwrap();
    assert_eq!(kp_upper.public_key, kp.public_key);
}

#[test]
fn kat_seed_legacy_derivation() {
    let acct =
        unified_account_from_seed(SEED_01, SeedPqcOptions::legacy_seed_derivation()).unwrap();
    assert_eq!(acct.cosmos, ADDR_01);
    assert_eq!(sha256_hex(&acct.pqc.public_key), PK_SHA_LEGACY);
}

#[test]
fn lowercase_code_with_spaces_and_confusables_decodes() {
    // Lowercase, spaces instead of dashes, and O / I / L typed for 0 / 1.
    let typed = CODE_07
        .to_lowercase()
        .replace('-', " ")
        .replace('0', "o")
        .replace('1', "l");
    assert!(typed.contains('o') && typed.contains('l'));
    assert!(is_valid_recovery_code(&typed));
    let typed_i = CODE_07.replace('1', "I");
    assert!(is_valid_recovery_code(&typed_i));
    let kp = pqc_key_from_recovery_code(&typed, ADDR_01).unwrap();
    assert_eq!(sha256_hex(&kp.public_key), PK_SHA_RECOVERY);
    // Without the prefix too.
    assert!(is_valid_recovery_code(&CODE_07[5..]));
}

#[test]
fn one_changed_character_fails_the_checksum() {
    // Change the first data character ('0' -> '1').
    let bad = CODE_07.replacen("QRC1-0W3G", "QRC1-1W3G", 1);
    assert!(!is_valid_recovery_code(&bad));
    let err = pqc_key_from_recovery_code(&bad, ADDR_01).unwrap_err();
    assert!(err.to_string().contains("checksum"), "{err}");
    let err = unified_account_from_seed(SEED_01, SeedPqcOptions::recovery_code(bad)).unwrap_err();
    assert!(err.to_string().contains("checksum"), "{err}");
}

#[test]
fn malformed_codes_are_refused() {
    assert!(!is_valid_recovery_code(""));
    assert!(!is_valid_recovery_code("QRC1-0W3G"));
    // 'U' is not in the alphabet.
    assert!(!is_valid_recovery_code(&CODE_07.replacen('W', "U", 1)));
    // '*' is not either.
    assert!(!is_valid_recovery_code(&CODE_07.replacen('W', "*", 1)));
}

#[test]
fn address_must_be_qor1() {
    for bad in [
        "",
        "cosmos1rfjz7r3u8t65teavh5utquj3kwvsj983c5xr6c",
        "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1",
        "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zab", // bad bech32 checksum
    ] {
        let err = pqc_key_from_recovery_code(CODE_07, bad).unwrap_err();
        assert!(matches!(err, Error::Address(_)), "{bad}: {err:?}");
    }
}

#[test]
fn no_option_is_an_error() {
    let err = unified_account_from_seed(SEED_01, SeedPqcOptions::default()).unwrap_err();
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
    let msg = err.to_string();
    assert!(msg.contains("recovery_code"), "{msg}");
    assert!(msg.contains("pqc_secret"), "{msg}");
    assert!(msg.contains("legacy_seed_derivation"), "{msg}");
}

#[test]
fn two_options_are_an_error() {
    let both = SeedPqcOptions {
        recovery_code: Some(CODE_07.to_string()),
        pqc_secret: Some(SECRET_07),
        legacy_seed_derivation: false,
    };
    let err = unified_account_from_seed(SEED_01, both).unwrap_err();
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
    let code_and_legacy = SeedPqcOptions {
        legacy_seed_derivation: true,
        ..SeedPqcOptions::recovery_code(CODE_07)
    };
    assert!(unified_account_from_seed(SEED_01, code_and_legacy).is_err());
}

#[test]
fn pqc_secret_equal_to_seed_is_refused() {
    let err = unified_account_from_seed(SEED_01, SeedPqcOptions::pqc_secret(SEED_01)).unwrap_err();
    assert!(matches!(err, Error::InvalidInput(_)), "{err:?}");
    assert!(err.to_string().contains("independent of seed32"), "{err}");
    // The same 32 bytes given as a recovery code are refused too.
    let code = pqc_recovery_code_from_secret(&SEED_01);
    let err = unified_account_from_seed(SEED_01, SeedPqcOptions::recovery_code(code)).unwrap_err();
    assert!(err.to_string().contains("independent of seed32"), "{err}");
}

#[test]
fn generated_codes_give_a_key_unrelated_to_the_seed() {
    let code = generate_pqc_recovery_code().unwrap();
    assert!(is_valid_recovery_code(&code));
    let a =
        unified_account_from_seed(SEED_01, SeedPqcOptions::recovery_code(code.clone())).unwrap();
    let legacy =
        unified_account_from_seed(SEED_01, SeedPqcOptions::legacy_seed_derivation()).unwrap();
    assert_ne!(a.pqc.public_key, legacy.pqc.public_key);
    assert_eq!(
        pqc_key_from_recovery_code(&code, &a.cosmos)
            .unwrap()
            .public_key,
        a.pqc.public_key
    );
}
