package tx

import (
	"errors"
	"fmt"
	"testing"
)

// The chain's own refusal texts, as they arrive over the EVM JSON-RPC lane.
const (
	chainNoWindowText = "account qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7 has no open EVM " +
		"authorisation window; open one with MsgOpenEVMWindow, signed on the Cosmos lane with " +
		"the account's post-quantum key"
	chainNoKeyText = "account qor1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5tfman7 has no registered " +
		"post-quantum key"
)

// TestClassifyEVMWindowFailureByCode covers the three pqc codes, including the
// two states code 28 carries.
func TestClassifyEVMWindowFailureByCode(t *testing.T) {
	cases := []struct {
		name      string
		code      uint32
		codespace string
		text      string
		want      EVMWindowIssue
	}{
		{"code 26", 26, "pqc", chainNoWindowText, EVMWindowIssueNoWindow},
		{"code 26 without text", 26, "pqc", "", EVMWindowIssueNoWindow},
		{"code 27", 27, "pqc", "EVM authorisation window exhausted", EVMWindowIssueExhausted},
		{"code 28 invalid window", 28, "pqc", "invalid EVM authorisation window", EVMWindowIssueInvalid},
		{"code 28 no key", 28, "pqc", chainNoKeyText, EVMWindowIssueNoPQCKey},
		{"code 21 is not a window issue", 21, "pqc", "hybrid PQC signature verification failed", EVMWindowIssueNone},
		{"another codespace, same number", 26, "sdk", "unpacking protobuf message failed", EVMWindowIssueNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyEVMWindowFailure(tc.code, tc.codespace, tc.text); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestClassifyEVMWindowErrorByText covers the JSON-RPC lane, where the refusal
// carries the chain's text and no codespace at all.
func TestClassifyEVMWindowErrorByText(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want EVMWindowIssue
	}{
		{"chain no-window text", errors.New(chainNoWindowText), EVMWindowIssueNoWindow},
		{"chain no-key text", errors.New(chainNoKeyText), EVMWindowIssueNoPQCKey},
		{"wrapped no-window text", fmt.Errorf("broadcast failed: %w", errors.New(chainNoWindowText)), EVMWindowIssueNoWindow},
		{"exhausted text", errors.New("EVM authorisation window exhausted for account qor1abc"), EVMWindowIssueExhausted},
		{"expired text", errors.New("EVM authorisation window expired at height 6069908"), EVMWindowIssueInvalid},
		{"american spelling", errors.New("account qor1abc has no open EVM authorization window"), EVMWindowIssueNoWindow},
		{"unrelated error", errors.New("insufficient funds: 10uqor is smaller than 20uqor"), EVMWindowIssueNone},
		{"unrelated nonce error", errors.New("nonce too low: next nonce 3, tx nonce 2"), EVMWindowIssueNone},
		{"nil", nil, EVMWindowIssueNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyEVMWindowError(tc.err)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if want := tc.want != EVMWindowIssueNone; IsEVMWindowError(tc.err) != want {
				t.Fatalf("IsEVMWindowError = %v, want %v", !want, want)
			}
		})
	}
}

// TestClassifyEVMWindowErrorFromTxError classifies a decoded ABCI failure, the
// shape the Cosmos lane returns.
func TestClassifyEVMWindowErrorFromTxError(t *testing.T) {
	err := DecodeTxError(26, "pqc", chainNoWindowText)
	if err == nil {
		t.Fatal("DecodeTxError returned nil for a non-zero code")
	}
	if got := ClassifyEVMWindowError(err); got != EVMWindowIssueNoWindow {
		t.Fatalf("got %q, want %q", got, EVMWindowIssueNoWindow)
	}
	if err.Reason != "no open EVM authorisation window" {
		t.Fatalf("unexpected reason: %q", err.Reason)
	}
	wrapped := fmt.Errorf("broadcast: %w", err)
	if got := ClassifyEVMWindowError(wrapped); got != EVMWindowIssueNoWindow {
		t.Fatalf("wrapped: got %q, want %q", got, EVMWindowIssueNoWindow)
	}

	keyErr := DecodeTxError(28, "pqc", chainNoKeyText)
	if got := ClassifyEVMWindowError(keyErr); got != EVMWindowIssueNoPQCKey {
		t.Fatalf("code 28 with the no-key text: got %q", got)
	}
	if got := ClassifyEVMWindowError(DecodeTxError(27, "pqc", "")); got != EVMWindowIssueExhausted {
		t.Fatalf("code 27: got %q", got)
	}
	if got := ClassifyEVMWindowError(DecodeTxError(5, "sdk", "insufficient funds")); got != EVMWindowIssueNone {
		t.Fatalf("unrelated tx error: got %q", got)
	}
}

// TestEVMWindowRemedies checks each issue names its own remedy and that the
// no-key remedy is the register-key one, not the open-a-window one.
func TestEVMWindowRemedies(t *testing.T) {
	for _, issue := range []EVMWindowIssue{
		EVMWindowIssueNoWindow, EVMWindowIssueExhausted, EVMWindowIssueInvalid, EVMWindowIssueNoPQCKey,
	} {
		if issue.Remedy() == "" {
			t.Fatalf("issue %q has no remedy", issue)
		}
	}
	if EVMWindowIssueNone.Remedy() != "" {
		t.Fatal("EVMWindowIssueNone must have no remedy")
	}
	if got := EVMWindowIssueNoPQCKey.Remedy(); got == EVMWindowIssueNoWindow.Remedy() {
		t.Fatal("the missing-key remedy must differ from the missing-window remedy")
	}
}
