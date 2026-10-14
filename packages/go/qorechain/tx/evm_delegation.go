package tx

import (
	"errors"
	"strings"
)

// EVMDelegationIssue is why the chain refused an EIP-7702 delegation (chain
// v3.2.2), or "" when the refusal is something else.
type EVMDelegationIssue string

const (
	// EVMDelegationNoConsent: no live consent for the delegate the tuple names.
	// Remedy: broadcast MsgAuthorizeEVMDelegation for exactly that delegate
	// (again, if the consent expired or was used).
	EVMDelegationNoConsent EVMDelegationIssue = "no_consent"
	// EVMDelegationInvalid: a malformed consent or clear request, or an
	// account without a registered PQC key.
	EVMDelegationInvalid EVMDelegationIssue = "invalid"
)

// ABCI codes in the `pqc` codespace for delegation consent.
const (
	CodeNoEVMDelegationConsent uint32 = 60
	CodeInvalidEVMDelegation   uint32 = 61
)

// ClassifyEVMDelegationFailure classifies a delegation refusal from its text
// first (over EVM JSON-RPC only the text arrives), then its (code, codespace).
func ClassifyEVMDelegationFailure(code uint32, codespace, text string) EVMDelegationIssue {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "no post-quantum consent for this eip-7702 delegation"):
		return EVMDelegationNoConsent
	case strings.Contains(lower, "invalid eip-7702 delegation request"):
		return EVMDelegationInvalid
	}
	if codespace == "pqc" {
		switch code {
		case CodeNoEVMDelegationConsent:
			return EVMDelegationNoConsent
		case CodeInvalidEVMDelegation:
			return EVMDelegationInvalid
		}
	}
	return ""
}

// ClassifyEVMDelegationError classifies an error: a *QoreTxError by its code,
// codespace and raw log; anything else by its message.
func ClassifyEVMDelegationError(err error) EVMDelegationIssue {
	if err == nil {
		return ""
	}
	var txErr *QoreTxError
	if errors.As(err, &txErr) {
		return ClassifyEVMDelegationFailure(txErr.Code, txErr.Codespace, txErr.RawLog)
	}
	return ClassifyEVMDelegationFailure(0, "", err.Error())
}
