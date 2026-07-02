package pqc

// Deterministic-signing regression tests.
//
// The chain's PQC verifier accepts ONLY deterministic (FIPS-204 §3.4,
// rnd = 32 zero bytes) ML-DSA-87 signatures; hedged signing is rejected with
// codespace "pqc". These tests pin the deterministic behaviour against the
// shared qorechain-pqc vectors.

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type vectorCase struct {
	Seed      string `json:"seed"`
	PublicKey string `json:"publicKey"`
	SecretKey string `json:"secretKey"`
	Message   string `json:"message"`
	Signature string `json:"signature"`
}

type vectorFile struct {
	Cases []vectorCase `json:"cases"`
}

func loadVectors(t *testing.T) []vectorCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/ml-dsa-87-deterministic.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var f vectorFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no vector cases")
	}
	return f.Cases
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	return b
}

func TestPQCSignIsDeterministic(t *testing.T) {
	kp, err := GeneratePQCKeypair()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	msg := []byte("deterministic ML-DSA-87 required by the chain")
	a, err := PQCSign(kp.SecretKey, msg)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	b, err := PQCSign(kp.SecretKey, msg)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("PQCSign is not deterministic: two signatures over the same input differ")
	}
}

func TestPQCSignMatchesSharedDeterministicVectors(t *testing.T) {
	for i, c := range loadVectors(t) {
		secretKey := mustHex(t, c.SecretKey)
		publicKey := mustHex(t, c.PublicKey)
		message := mustHex(t, c.Message)
		expected := mustHex(t, c.Signature)

		sig, err := PQCSign(secretKey, message)
		if err != nil {
			t.Fatalf("case %d: sign: %v", i, err)
		}
		if !bytes.Equal(sig, expected) {
			t.Errorf("case %d: signature does not match the shared deterministic vector", i)
		}
		if !PQCVerify(publicKey, message, sig) {
			t.Errorf("case %d: signature does not verify", i)
		}
	}
}
