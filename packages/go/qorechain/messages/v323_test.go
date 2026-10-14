package messages

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"golang.org/x/crypto/sha3"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/pqc"
)

func v323Keypair(t *testing.T) pqc.Keypair {
	t.Helper()
	var s [mldsa87.SeedSize]byte
	for i := range s {
		s[i] = 1
	}
	pub, priv := mldsa87.NewKeyFromSeed(&s)
	pb, _ := pub.MarshalBinary()
	sb, _ := priv.MarshalBinary()
	return pqc.Keypair{PublicKey: pb, SecretKey: sb}
}

func TestRegistrationIntegrity(t *testing.T) {
	kp := v323Keypair(t)
	if err := ValidateRegisteredPQCKey(KeyTypeClassicalOnly, kp.PublicKey); err == nil || !strings.Contains(err.Error(), "classical_only") {
		t.Fatalf("classical_only: %v", err)
	}
	if err := ValidateRegisteredPQCKey("hybrid", nil); err == nil {
		t.Fatal("empty key accepted")
	}
	degenerate := append(append([]byte{}, kp.PublicKey[:32]...), make([]byte, 2560)...)
	if !IsDegeneratePQCPublicKey(degenerate) || ValidateRegisteredPQCKey("hybrid", degenerate) == nil {
		t.Fatal("degenerate key accepted")
	}
	if IsDegeneratePQCPublicKey(kp.PublicKey) || ValidateRegisteredPQCKey("hybrid", kp.PublicKey) != nil {
		t.Fatal("real key refused")
	}
}

func TestProofOfPossession(t *testing.T) {
	kp := v323Keypair(t)
	bz, err := ProofOfPossessionSignBytes("qorechain-diana", 1, v322Sender, []byte{0xAB, 0xCD})
	if err != nil || string(bz) != "qorechain-pqc-pop-v1|qorechain-diana|1|"+v322Sender+"|abcd" {
		t.Fatalf("sign bytes %q %v", bz, err)
	}
	a, err := SignProofOfPossession("qorechain-diana", v322Sender, kp)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := SignProofOfPossession("qorechain-diana", v322Sender, kp)
	if !bytes.Equal(a, b) || len(a) != 4627 {
		t.Fatal("proof must be deterministic, 4627 bytes")
	}
	fp := make([]byte, 16)
	sha3.ShakeSum256(fp, a)
	// Same vector as every other SDK.
	if hex.EncodeToString(fp) != "5b767a00efb7ad721f5416a4bd7fcdad" {
		t.Fatalf("cross-SDK vector: %x", fp)
	}
	if !VerifyProofOfPossession("qorechain-diana", v322Sender, kp.PublicKey, a) {
		t.Fatal("proof does not verify")
	}
	if VerifyProofOfPossession("qorechain-vladi", v322Sender, kp.PublicKey, a) {
		t.Fatal("proof must be bound to the chain")
	}
}

func TestOpenEVMWindowScoped(t *testing.T) {
	const target = "0x63C0c19a282a1B52b07dD5a65b58948A07DAE32B"
	m, err := NewOpenEVMWindowScoped(v322Sender, 10, 1, "1", true, []string{target})
	if err != nil || !m.NativeOnly || len(m.AllowedTargets) != 1 {
		t.Fatalf("scoped: %+v %v", m, err)
	}
	if _, err := NewOpenEVMWindowScoped(v322Sender, 10, 1, "1", false, []string{"0x12"}); err == nil {
		t.Fatal("bad target accepted")
	}
	if _, err := NewOpenEVMWindowScoped(v322Sender, 10, 1, "1", false, []string{target, strings.ToLower(target)}); err == nil {
		t.Fatal("duplicate target accepted")
	}
	many := make([]string, MaxEVMWindowTargets+1)
	for i := range many {
		many[i] = "0x" + strings.Repeat("0", 38) + hex.EncodeToString([]byte{byte(i)})
	}
	if _, err := NewOpenEVMWindowScoped(v322Sender, 10, 1, "1", false, many); err == nil || !strings.Contains(err.Error(), "maximum is 16") {
		t.Fatalf("too many targets: %v", err)
	}
	plain, _ := NewOpenEVMWindow(v322Sender, 10, 1, "1")
	pb, _ := plain.Marshal()
	sb, _ := m.Marshal()
	if len(pb) >= len(sb) {
		t.Fatal("an unscoped window must leave the new fields off the wire")
	}
}
