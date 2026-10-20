//! `MsgUpdateSpendingRules`: an enabled rule must bound something, and a denom
//! limit must set an amount.

use qorechain::msg::abstractaccount::{
    update_spending_rules, update_spending_rules_checked, update_spending_rules_checked_any,
    validate_spending_rules, DenomLimit, SpendingRule, MAX_DENOM_LIMITS, UPDATE_SPENDING_RULES,
};
use qorechain::Error;

const OWNER: &str = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k";

fn msg(rules: Vec<SpendingRule>) -> qorechain::Result<()> {
    update_spending_rules_checked(OWNER, OWNER, rules).map(|_| ())
}

fn enabled() -> SpendingRule {
    SpendingRule {
        enabled: true,
        ..Default::default()
    }
}

fn limit(denom: &str, per_tx: &str, daily: &str) -> DenomLimit {
    DenomLimit {
        denom: denom.into(),
        per_tx_limit: per_tx.into(),
        daily_limit: daily.into(),
    }
}

fn err_text(r: qorechain::Result<()>) -> String {
    match r {
        Err(e @ Error::SpendingRule(_)) => e.to_string(),
        other => panic!("expected a spending-rule error, got {other:?}"),
    }
}

#[test]
fn refuses_an_enabled_rule_with_no_bound_at_all() {
    assert!(err_text(msg(vec![enabled()])).contains("bounds nothing"));
}

#[test]
fn refuses_a_denom_limit_with_empty_or_zero_amounts() {
    for (per_tx, daily) in [("", ""), ("0", "0"), ("", "0")] {
        let only = SpendingRule {
            denom_limits: vec![limit("uqor", per_tx, daily)],
            ..enabled()
        };
        assert!(err_text(msg(vec![only])).contains("remove the limit for uqor"));
        // Also inside a rule bounded otherwise: the entry replaces the
        // rule-level limits for uqor.
        let bounded = SpendingRule {
            daily_limit: 100,
            denom_limits: vec![limit("uqor", per_tx, daily)],
            ..enabled()
        };
        assert!(err_text(msg(vec![bounded])).contains("remove the limit for uqor"));
    }
}

#[test]
fn accepts_real_bounds() {
    let ok = [
        SpendingRule {
            daily_limit: 5,
            ..enabled()
        },
        SpendingRule {
            denom_limits: vec![limit("uqor", "", "5")],
            ..enabled()
        },
        SpendingRule {
            allowed_denoms: vec!["uqor".into()],
            ..enabled()
        },
        SpendingRule {
            allowed_evm_calls: vec!["0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B".into()],
            ..enabled()
        },
        SpendingRule {
            daily_limit: 100,
            denom_limits: vec![limit("uqor", "7", "")],
            ..enabled()
        },
        // A disabled rule bounds nothing by design.
        SpendingRule::default(),
    ];
    for rule in ok {
        msg(vec![rule.clone()]).unwrap_or_else(|e| panic!("{rule:?} refused: {e}"));
    }
}

#[test]
fn checks_amounts_denoms_and_counts_like_the_chain() {
    let check = |rule: SpendingRule| err_text(validate_spending_rules(&[rule]));
    assert!(check(SpendingRule {
        daily_limit: -1,
        ..Default::default()
    })
    .contains("non-negative"));
    assert!(check(SpendingRule {
        per_tx_limit: -1,
        ..Default::default()
    })
    .contains("non-negative"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit("uqor", "", "-5")],
        ..enabled()
    })
    .contains("non-negative decimal"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit("uqor", "", "1.5")],
        ..enabled()
    })
    .contains("non-negative decimal"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit(" ", "", "1")],
        ..enabled()
    })
    .contains("no denom"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit("u qor", "", "1")],
        ..enabled()
    })
    .contains("contains whitespace"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit(&"u".repeat(257), "", "1")],
        ..enabled()
    })
    .contains("too long"));
    assert!(check(SpendingRule {
        denom_limits: vec![limit("uqor", "", "1"), limit("UQOR", "1", "")],
        ..enabled()
    })
    .contains("more than one limit"));
    let many = (0..=MAX_DENOM_LIMITS)
        .map(|i| limit(&format!("d{i}"), "", "1"))
        .collect();
    assert!(check(SpendingRule {
        denom_limits: many,
        ..enabled()
    })
    .contains("at most 64"));
    let calls = (0..=64).map(|i| format!("0x{i:040x}")).collect();
    assert!(check(SpendingRule {
        allowed_evm_calls: calls,
        daily_limit: 1,
        ..enabled()
    })
    .contains("at most 64 allowed EVM calls"));
    // The error names the rule index.
    let second = err_text(validate_spending_rules(&[
        SpendingRule {
            daily_limit: 1,
            ..enabled()
        },
        enabled(),
    ]));
    assert!(second.starts_with("spending rule 1 "), "{second}");
}

#[test]
fn checked_any_packs_the_message_and_the_unchecked_builder_is_unchanged() {
    let any = update_spending_rules_checked_any(
        OWNER,
        OWNER,
        vec![SpendingRule {
            daily_limit: 5,
            ..enabled()
        }],
    )
    .unwrap();
    assert_eq!(any.type_url, UPDATE_SPENDING_RULES);
    assert!(update_spending_rules_checked_any(OWNER, OWNER, vec![enabled()]).is_err());
    // The unchecked builder still builds anything (kept for compatibility).
    assert_eq!(
        update_spending_rules(OWNER, OWNER, vec![enabled()])
            .rules
            .len(),
        1
    );
}
