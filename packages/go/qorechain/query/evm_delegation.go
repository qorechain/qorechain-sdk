package query

import (
	"encoding/json"
	"fmt"
	"net/url"
)

// EVMDelegationConsent is the decoded answer of
// GET {rest}/qorechain/pqc/v1/evm_delegation_consent/{address} (chain v3.2.2):
// an account's EIP-7702 delegation consent, and what a client needs to sign the
// matching authorization tuple. The route answers Found=false when there is no
// consent; an older node has no such route and answers an HTTP error.
type EVMDelegationConsent struct {
	// Found reports whether a consent is stored. A stored consent may be expired.
	Found bool
	// Live reports whether it can still be used at the current height.
	Live bool
	// Delegate is the 0x address the consent names, lower case; the zero
	// address means clearing.
	Delegate      string
	GrantedHeight uint64
	ExpiryHeight  uint64
	// CurrentDelegate is the delegation installed on the account now; empty
	// when there is none.
	CurrentDelegate string
	// Nonce is the account's EVM nonce now. A SPONSORED tuple carries it; one
	// in the account's OWN type-4 transaction carries Nonce+1 (see TupleNonce).
	Nonce uint64
}

// TupleNonce is the nonce an authorization tuple must carry, from a consent
// read AFTER the consent message was included. sponsored is true when another
// account sends the type-4 transaction.
func (c *EVMDelegationConsent) TupleNonce(sponsored bool) uint64 {
	if sponsored {
		return c.Nonce
	}
	return c.Nonce + 1
}

// EVMDelegationConsentPath is the REST route for one account's consent.
func EVMDelegationConsentPath(address string) string {
	return "/qorechain/pqc/v1/evm_delegation_consent/" + url.PathEscape(address)
}

// GetEVMDelegationConsent returns the decoded delegation consent for an
// address (qor1… or 0x).
func (c *RestClient) GetEVMDelegationConsent(address string) (*EVMDelegationConsent, error) {
	raw, err := c.Get(EVMDelegationConsentPath(address), nil)
	if err != nil {
		return nil, err
	}
	return ParseEVMDelegationConsent(raw)
}

type evmDelegationBody struct {
	Found           json.RawMessage `json:"found"`
	Live            json.RawMessage `json:"live"`
	Delegate        string          `json:"delegate"`
	GrantedHeight   json.RawMessage `json:"granted_height"`
	ExpiryHeight    json.RawMessage `json:"expiry_height"`
	CurrentDelegate string          `json:"current_delegate"`
	Nonce           json.RawMessage `json:"nonce"`
}

// ParseEVMDelegationConsent decodes an evm_delegation_consent response body.
func ParseEVMDelegationConsent(raw []byte) (*EVMDelegationConsent, error) {
	var body evmDelegationBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("evm_delegation_consent: decoding response: %w", err)
	}
	out := &EVMDelegationConsent{Delegate: body.Delegate, CurrentDelegate: body.CurrentDelegate}
	var err error
	if out.Found, err = windowBool(body.Found, "found"); err != nil {
		return nil, err
	}
	if out.Live, err = windowBool(body.Live, "live"); err != nil {
		return nil, err
	}
	if out.GrantedHeight, err = windowUint(body.GrantedHeight, "granted_height"); err != nil {
		return nil, err
	}
	if out.ExpiryHeight, err = windowUint(body.ExpiryHeight, "expiry_height"); err != nil {
		return nil, err
	}
	if out.Nonce, err = windowUint(body.Nonce, "nonce"); err != nil {
		return nil, err
	}
	return out, nil
}
