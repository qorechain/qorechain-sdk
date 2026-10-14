package messages

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/address"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/utils"
)

const v322Sender = "qor18df074t3k0xq8jf7336hpjjsktw354knr650aq"

func TestNewAuthorizeEVMDelegation(t *testing.T) {
	m, err := NewAuthorizeEVMDelegation(v322Sender, "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B", 600)
	if err != nil {
		t.Fatal(err)
	}
	if m.Delegate != "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b" || m.Blocks != 600 {
		t.Fatalf("unexpected %+v", m)
	}
	if _, err := NewAuthorizeEVMDelegation(v322Sender, EVMDelegationClear, 1); err != nil {
		t.Fatalf("clear consent: %v", err)
	}
	for _, bad := range []struct {
		delegate string
		blocks   uint64
		want     string
	}{
		{"0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B", 0, "between 1 and 17280"},
		{"0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B", MaxEVMDelegationConsentBlocks + 1, "between 1 and 17280"},
		{"63c0c19a", 5, "0x-prefixed"},
	} {
		if _, err := NewAuthorizeEVMDelegation(v322Sender, bad.delegate, bad.blocks); err == nil || !strings.Contains(err.Error(), bad.want) {
			t.Errorf("%+v: got %v", bad, err)
		}
	}
	if _, err := NewClearEVMDelegation("nope"); err == nil {
		t.Fatal("invalid sender accepted")
	}
}

func TestValidateClassicalKeyForSender(t *testing.T) {
	// Accepted on diana at h 7,911,828 with the v3.2.2 rule on (eth-native).
	pub, _ := hex.DecodeString("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74")
	if got, err := ValidateClassicalKeyForSender("qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k", pub); err != nil || got != ClassicalKeyEth {
		t.Fatalf("diana vector: %v %v", got, err)
	}

	priv := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x11}, 32))
	cpub := priv.PubKey().SerializeCompressed()
	addr, err := address.BytesToBech32(utils.Hash160(cpub), "qor")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := ValidateClassicalKeyForSender(addr, cpub); err != nil || got != ClassicalKeyCosmos {
		t.Fatalf("cosmos: %v %v", got, err)
	}
	if got, err := ValidateClassicalKeyForSender(v322Sender, nil); err != nil || got != ClassicalKeyEmpty {
		t.Fatalf("empty: %v %v", got, err)
	}
	if _, err := ValidateClassicalKeyForSender(v322Sender, cpub); err == nil || !strings.Contains(err.Error(), "does not belong") {
		t.Fatalf("foreign key: %v", err)
	}
	if _, err := ValidateClassicalKeyForSender(v322Sender, priv.PubKey().SerializeUncompressed()); err == nil || !strings.Contains(err.Error(), "33-byte") {
		t.Fatalf("uncompressed key: %v", err)
	}
}
