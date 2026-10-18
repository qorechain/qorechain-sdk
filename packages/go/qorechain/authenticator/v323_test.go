package authenticator

import (
	"encoding/hex"
	"testing"
)

type fakeUpgrades bool

func (f fakeUpgrades) IsUpgradeApplied(string) (bool, error) { return bool(f), nil }

// Vectors computed with the chain's own EVMAuthSignBytes / EVMAuthSignBytesV2
// (x/abstractaccount/types/evm_sign.go at the frozen v3.2.3 commit).
func TestEVMAuthDigestMatchesChain(t *testing.T) {
	pub, _ := hex.DecodeString("038844ec286297bf780ce0fbe07df2a74c5e0e841df5f3adc363f0372755b76d74")
	data, _ := hex.DecodeString("a9059cbb")
	const acct = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
	const to = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b"
	v1 := EVMAuthSignBytes("qorechain-diana", acct, pub, to, "1000", data, 7)
	if hex.EncodeToString(v1[:]) != "c2614c477a15020777adb1e889748557debc6dece7207ded95d30ee6d7bd778a" {
		t.Fatalf("v1 %x", v1)
	}
	v2, err := EVMAuthSignBytesV2("qorechain-diana", acct, pub, to, "1000", data, 7, 250000)
	if err != nil || hex.EncodeToString(v2[:]) != "19d7518ad25079dff616819b7554d7d39700fb9e4331a6cbc635685122f0c18b" {
		t.Fatalf("v2 %x %v", v2, err)
	}
	if _, err := EVMAuthSignBytesV2("qorechain-diana", acct, pub, to, "1000", data, 7, 0); err == nil {
		t.Fatal("zero gas limit accepted")
	}
	if v, _ := EVMAuthDigestVersion(fakeUpgrades(false)); v != "v1" {
		t.Fatal(v)
	}
	if v, _ := EVMAuthDigestVersion(fakeUpgrades(true)); v != "v2" {
		t.Fatal(v)
	}
}

func TestRotationRefusesANewLegacyKey(t *testing.T) {
	const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	const acct = "qor1hkkxx5jmmw02wcz26c74lsp74qysj6h495vv0k"
	if _, err := RotatePQCKeyMsgFromMnemonic(acct, mnemonic, "qorechain-diana", 1, DerivationCanonical, DerivationLegacy); err == nil {
		t.Fatal("a new legacy key must be refused")
	}
	if _, err := RotatePQCKeyMsgFromMnemonic(acct, mnemonic, "qorechain-diana", 1, DerivationLegacy, DerivationCanonical); err != nil {
		t.Fatalf("legacy -> canonical must still work: %v", err)
	}
}
