package messages

import (
	"fmt"
	"regexp"
	"strings"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
)

// Client-side checks for MsgUpdateSpendingRules, run by
// NewUpdateSpendingRules before anything is signed.
//
// They follow the chain's own ValidateBasic (limits non-negative, at most
// MaxDenomLimits denom limits and MaxAllowedEVMCalls allowed calls, one limit
// per denom, amounts as non-negative decimal integers with "" meaning "no limit
// of that kind") and refuse one shape the chain does not yet: an ENABLED rule
// that bounds nothing. A rule bounds something when it sets a rule-level per-tx
// or daily limit, a denom list, an allowed-call list, or a denom limit with a
// non-zero amount. A rule whose only "bounds" are denom limits with empty or
// zero amounts permits everything while showing as an active spending limit.
//
// From chain v3.2.5 the chain checks these bounds itself when a rule is saved
// and refuses a failing rule with abstractaccount code 8 (invalid spending
// rule). It also parses EVM token denoms: an erc20/, erc721/ or erc1155/ denom
// (in denom_limits or allowed_denoms) must name a 0x-prefixed 20-byte contract
// address (ValidateEVMDenom), and the SDK applies the same check.
//
// A denom limit with both amounts empty or zero is refused too, whatever else
// the rule sets. When a denom has an entry the chain applies only that entry
// and skips the rule-level limits for the denom, so such an entry silently
// removes every limit on it while the rule still reads as limited.
const (
	// MaxDenomLimits is the most denom_limits one rule may carry (chain
	// MaxDenomLimits).
	MaxDenomLimits = 64
	// MaxAllowedEVMCalls is the most allowed_evm_calls one rule may carry
	// (chain MaxAllowedEVMCalls).
	MaxAllowedEVMCalls = 64
)

var decimalAmount = regexp.MustCompile(`^\d+$`)

// limitAmountIsZero reads a denom-limit amount: "" is zero, otherwise a
// non-negative decimal integer. It reports whether the amount is zero.
func limitAmountIsZero(s, what string, i int) (bool, error) {
	if s == "" {
		return true, nil
	}
	if !decimalAmount.MatchString(s) {
		return false, fmt.Errorf("spending rule %d: %s %q is not a non-negative decimal integer", i, what, s)
	}
	return strings.Trim(s, "0") == "", nil
}

// ValidateSpendingRules checks the rules of a MsgUpdateSpendingRules. It
// returns an error naming the rule and the problem, or nil when the rules are
// acceptable.
func ValidateSpendingRules(rules []abstractaccountv1.SpendingRule) error {
	for i, rule := range rules {
		if rule.DailyLimit < 0 {
			return fmt.Errorf("spending rule %d: daily limit must be non-negative", i)
		}
		if rule.PerTxLimit < 0 {
			return fmt.Errorf("spending rule %d: per-tx limit must be non-negative", i)
		}
		if n := len(rule.AllowedEvmCalls); n > MaxAllowedEVMCalls {
			return fmt.Errorf("spending rule %d: at most %d allowed EVM calls, got %d", i, MaxAllowedEVMCalls, n)
		}
		if n := len(rule.DenomLimits); n > MaxDenomLimits {
			return fmt.Errorf("spending rule %d: at most %d denom limits, got %d", i, MaxDenomLimits, n)
		}
		seen := make(map[string]bool, len(rule.DenomLimits))
		boundingDenomLimit := false
		for _, dl := range rule.DenomLimits {
			var denom, perTx, daily string
			if dl != nil {
				denom, perTx, daily = dl.Denom, dl.PerTxLimit, dl.DailyLimit
			}
			if strings.TrimSpace(denom) == "" {
				return fmt.Errorf("spending rule %d: a denom limit has no denom", i)
			}
			if len(denom) > 256 || strings.ContainsFunc(denom, func(r rune) bool { return r <= 0x20 || r == 0x7f }) {
				return fmt.Errorf("spending rule %d: denom %q is too long or contains whitespace", i, denom)
			}
			if err := ValidateEVMDenom(denom); err != nil {
				return fmt.Errorf("spending rule %d: %w", i, err)
			}
			key := strings.ToLower(denom)
			if seen[key] {
				return fmt.Errorf("spending rule %d: denom %s has more than one limit", i, denom)
			}
			seen[key] = true
			perTxZero, err := limitAmountIsZero(perTx, "denom "+denom+" per-tx limit", i)
			if err != nil {
				return err
			}
			dailyZero, err := limitAmountIsZero(daily, "denom "+denom+" daily limit", i)
			if err != nil {
				return err
			}
			if perTxZero && dailyZero {
				return fmt.Errorf("spending rule %d: the limit for %s sets neither a per-tx nor a daily amount, which would remove "+
					"the limit for %s (an entry replaces the rule-level limits for its denom); set an amount or drop the entry",
					i, denom, denom)
			}
			boundingDenomLimit = true
		}
		for _, d := range rule.AllowedDenoms {
			if err := ValidateEVMDenom(d); err != nil {
				return fmt.Errorf("spending rule %d: %w", i, err)
			}
		}
		bounded := rule.DailyLimit > 0 || rule.PerTxLimit > 0 || len(rule.AllowedDenoms) > 0 ||
			len(rule.AllowedEvmCalls) > 0 || boundingDenomLimit
		if rule.Enabled && !bounded {
			return fmt.Errorf("spending rule %d is enabled but bounds nothing: no per-tx or daily limit, no denom list, no allowed "+
				"calls, and no denom limit with a non-zero amount. It would permit everything while showing as a "+
				"spending limit; set at least one bound or disable it", i)
		}
	}
	return nil
}

// NewUpdateSpendingRules builds a MsgUpdateSpendingRules after checking the
// rules (ValidateSpendingRules): an enabled rule that bounds nothing, or a
// denom limit that would remove the limit for its denom, is refused here
// rather than stored as a limit that limits nothing. Owner-signed.
func NewUpdateSpendingRules(owner, accountAddress string, rules []abstractaccountv1.SpendingRule) (*abstractaccountv1.MsgUpdateSpendingRules, error) {
	if err := ValidateSpendingRules(rules); err != nil {
		return nil, err
	}
	return &abstractaccountv1.MsgUpdateSpendingRules{Owner: owner, AccountAddress: accountAddress, Rules: rules}, nil
}
