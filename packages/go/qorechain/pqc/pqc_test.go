package pqc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
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

func TestBuildHybridSignatureExtensionJSON(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))

	ext, err := BuildHybridSignatureExtension(AlgorithmDilithium5, sig, kp.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(ext)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, ok := decoded["algorithm_id"]; !ok {
		t.Error("missing algorithm_id field")
	}
	if string(decoded["algorithm_id"]) != "1" {
		t.Errorf("algorithm_id = %s", decoded["algorithm_id"])
	}

	// pqc_signature must be standard base64 decoding back to sig.
	var sigB64 string
	if err := json.Unmarshal(decoded["pqc_signature"], &sigB64); err != nil {
		t.Fatal(err)
	}
	gotSig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		t.Fatalf("pqc_signature is not std base64: %v", err)
	}
	if !bytes.Equal(gotSig, sig) {
		t.Error("pqc_signature did not round-trip")
	}

	var pkB64 string
	if err := json.Unmarshal(decoded["pqc_public_key"], &pkB64); err != nil {
		t.Fatal(err)
	}
	gotPk, _ := base64.StdEncoding.DecodeString(pkB64)
	if !bytes.Equal(gotPk, kp.PublicKey) {
		t.Error("pqc_public_key did not round-trip")
	}
}

func TestBuildHybridSignatureExtensionOmitsPublicKey(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))
	ext, err := BuildHybridSignatureExtension(AlgorithmDilithium5, sig, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(ext)
	var decoded map[string]json.RawMessage
	_ = json.Unmarshal(raw, &decoded)
	if _, ok := decoded["pqc_public_key"]; ok {
		t.Error("pqc_public_key should be omitted when public key is nil")
	}
}

func TestBuildHybridSignatureExtensionValidation(t *testing.T) {
	kp, _ := GeneratePQCKeypair()
	sig, _ := PQCSign(kp.SecretKey, []byte("m"))

	// Non-signature algorithm.
	if _, err := BuildHybridSignatureExtension(AlgorithmMLKEM1024, sig, nil); err == nil {
		t.Error("expected error for non-signature algorithm")
	}
	// Empty signature.
	if _, err := BuildHybridSignatureExtension(AlgorithmDilithium5, nil, nil); err == nil {
		t.Error("expected error for empty signature")
	}
	// Wrong signature length.
	if _, err := BuildHybridSignatureExtension(AlgorithmDilithium5, sig[:10], nil); err == nil {
		t.Error("expected error for wrong signature length")
	}
	// Wrong public key length.
	if _, err := BuildHybridSignatureExtension(AlgorithmDilithium5, sig, []byte{1, 2, 3}); err == nil {
		t.Error("expected error for wrong public key length")
	}
}
