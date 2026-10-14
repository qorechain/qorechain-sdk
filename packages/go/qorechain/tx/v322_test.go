package tx

import (
	"fmt"
	"testing"
)

func TestDecodeTxErrorV322(t *testing.T) {
	if e := DecodeTxError(7, "ai", "sender exceeded the rate limit"); e.Reason != RateLimitedReason {
		t.Fatalf("rate limit: %q", e.Reason)
	}
	if e := DecodeTxError(60, "pqc", ""); e.Reason != "no post-quantum consent for this EIP-7702 delegation" {
		t.Fatalf("60: %q", e.Reason)
	}
}

func TestClassifyEVMDelegation(t *testing.T) {
	if got := ClassifyEVMDelegationError(fmt.Errorf("no post-quantum consent for this EIP-7702 delegation: authority 0xabc")); got != EVMDelegationNoConsent {
		t.Fatalf("text: %q", got)
	}
	if got := ClassifyEVMDelegationError(DecodeTxError(61, "pqc", "")); got != EVMDelegationInvalid {
		t.Fatalf("code: %q", got)
	}
	if got := ClassifyEVMDelegationFailure(26, "pqc", ""); got != "" {
		t.Fatalf("window code must not classify as delegation: %q", got)
	}
}
