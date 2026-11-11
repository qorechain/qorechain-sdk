package messages

import (
	"encoding/hex"
	"fmt"
	"strings"

	abstractaccountv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/abstractaccount/v1"
)

// Linking an external key to an account (MsgRegisterAuthenticator), chain
// v3.2.8.
//
// From v3.2.8 the chain requires two things it did not before:
//
//  1. A possession proof (field 8): a signature BY THE KEY BEING LINKED over
//     AuthenticatorLinkMessage. It shows the owner holds the key, so nobody can
//     link a key they do not control.
//  2. For a key with a value permission (send, evm, deploy, svm or all), an
//     enabled spending rule on the ACCOUNT that bounds every denom (see
//     CheckSpendingRuleBoundsValueKeys). MsgRegisterAuthenticator has no
//     per-key rule; the bound comes from MsgUpdateSpendingRules.
//
// The recommended transaction is [MsgUpdateSpendingRules, MsgRegisterAuthenticator],
// both signed by the owner as top-level messages (not through authz);
// authenticator.LinkAuthenticatorMsgs builds that pair. MsgUpdateSpendingRules
// may be sent for an account that does not exist yet when account_address ==
// owner: it creates the account.

// AuthenticatorLinkVersion is the first line of the link message.
const AuthenticatorLinkVersion = "QoreChain authenticator link v1"

// Authenticator schemes MsgRegisterAuthenticator accepts.
const (
	SchemeEd25519   = "ed25519"
	SchemeSecp256k1 = "secp256k1"
)

// ValuePermissions are the authenticator permissions that move value. A key
// carrying any of them needs a bounding spending rule on the account.
var ValuePermissions = []string{"send", "evm", "deploy", "svm", "all"}

// AuthenticatorLinkMessage returns the exact text the linked key signs for its
// possession proof (UTF-8, lines joined with "\n", no trailing newline):
//
//	QoreChain authenticator link v1
//	chain: <chainID>
//	account: <accountAddress>
//	scheme: <scheme>
//	key: <lowercase hex of pubkey>
//
// pubkey is exactly the bytes put in MsgRegisterAuthenticator.pubkey: a
// 32-byte ed25519 key, a 33-byte compressed secp256k1 key, or the 20-byte
// Ethereum address for a MetaMask-style link. A browser wallet signs this text
// itself (Phantom signMessage, MetaMask personal_sign).
func AuthenticatorLinkMessage(chainID, accountAddress, scheme string, pubkey []byte) string {
	return strings.Join([]string{
		AuthenticatorLinkVersion,
		"chain: " + chainID,
		"account: " + accountAddress,
		"scheme: " + scheme,
		"key: " + hex.EncodeToString(pubkey),
	}, "\n")
}

// HasValuePermission reports whether permissions include any of
// ValuePermissions (case-insensitive).
func HasValuePermission(permissions []string) bool {
	for _, p := range permissions {
		for _, v := range ValuePermissions {
			if strings.EqualFold(strings.TrimSpace(p), v) {
				return true
			}
		}
	}
	return false
}

// CheckSpendingRuleBoundsValueKeys mirrors the chain v3.2.8 rule for keys
// with a value permission: the account's FIRST enabled rule (the one the chain
// applies) must bound every denom, which means per_tx_limit > 0 or
// daily_limit > 0, or, when both are 0, a non-empty allowed_denoms list in
// which every denom has a denom_limits entry (matched case-insensitively) with
// a non-zero per-tx or daily amount. It returns nil when the rules qualify.
func CheckSpendingRuleBoundsValueKeys(rules []abstractaccountv1.SpendingRule) error {
	var first *abstractaccountv1.SpendingRule
	for i := range rules {
		if rules[i].Enabled {
			first = &rules[i]
			break
		}
	}
	if first == nil {
		return fmt.Errorf("a key with a value permission (%s) needs an enabled spending rule on the account; none is enabled",
			strings.Join(ValuePermissions, ", "))
	}
	if first.PerTxLimit > 0 || first.DailyLimit > 0 {
		return nil
	}
	if len(first.AllowedDenoms) == 0 {
		return fmt.Errorf("the account's first enabled spending rule bounds no denom: set per_tx_limit or daily_limit, or list " +
			"allowed_denoms with a denom_limits amount for each")
	}
	limited := make(map[string]bool, len(first.DenomLimits))
	for _, dl := range first.DenomLimits {
		if dl == nil {
			continue
		}
		perTxZero, err := limitAmountIsZero(dl.PerTxLimit, "denom "+dl.Denom+" per-tx limit", 0)
		if err != nil {
			return err
		}
		dailyZero, err := limitAmountIsZero(dl.DailyLimit, "denom "+dl.Denom+" daily limit", 0)
		if err != nil {
			return err
		}
		if !perTxZero || !dailyZero {
			limited[strings.ToLower(dl.Denom)] = true
		}
	}
	for _, d := range first.AllowedDenoms {
		if !limited[strings.ToLower(d)] {
			return fmt.Errorf("the account's first enabled spending rule has no per-tx or daily limit and allowed denom %q has "+
				"no denom_limits entry with an amount, so it is unbounded", d)
		}
	}
	return nil
}
