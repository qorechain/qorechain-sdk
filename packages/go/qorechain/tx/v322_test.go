package tx

import (
	"fmt"
	"testing"
)

func TestDecodeTxErrorV322(t *testing.T) {
	log := "sender qor1abc has sent 600 transactions in the last 30 blocks, at the configured limit of 600 per minute"
	if e := DecodeTxError(3, "ai", log); e.Reason != RateLimitedReason {
		t.Fatalf("rate limit: %q", e.Reason)
	}
	if e := DecodeTxError(3, "", log); e.Reason != RateLimitedReason {
		t.Fatalf("rate limit without codespace: %q", e.Reason)
	}
	if e := DecodeTxError(3, "ai", "transaction rejected by AI engine"); e.Reason == RateLimitedReason {
		t.Fatal("other ai 3 rejection classified as rate limit")
	}
	if e := DecodeTxError(2, "ai", log); e.Reason == RateLimitedReason {
		t.Fatal("ai 2 (anomaly) classified as rate limit")
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

func TestDecodeTxErrorV323(t *testing.T) {
	for code, want := range map[uint32]string{
		230: "PQC public key gives no post-quantum protection",
		231: "PQC proof of possession does not verify",
		232: "PQC key was used by this account before",
		234: "PQC key maintenance from a keyed account needs the hybrid signature",
	} {
		if got := DecodeTxError(code, "pqc", "").Reason; got != want {
			t.Errorf("%d: %q", code, got)
		}
	}
}
