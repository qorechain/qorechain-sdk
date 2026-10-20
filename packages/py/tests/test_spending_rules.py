"""Spending rules are checked by the abstract-account composer before encoding."""

from __future__ import annotations

from typing import Any

import pytest

from qorsdk import MAX_ALLOWED_EVM_CALLS, MAX_DENOM_LIMITS, msg, validate_spending_rules
from qorsdk.proto.qorechain.abstractaccount.v1 import tx_pb2

OWNER = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"


def _msg(rules: list[dict[str, Any]]) -> Any:
    return msg.abstractaccount.update_spending_rules(
        owner=OWNER, account_address=OWNER, rules=rules
    )


def test_refuses_an_enabled_rule_with_no_bound_at_all():
    with pytest.raises(ValueError, match="bounds nothing"):
        _msg([{"enabled": True}])


@pytest.mark.parametrize(
    "amounts",
    [{"per_tx_limit": "", "daily_limit": ""}, {"per_tx_limit": "0", "daily_limit": "0"}, {}],
)
def test_refuses_a_denom_limit_with_empty_or_zero_amounts(amounts):
    with pytest.raises(ValueError, match="remove the limit for uqor"):
        _msg([{"enabled": True, "denom_limits": [{"denom": "uqor", **amounts}]}])
    # Also inside a rule bounded otherwise: the entry replaces the rule-level
    # limits for uqor.
    with pytest.raises(ValueError, match="remove the limit for uqor"):
        _msg(
            [
                {
                    "enabled": True,
                    "daily_limit": 100,
                    "denom_limits": [{"denom": "uqor", **amounts}],
                }
            ]
        )


def test_accepts_real_bounds():
    _msg([{"enabled": True, "daily_limit": 5}])
    _msg([{"enabled": True, "denom_limits": [{"denom": "uqor", "daily_limit": "5"}]}])
    _msg([{"enabled": True, "allowed_denoms": ["uqor"]}])
    _msg([{"enabled": True, "allowed_evm_calls": ["0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"]}])
    _msg(
        [
            {
                "enabled": True,
                "daily_limit": 100,
                "denom_limits": [{"denom": "uqor", "per_tx_limit": "7"}],
            }
        ]
    )
    # A disabled rule bounds nothing by design.
    built = _msg([{"enabled": False}])
    assert built.type_url == "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules"
    assert built.value.owner == OWNER


def test_checks_amounts_denoms_and_counts_like_the_chain():
    with pytest.raises(ValueError, match="non-negative"):
        validate_spending_rules([{"daily_limit": -1}])
    with pytest.raises(ValueError, match="per-tx limit must be non-negative"):
        _msg([{"enabled": True, "per_tx_limit": -1}])
    with pytest.raises(ValueError, match="non-negative decimal"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": "uqor", "daily_limit": "-5"}]}]
        )
    with pytest.raises(ValueError, match="non-negative decimal"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": "uqor", "daily_limit": "1.5"}]}]
        )
    with pytest.raises(ValueError, match="no denom"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": " ", "daily_limit": "1"}]}]
        )
    with pytest.raises(ValueError, match="contains whitespace"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": "u qor", "daily_limit": "1"}]}]
        )
    with pytest.raises(ValueError, match="too long"):
        validate_spending_rules(
            [{"enabled": True, "denom_limits": [{"denom": "u" * 257, "daily_limit": "1"}]}]
        )
    with pytest.raises(ValueError, match="more than one limit"):
        validate_spending_rules(
            [
                {
                    "enabled": True,
                    "denom_limits": [
                        {"denom": "uqor", "daily_limit": "1"},
                        {"denom": "UQOR", "per_tx_limit": "1"},
                    ],
                }
            ]
        )
    many = [{"denom": f"d{i}", "daily_limit": "1"} for i in range(MAX_DENOM_LIMITS + 1)]
    with pytest.raises(ValueError, match="at most 64 denom limits"):
        validate_spending_rules([{"enabled": True, "denom_limits": many}])
    calls = ["0x" + f"{i:040x}" for i in range(MAX_ALLOWED_EVM_CALLS + 1)]
    with pytest.raises(ValueError, match="at most 64 allowed EVM calls"):
        _msg([{"enabled": True, "allowed_evm_calls": calls}])


def test_names_the_rule_and_reads_protobuf_rules():
    with pytest.raises(ValueError, match="spending rule 1 is enabled but bounds nothing"):
        validate_spending_rules([{"enabled": True, "daily_limit": 5}, {"enabled": True}])
    rule = tx_pb2.SpendingRule(
        enabled=True, denom_limits=[tx_pb2.DenomLimit(denom="uqor", daily_limit="0")]
    )
    with pytest.raises(ValueError, match="remove the limit for uqor"):
        validate_spending_rules([rule])
    validate_spending_rules(None)
    validate_spending_rules([])
