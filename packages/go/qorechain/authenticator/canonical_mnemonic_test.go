package authenticator

import (
	"bytes"
	"strings"
	"testing"
)

func TestDerivePQCCanonicalMnemonicForms(t *testing.T) {
	const m = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	const acc = "qor1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg34kqp8d"
	want, err := DerivePQCCanonical(acc, m)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range []string{strings.ToUpper(m), "  " + m + "\n", strings.ReplaceAll(m, " ", "  "), strings.ReplaceAll(m, " ", "\t")} {
		got, err := DerivePQCCanonical(acc, v)
		if err != nil {
			t.Fatalf("variant refused: %v", err)
		}
		if !bytes.Equal(got.PublicKey, want.PublicKey) {
			t.Fatal("variant gave a different key")
		}
	}
	if c, _ := CanonicalMnemonic(" " + strings.ToUpper(m) + " "); c != m {
		t.Fatalf("canonical form = %q", c)
	}
	_, err = DerivePQCCanonical(acc, "abandon abandon secretword")
	if err == nil || err.Error() != "invalid mnemonic" || strings.Contains(err.Error(), "secretword") {
		t.Fatalf("invalid phrase: err = %v", err)
	}
}
