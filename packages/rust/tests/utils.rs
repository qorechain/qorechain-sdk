//! denom, address, and networks edge-case tests.

use qorechain::address::{
    bech32_to_hex, bytes_to_bech32, hex_to_bech32, is_valid_bech32, DEFAULT_PREFIX,
};
use qorechain::denom::{from_base, to_base, DEFAULT_EXPONENT};
use qorechain::networks::{evm_chain_id, get_network, list_networks};

#[test]
fn to_base_exact_integer_math() {
    assert_eq!(to_base("1", 6).unwrap(), "1000000");
    assert_eq!(to_base("1.5", 6).unwrap(), "1500000");
    assert_eq!(to_base("0.1", 6).unwrap(), "100000");
    assert_eq!(to_base("0.000001", 6).unwrap(), "1");
    assert_eq!(to_base("0", 6).unwrap(), "0");
    assert_eq!(to_base("0.0", 6).unwrap(), "0");
    assert_eq!(to_base(" +2.25 ", 6).unwrap(), "2250000");
    // Large magnitude - never drifts.
    assert_eq!(
        to_base("123456789012345.123456", 6).unwrap(),
        "123456789012345123456"
    );
    assert_eq!(DEFAULT_EXPONENT, 6);
}

#[test]
fn to_base_rejects_bad_input() {
    assert!(to_base("-1", 6).is_err());
    assert!(to_base("1.2.3", 6).is_err());
    assert!(to_base("abc", 6).is_err());
    assert!(to_base("", 6).is_err());
    assert!(to_base("1e6", 6).is_err());
    assert!(to_base("1,000", 6).is_err());
    // Over-precision: more fractional digits than the exponent allows.
    assert!(to_base("0.0000001", 6).is_err());
    assert!(to_base("1.", 6).is_err());
}

#[test]
fn from_base_normalizes() {
    assert_eq!(from_base("1000000", 6).unwrap(), "1");
    assert_eq!(from_base("1500000", 6).unwrap(), "1.5");
    assert_eq!(from_base("1", 6).unwrap(), "0.000001");
    assert_eq!(from_base("0", 6).unwrap(), "0");
    assert_eq!(
        from_base("123456789012345123456", 6).unwrap(),
        "123456789012345.123456"
    );
    assert_eq!(from_base("100", 0).unwrap(), "100");
}

#[test]
fn from_base_rejects_bad_input() {
    assert!(from_base("-1", 6).is_err());
    assert!(from_base("1.5", 6).is_err());
    assert!(from_base("abc", 6).is_err());
    assert!(from_base("", 6).is_err());
}

#[test]
fn round_trip_denom() {
    for v in ["0", "1", "1.5", "0.000001", "999999.999999"] {
        let base = to_base(v, 6).unwrap();
        let display = from_base(&base, 6).unwrap();
        let base2 = to_base(&display, 6).unwrap();
        assert_eq!(base, base2, "round-trip failed for {v}");
    }
}

#[test]
fn address_round_trip() {
    let bytes: Vec<u8> = (0u8..20).collect();
    let addr = bytes_to_bech32(&bytes, DEFAULT_PREFIX).unwrap();
    assert!(addr.starts_with("qor1"));

    let hex = bech32_to_hex(&addr).unwrap();
    assert!(hex.starts_with("0x"));

    let addr2 = hex_to_bech32(&hex, DEFAULT_PREFIX).unwrap();
    assert_eq!(addr, addr2);
}

#[test]
fn is_valid_bech32_checks_prefix() {
    let addr = bytes_to_bech32(&[1u8; 20], "qor").unwrap();
    assert!(is_valid_bech32(&addr, None));
    assert!(is_valid_bech32(&addr, Some("qor")));
    assert!(is_valid_bech32(&addr, Some("QOR"))); // case-insensitive
    assert!(!is_valid_bech32(&addr, Some("cosmos")));
    assert!(!is_valid_bech32("not-an-address", None));
    assert!(!is_valid_bech32("qor1invalidchecksumxxxxxxxx", Some("qor")));
}

#[test]
fn hex_to_bech32_rejects_bad_hex() {
    assert!(hex_to_bech32("0xZZ", "qor").is_err());
    assert!(hex_to_bech32("0x1", "qor").is_err()); // odd length
    assert!(hex_to_bech32("", "qor").is_err());
}

#[test]
fn presets_default_to_public_endpoints() {
    let testnet = get_network("testnet").unwrap();
    assert!(testnet.live);
    assert_eq!(testnet.chain_id.as_deref(), Some("qorechain-diana"));
    let eps = testnet.endpoints.clone().unwrap();
    assert!(eps.rest.starts_with("https://"));
    assert!(eps.rpc.starts_with("https://"));
    assert!(eps.evm_rpc.starts_with("https://"));
    assert!(eps.evm_ws.as_deref().unwrap().starts_with("wss://"));
    assert_eq!(eps.grpc, None);
    assert_eq!(eps.svm_rpc, None);
    assert_eq!(evm_chain_id("testnet"), Some(9800));
    assert_eq!(testnet.coin.display, "QOR");
    assert_eq!(testnet.coin.base, "uqor");
    assert_eq!(testnet.coin.exponent, 6);
    assert_eq!(testnet.bech32.account, "qor");
    assert_eq!(testnet.bech32.validator, "qorvaloper");

    let mainnet = get_network("mainnet").unwrap();
    assert!(mainnet.live);
    assert_eq!(mainnet.chain_id.as_deref(), Some("qorechain-vladi"));
    let meps = mainnet.endpoints.clone().unwrap();
    assert!(meps.rest.starts_with("https://"));
    assert!(meps.evm_rpc.starts_with("https://"));
    assert_eq!(meps.grpc, None);
    assert_eq!(meps.evm_ws, None);
    assert_eq!(meps.svm_rpc, None);
    assert_eq!(evm_chain_id("mainnet"), Some(9801));
    assert_ne!(meps.rest, eps.rest);
    assert_eq!(mainnet.coin.display, "QOR");
    assert_eq!(mainnet.bech32.account, "qor");
    assert_eq!(mainnet.bech32.validator, "qorvaloper");
    assert_eq!(mainnet.bech32.consensus, "qorvalcons");

    // An endpoint the preset does not serve is a clear error, never localhost.
    let err = mainnet.endpoint("evm_ws").unwrap_err().to_string();
    assert!(
        err.contains("evm_ws is not configured for the mainnet preset"),
        "{err}"
    );
    assert!(mainnet.endpoint("svm_rpc").is_err());
    assert!(testnet.endpoint("grpc").is_err());
    assert_eq!(mainnet.endpoint("rest").unwrap(), meps.rest);
    assert!(mainnet.endpoint("bogus").is_err());

    // localnet keeps the old localhost defaults.
    let local = get_network("localnet").unwrap();
    assert_eq!(local.chain_id.as_deref(), Some("qorechain-devnet"));
    let leps = local.endpoints.unwrap();
    assert_eq!(leps.rest, "http://localhost:1317");
    assert_eq!(leps.grpc.as_deref(), Some("http://localhost:9090"));
    assert_eq!(leps.rpc, "http://localhost:26657");
    assert_eq!(leps.evm_rpc, "http://localhost:8545");
    assert_eq!(leps.evm_ws.as_deref(), Some("ws://localhost:8546"));
    assert_eq!(leps.svm_rpc.as_deref(), Some("http://localhost:8899"));

    assert!(get_network("nonexistent").is_err());

    assert_eq!(list_networks(), vec!["testnet", "mainnet", "localnet"]);
}
