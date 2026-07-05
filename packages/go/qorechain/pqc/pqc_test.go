package pqc

import (
	"bytes"
	"testing"

	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
)

func TestKeypairSizes(t *testing.T) {
	kp, err := GeneratePQCKeypair()
	if err != nil {
		t.Fatal(err)
	}
	if len(kp.PublicKey) != MLDSA87PublicKeyLength {
		t.Errorf("public key len = %d, want %d", len(kp.PublicKey), MLDSA87PublicKeyLength)
	}
	if len(kp.SecretKey) != MLDSA87SecretKeyLength {
		t.Errorf("secret key len = %d, want %d", len(kp.SecretKey), MLDSA87SecretKeyLength)
	}
	if MLDSA87PublicKeyLength != 2592 || MLDSA87SecretKeyLength != 4896 || MLDSA87SignatureLength != 4627 {
		t.Errorf("constants drifted: %d/%d/%d", MLDSA87PublicKeyLength, MLDSA87SecretKeyLength, MLDSA87SignatureLength)
	}
}

func TestSignVerify(t *testing.T) {
	kp, err := GeneratePQCKeypair()
	if err != nil {
		t.Fatal(err)
	}
	msg := []byte("qorechain hybrid signature test")
	sig, err := PQCSign(kp.SecretKey, msg)
	if err != nil {
		t.Fatal(err)
	}
	if len(sig) != MLDSA87SignatureLength {
		t.Errorf("signature len = %d, want %d", len(sig), MLDSA87SignatureLength)
	}
	if !PQCVerify(kp.PublicKey, msg, sig) {
		t.Error("valid signature should verify")
	}
}

func TestTamperFails(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	msg := []byte("hello")
	sig, _ := PQCSign(kp.SecretKey, msg)

	// Tampered message.
	if PQCVerify(kp.PublicKey, []byte("hellp"), sig) {
		t.Error("tampered message should not verify")
	}
	// Tampered signature.
	bad := append([]byte(nil), sig...)
	bad[0] ^= 0xff
	if PQCVerify(kp.PublicKey, msg, bad) {
		t.Error("tampered signature should not verify")
	}
}

func TestAlgorithmHelpers(t *testing.T) {
	if AlgorithmDilithium5 != 1 || AlgorithmMLKEM1024 != 2 {
		t.Errorf("algorithm constants drifted: %d %d", AlgorithmDilithium5, AlgorithmMLKEM1024)
	}
	if AlgorithmName(AlgorithmDilithium5) != "dilithium5" {
		t.Errorf("name = %q", AlgorithmName(AlgorithmDilithium5))
	}
	if AlgorithmName(AlgorithmMLKEM1024) != "mlkem1024" {
		t.Errorf("name = %q", AlgorithmName(AlgorithmMLKEM1024))
	}
	if !IsSignatureAlgorithm(AlgorithmDilithium5) {
		t.Error("dilithium5 should be a signature algorithm")
	}
	if IsSignatureAlgorithm(AlgorithmMLKEM1024) {
		t.Error("mlkem1024 is not a signature algorithm")
	}
	if HybridSigTypeURL != "/qorechain.pqc.v1.PQCHybridSignature" {
		t.Errorf("type url = %q", HybridSigTypeURL)
	}
}

func TestEncodeHybridSignatureExtensionProto(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))

	value, err := EncodeHybridSignatureExtension(AlgorithmDilithium5, sig, kp.PublicKey)
	if err != nil {
		t.Fatal(err)
	}

	// CONSENSUS-CRITICAL: the extension value must be protobuf, not Go-JSON. Its
	// first byte is the field-1 varint tag 0x08, NEVER '{' (0x7b) — the chain's
	// tx decoder rejects a 0x7b-leading value (misread as field 15 start_group).
	if len(value) == 0 {
		t.Fatal("encoded extension value is empty")
	}
	if value[0] != 0x08 {
		t.Errorf("extension value[0] = 0x%02x, want 0x08 (proto field-1 tag)", value[0])
	}
	if value[0] == 0x7b {
		t.Error("extension value is Go-JSON ('{' = 0x7b); it must be protobuf")
	}

	// Round-trip: unmarshal into the generated PQCHybridSignature message.
	var decoded pqcv1.PQCHybridSignature
	if err := decoded.Unmarshal(value); err != nil {
		t.Fatalf("proto unmarshal failed: %v", err)
	}
	if int(decoded.AlgorithmID) != AlgorithmDilithium5 {
		t.Errorf("AlgorithmID = %d, want %d", decoded.AlgorithmID, AlgorithmDilithium5)
	}
	if !bytes.Equal(decoded.PQCSignature, sig) {
		t.Error("PqcSignature did not round-trip")
	}
	if !bytes.Equal(decoded.PQCPublicKey, kp.PublicKey) {
		t.Error("PqcPublicKey did not round-trip")
	}
}

func TestEncodeHybridSignatureExtensionOmitsPublicKey(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))
	value, err := EncodeHybridSignatureExtension(AlgorithmDilithium5, sig, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(value) == 0 || value[0] != 0x08 {
		t.Fatalf("extension value must be proto-encoded starting with 0x08")
	}
	var decoded pqcv1.PQCHybridSignature
	if err := decoded.Unmarshal(value); err != nil {
		t.Fatalf("proto unmarshal failed: %v", err)
	}
	if len(decoded.PQCPublicKey) != 0 {
		t.Error("PqcPublicKey should be empty when public key is nil")
	}
}

func TestEncodeHybridSignatureExtensionValidation(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))

	// Non-signature algorithm.
	if _, err := EncodeHybridSignatureExtension(AlgorithmMLKEM1024, sig, nil); err == nil {
		t.Error("expected error for non-signature algorithm")
	}
	// Empty signature.
	if _, err := EncodeHybridSignatureExtension(AlgorithmDilithium5, nil, nil); err == nil {
		t.Error("expected error for empty signature")
	}
	// Wrong signature length.
	if _, err := EncodeHybridSignatureExtension(AlgorithmDilithium5, sig[:10], nil); err == nil {
		t.Error("expected error for wrong signature length")
	}
	// Wrong public key length.
	if _, err := EncodeHybridSignatureExtension(AlgorithmDilithium5, sig, []byte{1, 2, 3}); err == nil {
		t.Error("expected error for wrong public key length")
	}
}
