package messages

import (
	"fmt"
	"regexp"
	"strings"

	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
)

// Post-quantum consent for EIP-7702 delegations (chain v3.2.2).
//
// An EIP-7702 authorization tuple installs code on the account that signed it,
// with the classical key alone. From v3.2.2 the EVM lane admits a type-4
// transaction only if every account whose tuple would take effect holds a
// registered post-quantum key AND has consented, with MsgAuthorizeEVMDelegation
// signed by that key, to exactly the delegate the tuple names. Clearing a
// delegation (the zero address) needs consent too.
//
// The order: broadcast the consent (it ADVANCES the account's nonce, which is
// also its Cosmos sequence); read the consent query, whose nonce is the EVM
// nonce now; sign the tuple with that nonce if someone else sponsors the type-4
// transaction, or nonce+1 if the account sends it itself; send it. The consent
// is single use, expires after Blocks, is replaced by a new one and revoked by
// MsgCloseEVMWindow. MsgClearEVMDelegation removes an installed delegation
// without any EVM transaction.
const (
	// MaxEVMDelegationConsentBlocks is the longest a consent may wait to be
	// used: the same bound as a window.
	MaxEVMDelegationConsentBlocks = MaxEVMWindowBlocks
	// MaxEVMAuthorizationsPerTx is the most authorization tuples the EVM lane
	// accepts in one type-4 transaction.
	MaxEVMAuthorizationsPerTx = 8
	// EVMDelegationClear is the delegate to consent to when clearing.
	EVMDelegationClear = "0x0000000000000000000000000000000000000000"
)

var evmAddress = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

// ValidateAuthorizeEVMDelegation mirrors the chain's checks on
// MsgAuthorizeEVMDelegation: a valid qor sender, a 0x-prefixed 20-byte
// delegate, and blocks in 1..MaxEVMDelegationConsentBlocks.
func ValidateAuthorizeEVMDelegation(msg *pqcv1.MsgAuthorizeEVMDelegation) error {
	if msg == nil {
		return fmt.Errorf("authorize evm delegation: message is nil")
	}
	if err := validateWindowSender(msg.Sender); err != nil {
		return err
	}
	if !evmAddress.MatchString(msg.Delegate) {
		return fmt.Errorf("authorize evm delegation: delegate must be a 0x-prefixed 20-byte address (EVMDelegationClear to consent to clearing), got %q", msg.Delegate)
	}
	if msg.Blocks == 0 || msg.Blocks > MaxEVMDelegationConsentBlocks {
		return fmt.Errorf("authorize evm delegation: blocks must be between 1 and %d, got %d", MaxEVMDelegationConsentBlocks, msg.Blocks)
	}
	return nil
}

// NewAuthorizeEVMDelegation builds a validated MsgAuthorizeEVMDelegation. The
// delegate is sent lower-cased: the chain compares case-insensitively, and this
// keeps the message identical across clients.
func NewAuthorizeEVMDelegation(sender, delegate string, blocks uint64) (*pqcv1.MsgAuthorizeEVMDelegation, error) {
	msg := Pqc.AuthorizeEVMDelegation(sender, strings.ToLower(delegate), blocks)
	if err := ValidateAuthorizeEVMDelegation(msg); err != nil {
		return nil, err
	}
	return msg, nil
}

// NewClearEVMDelegation builds a validated MsgClearEVMDelegation.
func NewClearEVMDelegation(sender string) (*pqcv1.MsgClearEVMDelegation, error) {
	if err := validateWindowSender(sender); err != nil {
		return nil, err
	}
	return Pqc.ClearEVMDelegation(sender), nil
}
