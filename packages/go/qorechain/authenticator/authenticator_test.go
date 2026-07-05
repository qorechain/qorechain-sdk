package authenticator

import (
	"encoding/hex"
	"testing"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/unified"
)

const testMnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

// repeatByte returns n bytes all equal to b.
func repeatByte(b byte, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = b
	}
	return out
}

// TestEVMAuthSignBytesKAT locks the EVM auth digest against the byte-exact KAT
// shared with the TS SDK / wallet adapter.
func TestEVMAuthSignBytesKAT(t *testing.T) {
	pubkey := repeatByte(0x01, 32)
	digest := EVMAuthSignBytes("qorechain-diana", "qor1test", pubkey, "0xabc", "1000", []byte{2, 2, 2}, 5)
	got := hex.EncodeToString(digest[:])
	want := "8661921e6d37dff44e97d4a05d4efbfd3fd8ea631201479c2bbf1cb41ade7025"
	if got != want {
		t.Fatalf("EVM auth sign-bytes KAT mismatch:\n want %s\n got  %s", want, got)
	}
}

// TestCosmosAuthSignBytesKAT locks the Native/Cosmos auth digest against the KAT.
func TestCosmosAuthSignBytesKAT(t *testing.T) {
	pubkey := repeatByte(0x01, 32)
	digest := CosmosAuthSignBytes("qorechain-diana", "qor1test", pubkey, "qor1recv", "100uqor", 3)
	got := hex.EncodeToString(digest[:])
	want := "5e203ef47b5fe63d0fc9c8909aecb124b32b173f8b96700003ba1d8fa0114f0f"
	if got != want {
		t.Fatalf("Cosmos auth sign-bytes KAT mismatch:\n want %s\n got  %s", want, got)
	}
}

// TestRotationSignBytesKAT locks the domain-separated rotation string.
func TestRotationSignBytesKAT(t *testing.T) {
	got := RotationSignBytes("qorechain-diana", 1, "qor1test", []byte{0xaa, 0xaa}, []byte{0xbb, 0xbb})
	want := "qorechain-pqc-rotate-v1|qorechain-diana|1|qor1test|aaaa|bbbb"
	if got != want {
		t.Fatalf("rotation sign-bytes KAT mismatch:\n want %s\n got  %s", want, got)
	}
}

// TestDerivePQCLegacy checks the legacy derivation is deterministic and yields a
// valid ML-DSA-87 keypair whose signatures verify.
func TestDerivePQCLegacy(t *testing.T) {
	kp1, err := DerivePQCLegacy(testMnemonic)
	if err != nil {
		t.Fatalf("legacy derive: %v", err)
	}
	kp2, err := DerivePQCLegacy(testMnemonic)
	if err != nil {
		t.Fatalf("legacy derive (2): %v", err)
	}
	if hex.EncodeToString(kp1.PublicKey) != hex.EncodeToString(kp2.PublicKey) {
		t.Fatal("legacy derivation is not deterministic")
	}
	if len(kp1.PublicKey) != pqc.MLDSA87PublicKeyLength {
		t.Fatalf("legacy pubkey length: want %d, got %d", pqc.MLDSA87PublicKeyLength, len(kp1.PublicKey))
	}
	msg := []byte("hello")
	sig, err := pqc.PQCSign(kp1.SecretKey, msg)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !pqc.PQCVerify(kp1.PublicKey, msg, sig) {
		t.Fatal("legacy keypair signature failed to verify")
	}
}

// TestRotatePQCKeyMsgFromMnemonic builds a legacy->canonical rotation message and
// asserts it is dual-signed correctly: both signatures verify against the
// domain-separated rotation bytes under their respective public keys, and the two
// derivations differ.
func TestRotatePQCKeyMsgFromMnemonic(t *testing.T) {
	acct, err := unified.DeriveUnifiedAccount(testMnemonic, 0)
	if err != nil {
		t.Fatalf("derive unified account: %v", err)
	}
	chainID := "qorechain-diana"

	res, err := RotatePQCKeyMsgFromMnemonic(acct.Cosmos, testMnemonic, chainID, 1, DerivationLegacy, DerivationCanonical)
	if err != nil {
		t.Fatalf("rotate from mnemonic: %v", err)
	}
	if res.Msg == nil {
		t.Fatal("nil rotate msg")
	}
	if res.Msg.Sender != acct.Cosmos {
		t.Fatalf("sender mismatch: want %s, got %s", acct.Cosmos, res.Msg.Sender)
	}

	// The canonical (new) key must equal the unified account's address-bound PQC key.
	if hex.EncodeToString(res.NewKeypair.PublicKey) != hex.EncodeToString(acct.Pqc.PublicKey) {
		t.Fatal("canonical derivation does not match unified account PQC key")
	}
	// The legacy (old) key must differ from the canonical one.
	if hex.EncodeToString(res.OldKeypair.PublicKey) == hex.EncodeToString(res.NewKeypair.PublicKey) {
		t.Fatal("legacy and canonical derivations produced the same key")
	}
	// Message must carry the derived public keys.
	if hex.EncodeToString(res.Msg.OldPublicKey) != hex.EncodeToString(res.OldKeypair.PublicKey) ||
		hex.EncodeToString(res.Msg.NewPublicKey) != hex.EncodeToString(res.NewKeypair.PublicKey) {
		t.Fatal("message public keys do not match derived keypairs")
	}

	// Both signatures must verify over the domain-separated rotation bytes.
	sb := []byte(RotationSignBytes(chainID, 1, acct.Cosmos, res.OldKeypair.PublicKey, res.NewKeypair.PublicKey))
	if !pqc.PQCVerify(res.OldKeypair.PublicKey, sb, res.Msg.OldSignature) {
		t.Fatal("old signature did not verify over rotation bytes")
	}
	if !pqc.PQCVerify(res.NewKeypair.PublicKey, sb, res.Msg.NewSignature) {
		t.Fatal("new signature did not verify over rotation bytes")
	}
}

// TestRotatePQCKeyMsgFromMnemonicNoOp asserts identical derivations are rejected.
func TestRotatePQCKeyMsgFromMnemonicNoOp(t *testing.T) {
	acct, err := unified.DeriveUnifiedAccount(testMnemonic, 0)
	if err != nil {
		t.Fatalf("derive unified account: %v", err)
	}
	if _, err := RotatePQCKeyMsgFromMnemonic(acct.Cosmos, testMnemonic, "qorechain-diana", 1, DerivationCanonical, DerivationCanonical); err == nil {
		t.Fatal("expected no-op rotation to be rejected")
	}
}

// TestRotatePQCKeyMsgFromMnemonicEVMAddress checks that a 0x EVM address resolves
// to the same canonical bech32 derivation as its cosmos form.
func TestRotatePQCKeyMsgFromMnemonicEVMAddress(t *testing.T) {
	acct, err := unified.DeriveUnifiedAccount(testMnemonic, 0)
	if err != nil {
		t.Fatalf("derive unified account: %v", err)
	}
	fromEVM, err := RotatePQCKeyMsgFromMnemonic(acct.Evm, testMnemonic, "qorechain-diana", 1, DerivationLegacy, DerivationCanonical)
	if err != nil {
		t.Fatalf("rotate from EVM addr: %v", err)
	}
	if hex.EncodeToString(fromEVM.NewKeypair.PublicKey) != hex.EncodeToString(acct.Pqc.PublicKey) {
		t.Fatal("EVM-addressed canonical derivation != unified account PQC key")
	}
}
