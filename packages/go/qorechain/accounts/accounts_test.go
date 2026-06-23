package accounts

import (
	"bytes"
	"testing"
)

// The public BIP-39 test mnemonic (well-known dev default account 0).
const testMnemonic = "test test test test test test test test test test test junk"

// Known-answer vectors shared with the TypeScript and Python SDKs. If any of
// these break, the Go derivation has diverged — a cross-language bug.
const (
	evmIdx0    = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
	evmIdx1    = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
	nativeIdx0 = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu"
	nativeIdx1 = "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq"
	svmIdx0    = "oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96"
)

func TestEVMKnownAnswer(t *testing.T) {
	a0, err := DeriveEVMAccount(testMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a0.Address != evmIdx0 {
		t.Errorf("EVM idx0 = %q, want %q", a0.Address, evmIdx0)
	}
	a1, err := DeriveEVMAccount(testMnemonic, 1)
	if err != nil {
		t.Fatal(err)
	}
	if a1.Address != evmIdx1 {
		t.Errorf("EVM idx1 = %q, want %q", a1.Address, evmIdx1)
	}
}

func TestNativeKnownAnswer(t *testing.T) {
	a0, err := DeriveNativeAccount(testMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a0.Address != nativeIdx0 {
		t.Errorf("native idx0 = %q, want %q", a0.Address, nativeIdx0)
	}
	a1, err := DeriveNativeAccount(testMnemonic, 1)
	if err != nil {
		t.Fatal(err)
	}
	if a1.Address != nativeIdx1 {
		t.Errorf("native idx1 = %q, want %q", a1.Address, nativeIdx1)
	}
}

func TestSVMKnownAnswer(t *testing.T) {
	a, err := DeriveSVMAccount(testMnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a.Address != svmIdx0 {
		t.Errorf("SVM idx0 = %q, want %q", a.Address, svmIdx0)
	}
	if len(a.PublicKey) != 32 {
		t.Errorf("SVM public key len = %d, want 32", len(a.PublicKey))
	}
	if len(a.SecretKey) != 64 {
		t.Errorf("SVM secret key len = %d, want 64", len(a.SecretKey))
	}
	if !bytes.Equal(a.SecretKey[32:], a.PublicKey) {
		t.Error("SVM secret key tail should equal public key")
	}
}

func TestAccountTypes(t *testing.T) {
	n, _ := DeriveNativeAccount(testMnemonic, 0)
	e, _ := DeriveEVMAccount(testMnemonic, 0)
	s, _ := DeriveSVMAccount(testMnemonic, 0)
	if n.Type != "native" || e.Type != "evm" || s.Type != "svm" {
		t.Errorf("types: %q %q %q", n.Type, e.Type, s.Type)
	}
}

func TestDeterminism(t *testing.T) {
	a, _ := DeriveNativeAccount(testMnemonic, 0)
	b, _ := DeriveNativeAccount(testMnemonic, 0)
	if a.Address != b.Address || !bytes.Equal(a.PrivateKey, b.PrivateKey) {
		t.Error("derivation not deterministic")
	}
}

func TestDifferentIndexDifferentAddress(t *testing.T) {
	n0, _ := DeriveNativeAccount(testMnemonic, 0)
	n1, _ := DeriveNativeAccount(testMnemonic, 1)
	if n0.Address == n1.Address {
		t.Error("native: different index should give different address")
	}
	e0, _ := DeriveEVMAccount(testMnemonic, 0)
	e1, _ := DeriveEVMAccount(testMnemonic, 1)
	if e0.Address == e1.Address {
		t.Error("evm: different index should give different address")
	}
	s0, _ := DeriveSVMAccount(testMnemonic, 0)
	s1, _ := DeriveSVMAccount(testMnemonic, 1)
	if s0.Address == s1.Address {
		t.Error("svm: different index should give different address")
	}
}

func TestKeyLengths(t *testing.T) {
	n, _ := DeriveNativeAccount(testMnemonic, 0)
	if len(n.PrivateKey) != 32 {
		t.Errorf("native priv len = %d", len(n.PrivateKey))
	}
	if len(n.PublicKey) != 33 {
		t.Errorf("native pub len = %d (want 33, compressed)", len(n.PublicKey))
	}
	e, _ := DeriveEVMAccount(testMnemonic, 0)
	if len(e.PrivateKey) != 32 {
		t.Errorf("evm priv len = %d", len(e.PrivateKey))
	}
}

func TestInvalidMnemonic(t *testing.T) {
	// Valid words, wrong checksum.
	bad := "test test test test test test test test test test test test"
	if _, err := DeriveNativeAccount(bad, 0); err == nil {
		t.Error("expected error for invalid mnemonic (native)")
	}
	if _, err := DeriveEVMAccount(bad, 0); err == nil {
		t.Error("expected error for invalid mnemonic (evm)")
	}
	if _, err := DeriveSVMAccount(bad, 0); err == nil {
		t.Error("expected error for invalid mnemonic (svm)")
	}
}

func TestValidateMnemonic(t *testing.T) {
	if !ValidateMnemonic(testMnemonic) {
		t.Error("test mnemonic should be valid")
	}
	if ValidateMnemonic("test test test test test test test test test test test test") {
		t.Error("wrong-checksum mnemonic should be invalid")
	}
	if ValidateMnemonic("not a real mnemonic phrase at all here ok") {
		t.Error("garbage mnemonic should be invalid")
	}
}

func TestGenerateMnemonic(t *testing.T) {
	m, err := GenerateMnemonic(128)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidateMnemonic(m) {
		t.Error("generated 12-word mnemonic should validate")
	}
	if _, err := GenerateMnemonic(192); err == nil {
		t.Error("unsupported strength should error")
	}
}
