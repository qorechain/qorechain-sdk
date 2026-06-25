//! Utils tests: known hash vectors, exact unit strings, address validators.

use qorechain::utils::{
    format_units, hash160, is_valid_evm_address, is_valid_svm_address, keccak256, parse_units,
    ripemd160, sha256, to_checksum_address,
};

#[test]
fn sha256_known_vector() {
    // SHA-256("abc")
    assert_eq!(
        hex::encode(sha256(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn keccak256_known_vector() {
    // Keccak-256("") (EVM empty hash)
    assert_eq!(
        hex::encode(keccak256(b"")),
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
}

#[test]
fn ripemd160_known_vector() {
    // RIPEMD-160("abc")
    assert_eq!(
        hex::encode(ripemd160(b"abc")),
        "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"
    );
}

#[test]
fn hash160_is_ripemd_of_sha() {
    assert_eq!(hash160(b"abc"), ripemd160(&sha256(b"abc")));
    assert_eq!(hash160(b"abc").len(), 20);
}

#[test]
fn parse_units_exact() {
    assert_eq!(parse_units("1.5", 18).unwrap(), "1500000000000000000");
    assert_eq!(parse_units("1", 6).unwrap(), "1000000");
    assert_eq!(parse_units("0.000001", 6).unwrap(), "1");
    assert_eq!(parse_units("0", 6).unwrap(), "0");
    assert_eq!(parse_units("123", 0).unwrap(), "123");
    assert!(parse_units("1.1234567", 6).is_err()); // too many decimals
    assert!(parse_units("-1", 6).is_err());
    assert!(parse_units("1e3", 6).is_err());
}

#[test]
fn format_units_exact() {
    assert_eq!(format_units("1500000000000000000", 18).unwrap(), "1.5");
    assert_eq!(format_units("1000000", 6).unwrap(), "1");
    assert_eq!(format_units("1", 6).unwrap(), "0.000001");
    assert_eq!(format_units("0", 6).unwrap(), "0");
    assert_eq!(format_units("123", 0).unwrap(), "123");
    assert!(format_units("-1", 6).is_err());
    assert!(format_units("1.5", 6).is_err());
}

#[test]
fn parse_format_round_trip() {
    let base = parse_units("12.345", 6).unwrap();
    assert_eq!(base, "12345000");
    assert_eq!(format_units(&base, 6).unwrap(), "12.345");
}

#[test]
fn evm_address_validation() {
    assert!(is_valid_evm_address(
        "0x52908400098527886E0F7030069857D2E4169EE7"
    ));
    assert!(!is_valid_evm_address("0x123")); // too short
    assert!(!is_valid_evm_address(
        "52908400098527886E0F7030069857D2E4169EE7"
    )); // no 0x
    assert!(!is_valid_evm_address(
        "0xZZ908400098527886E0F7030069857D2E4169EE7"
    )); // non-hex
}

#[test]
fn checksum_address_eip55() {
    // EIP-55 reference vectors.
    assert_eq!(
        to_checksum_address("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed").unwrap(),
        "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
    );
    assert_eq!(
        to_checksum_address("0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359").unwrap(),
        "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"
    );
}

#[test]
fn svm_address_validation() {
    // 32 zero bytes base58 → "11111111111111111111111111111111".
    let valid = bs58::encode(vec![0u8; 32]).into_string();
    assert!(is_valid_svm_address(&valid));
    assert!(!is_valid_svm_address("not-base58-!@#"));
    // 31 bytes → invalid length.
    let short = bs58::encode(vec![1u8; 31]).into_string();
    assert!(!is_valid_svm_address(&short));
}
