package messages

import (
	"fmt"
	"strings"
	"testing"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
)

const spendingOwner = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"

func updateRules(rules ...abstractaccountv1.SpendingRule) error {
	_, err := NewUpdateSpendingRules(spendingOwner, spendingOwner, rules)
	return err
}

func wantErr(t *testing.T, err error, substr string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected an error containing %q, got nil", substr)
	}
	if !strings.Contains(err.Error(), substr) {
		t.Fatalf("expected an error containing %q, got %q", substr, err)
	}
}

func TestSpendingRulesRefuseAnEnabledRuleWithNoBound(t *testing.T) {
	wantErr(t, updateRules(abstractaccountv1.SpendingRule{Enabled: true}), "bounds nothing")
}

func TestSpendingRulesRefuseADenomLimitWithEmptyOrZeroAmounts(t *testing.T) {
	for _, amounts := range []abstractaccountv1.DenomLimit{
		{PerTxLimit: "", DailyLimit: ""},
		{PerTxLimit: "0", DailyLimit: "0"},
		{},
	} {
		dl := amounts
		dl.Denom = "uqor"
		wantErr(t, updateRules(abstractaccountv1.SpendingRule{
			Enabled: true, DenomLimits: []*abstractaccountv1.DenomLimit{&dl},
		}), "would remove the limit for uqor")
		// Also inside a rule bounded otherwise: the entry replaces the rule-level limits for uqor.
		wantErr(t, updateRules(abstractaccountv1.SpendingRule{
			Enabled: true, DailyLimit: 100, DenomLimits: []*abstractaccountv1.DenomLimit{&dl},
		}), "would remove the limit for uqor")
	}
}

func TestSpendingRulesAcceptRealBounds(t *testing.T) {
	ok := []abstractaccountv1.SpendingRule{
		{Enabled: true, DailyLimit: 5},
		{Enabled: true, DenomLimits: []*abstractaccountv1.DenomLimit{{Denom: "uqor", DailyLimit: "5"}}},
		{Enabled: true, AllowedDenoms: []string{"uqor"}},
		{Enabled: true, AllowedEvmCalls: []string{"0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"}},
		{Enabled: true, DailyLimit: 100, DenomLimits: []*abstractaccountv1.DenomLimit{{Denom: "uqor", PerTxLimit: "7"}}},
		// A disabled rule bounds nothing by design.
		{Enabled: false},
	}
	for i, rule := range ok {
		msg, err := NewUpdateSpendingRules(spendingOwner, spendingOwner, []abstractaccountv1.SpendingRule{rule})
		if err != nil {
			t.Fatalf("case %d: unexpected error: %v", i, err)
		}
		if msg.Owner != spendingOwner || msg.AccountAddress != spendingOwner || len(msg.Rules) != 1 {
			t.Fatalf("case %d: unexpected message %+v", i, msg)
		}
	}
}

func TestSpendingRulesCheckAmountsDenomsAndCountsLikeTheChain(t *testing.T) {
	denomRule := func(dls ...*abstractaccountv1.DenomLimit) []abstractaccountv1.SpendingRule {
		return []abstractaccountv1.SpendingRule{{Enabled: true, DenomLimits: dls}}
	}
	wantErr(t, ValidateSpendingRules([]abstractaccountv1.SpendingRule{{DailyLimit: -1}}), "non-negative")
	wantErr(t, ValidateSpendingRules([]abstractaccountv1.SpendingRule{{PerTxLimit: -1}}), "non-negative")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: "uqor", DailyLimit: "-5"})), "non-negative decimal")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: "uqor", DailyLimit: "1.5"})), "non-negative decimal")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: " ", DailyLimit: "1"})), "no denom")
	wantErr(t, ValidateSpendingRules(denomRule(nil)), "no denom")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: "u qor", DailyLimit: "1"})), "contains whitespace")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: "uqor\x7f", DailyLimit: "1"})), "contains whitespace")
	wantErr(t, ValidateSpendingRules(denomRule(&abstractaccountv1.DenomLimit{Denom: strings.Repeat("a", 257), DailyLimit: "1"})), "too long")
	wantErr(t, ValidateSpendingRules(denomRule(
		&abstractaccountv1.DenomLimit{Denom: "uqor", DailyLimit: "1"},
		&abstractaccountv1.DenomLimit{Denom: "UQOR", PerTxLimit: "1"},
	)), "more than one limit")

	many := make([]*abstractaccountv1.DenomLimit, MaxDenomLimits+1)
	for i := range many {
		many[i] = &abstractaccountv1.DenomLimit{Denom: fmt.Sprintf("d%d", i), DailyLimit: "1"}
	}
	wantErr(t, ValidateSpendingRules(denomRule(many...)), "at most 64")

	calls := make([]string, MaxAllowedEVMCalls+1)
	for i := range calls {
		calls[i] = fmt.Sprintf("0x%040x", i)
	}
	wantErr(t, ValidateSpendingRules([]abstractaccountv1.SpendingRule{{Enabled: true, AllowedEvmCalls: calls}}), "at most 64")

	// The error names the rule.
	wantErr(t, ValidateSpendingRules([]abstractaccountv1.SpendingRule{{Enabled: true, DailyLimit: 1}, {Enabled: true}}), "spending rule 1")
	if err := ValidateSpendingRules(nil); err != nil {
		t.Fatalf("no rules: unexpected error: %v", err)
	}
}
