//! Gas / fee + error-decoding tests (pure, no network).

use qorechain::tx::{calculate_fee, decode_tx_error, GasPrice};

#[test]
fn parse_gas_price() {
    let p = GasPrice::parse("0.025uqor").unwrap();
    assert_eq!(p.denom, "uqor");
    assert_eq!(p.scaled, 25);
    assert_eq!(p.scale, 3);

    let p2 = GasPrice::parse("1uqor").unwrap();
    assert_eq!(p2.scaled, 1);
    assert_eq!(p2.scale, 0);

    assert!(GasPrice::parse("uqor").is_err());
    assert!(GasPrice::parse("0.025").is_err());
}

#[test]
fn calculate_fee_from_simulated_gas() {
    // gas_used = 100_000, multiplier 1.4 → fee_gas = 140_000.
    // amount = ceil(140_000 * 0.025) = 3500 uqor.
    let price = GasPrice::parse("0.025uqor").unwrap();
    let fee = calculate_fee(100_000, 1.4, &price);
    assert_eq!(fee.gas, "140000");
    assert_eq!(fee.amount.len(), 1);
    assert_eq!(fee.amount[0].denom, "uqor");
    assert_eq!(fee.amount[0].amount, "3500");
}

#[test]
fn calculate_fee_rounds_up() {
    // gas 1 * 1.0 = 1, amount = ceil(1 * 0.025) = 1.
    let price = GasPrice::parse("0.025uqor").unwrap();
    let fee = calculate_fee(1, 1.0, &price);
    assert_eq!(fee.gas, "1");
    assert_eq!(fee.amount[0].amount, "1");
}

#[test]
fn calculate_fee_default_multiplier() {
    // multiplier <= 0 falls back to 1.4.
    let price = GasPrice::parse("0.025uqor").unwrap();
    let fee = calculate_fee(100_000, 0.0, &price);
    assert_eq!(fee.gas, "140000");
}

#[test]
fn decode_tx_error_success_is_none() {
    assert!(decode_tx_error(0, "", "").is_none());
    assert!(decode_tx_error(0, "amm", "x").is_none());
}

#[test]
fn decode_tx_error_sdk_codes() {
    let e = decode_tx_error(5, "", "out of money").unwrap();
    assert_eq!(e.code, 5);
    assert_eq!(e.reason, "insufficient funds");
    assert_eq!(e.raw_log, "out of money");

    let e2 = decode_tx_error(13, "sdk", "").unwrap();
    assert_eq!(e2.reason, "insufficient fee");

    let unknown = decode_tx_error(9999, "", "").unwrap();
    assert_eq!(unknown.reason, "unknown error");
}

#[test]
fn decode_tx_error_module_codespaces() {
    let bank = decode_tx_error(5, "bank", "").unwrap();
    assert_eq!(bank.reason, "send transactions are disabled");

    // Unmapped code in a known module → generic per-module fallback.
    let amm = decode_tx_error(7, "amm", "").unwrap();
    assert_eq!(amm.reason, "unknown amm error");

    // QoreChain module codespace fallback.
    let pqc = decode_tx_error(3, "pqc", "bad key").unwrap();
    assert_eq!(pqc.reason, "unknown pqc error");
    assert_eq!(pqc.code, 3);
}

#[test]
fn qore_tx_error_display() {
    let mut e = decode_tx_error(5, "bank", "log here").unwrap();
    e.tx_hash = "ABC".into();
    let s = e.to_string();
    assert!(s.contains("code 5"));
    assert!(s.contains("bank"));
    assert!(s.contains("ABC"));
    assert!(s.contains("log here"));
}
