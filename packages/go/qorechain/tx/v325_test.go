package tx

import (
	"strings"
	"testing"
)

func TestKEMRegistryCodesAreNamed(t *testing.T) {
	cases := map[uint32]string{
		250: "not enabled",
		251: "invalid KEM public key",
		252: "no KEM key published",
		253: "already published",
		254: "post-quantum signature key",
	}
	for code, want := range cases {
		e := DecodeTxError(code, "pqc", "")
		if e == nil || e.Code != code || !strings.Contains(e.Reason, want) {
			t.Errorf("pqc %d decoded as %+v", code, e)
		}
	}
	// A refusal that arrives as text only (a failed simulation).
	e := DecodeRefusalText("failed to execute message; message index: 0: this KEM key is already published for this account")
	if e == nil || e.Codespace != "pqc" || e.Code != 253 {
		t.Fatalf("text refusal decoded as %+v", e)
	}
	e = DecodeRefusalText("rule 0: denom \"erc20/0x12\": erc20/ must be followed by a 0x-prefixed 20-byte contract address: invalid spending rule")
	if e == nil || e.Codespace != "abstractaccount" || e.Code != 8 {
		t.Fatalf("spending rule refusal decoded as %+v", e)
	}
	if e := DecodeTxError(9, "abstractaccount", ""); e == nil || !strings.Contains(e.Reason, "disabled") {
		t.Fatalf("abstractaccount 9 decoded as %+v", e)
	}
}
