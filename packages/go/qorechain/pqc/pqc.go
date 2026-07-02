// Package pqc provides post-quantum (PQC) signing for QoreChain, using
// ML-DSA-87 (Dilithium-5, NIST FIPS 204) for digital signatures.
//
// QoreChain treats PQC as a first-class signature scheme via a hybrid
// architecture: a transaction carries the usual classical (secp256k1 / ed25519)
// signature PLUS an ML-DSA-87 signature attached as a PQCHybridSignature TX
// extension. The chain's ante handler verifies both, so quantum-safe wallets
// stay compatible with classical verification.
//
// This package provides the signing primitives (keygen / sign / verify) and a
// builder for the on-chain hybrid-signature extension object. Crypto is
// delegated to the FIPS-204 ML-DSA-87 implementation; no primitives are
// reimplemented here.
package pqc

import (
	"errors"
	"fmt"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
)

// ML-DSA-87 key and signature lengths, in bytes (FIPS 204 / core).
const (
	MLDSA87PublicKeyLength = 2592
	MLDSA87SecretKeyLength = 4896
	MLDSA87SignatureLength = 4627
)

// PQC algorithm identifiers, mirroring the chain's x/pqc framework.
const (
	// AlgorithmUnspecified is the unset / invalid algorithm.
	AlgorithmUnspecified = 0
	// AlgorithmDilithium5 is Dilithium-5 = ML-DSA-87, NIST FIPS 204 signatures.
	AlgorithmDilithium5 = 1
	// AlgorithmMLKEM1024 is ML-KEM-1024, NIST FIPS 203 key encapsulation.
	AlgorithmMLKEM1024 = 2
)

// HybridSigTypeURL is the TX-extension type URL for the on-chain
// PQCHybridSignature message.
const HybridSigTypeURL = "/qorechain.pqc.v1.PQCHybridSignature"

// AlgorithmName returns the human-readable name for an algorithm ID (matches
// core String()).
func AlgorithmName(algorithmID int) string {
	switch algorithmID {
	case AlgorithmUnspecified:
		return "unspecified"
	case AlgorithmDilithium5:
		return "dilithium5"
	case AlgorithmMLKEM1024:
		return "mlkem1024"
	default:
		return fmt.Sprintf("algorithm_%d", algorithmID)
	}
}

// IsSignatureAlgorithm reports whether the algorithm is a digital-signature
// scheme.
func IsSignatureAlgorithm(algorithmID int) bool {
	return algorithmID == AlgorithmDilithium5
}

// Keypair is an ML-DSA-87 (Dilithium-5) keypair. Treat SecretKey as a secret.
type Keypair struct {
	PublicKey []byte
	SecretKey []byte
}

// GeneratePQCKeypair generates an ML-DSA-87 (Dilithium-5) keypair.
func GeneratePQCKeypair() (Keypair, error) {
	pub, priv, err := mldsa87.GenerateKey(nil)
	if err != nil {
		return Keypair{}, err
	}
	pubBytes, err := pub.MarshalBinary()
	if err != nil {
		return Keypair{}, err
	}
	privBytes, err := priv.MarshalBinary()
	if err != nil {
		return Keypair{}, err
	}
	return Keypair{PublicKey: pubBytes, SecretKey: privBytes}, nil
}

// PQCSign signs a message with an ML-DSA-87 (Dilithium-5) secret key.
//
// Signing is DETERMINISTIC (FIPS-204 §3.4, rnd = 32 zero bytes): the same
// (secretKey, message) always yields the same signature. The chain's on-chain
// PQC verifier accepts ONLY deterministic ML-DSA-87 signatures (hedged
// signatures are rejected with codespace "pqc"), so this is
// consensus-critical — do not switch to randomized signing.
func PQCSign(secretKey, message []byte) ([]byte, error) {
	var priv mldsa87.PrivateKey
	if err := priv.UnmarshalBinary(secretKey); err != nil {
		return nil, fmt.Errorf("invalid PQC secret key: %w", err)
	}
	sig := make([]byte, mldsa87.SignatureSize)
	// Deterministic signing (nil randomness), empty context.
	if err := mldsa87.SignTo(&priv, message, nil, false, sig); err != nil {
		return nil, err
	}
	return sig, nil
}

// PQCVerify verifies an ML-DSA-87 (Dilithium-5) signature over a message.
func PQCVerify(publicKey, message, signature []byte) bool {
	var pub mldsa87.PublicKey
	if err := pub.UnmarshalBinary(publicKey); err != nil {
		return false
	}
	return mldsa87.Verify(&pub, message, nil, signature)
}

// HybridSignatureExtension is the on-chain PQCHybridSignature TX extension. Its
// JSON field tags mirror the core struct exactly. PqcSignature and
// PqcPublicKey marshal to standard (padded) base64 via Go's []byte JSON
// encoding; PqcPublicKey is omitted entirely when no public key is supplied.
type HybridSignatureExtension struct {
	AlgorithmID  int    `json:"algorithm_id"`
	PqcSignature []byte `json:"pqc_signature"`
	PqcPublicKey []byte `json:"pqc_public_key,omitempty"`
}

// BuildHybridSignatureExtension builds the on-chain PQCHybridSignature
// extension object.
//
// Validation mirrors the core PQCHybridSignature.Validate(): the algorithm must
// be a signature scheme, the signature must be non-empty, and for Dilithium-5
// the signature/public-key lengths are enforced. PqcPublicKey is omitted when
// publicKey is nil.
func BuildHybridSignatureExtension(algorithmID int, signature, publicKey []byte) (HybridSignatureExtension, error) {
	if !IsSignatureAlgorithm(algorithmID) {
		return HybridSignatureExtension{}, fmt.Errorf("algorithm %s is not a PQC signature algorithm", AlgorithmName(algorithmID))
	}
	if len(signature) == 0 {
		return HybridSignatureExtension{}, errors.New("PQC signature cannot be empty")
	}
	if algorithmID == AlgorithmDilithium5 {
		if len(signature) != MLDSA87SignatureLength {
			return HybridSignatureExtension{}, fmt.Errorf("dilithium5 signature must be %d bytes, got %d", MLDSA87SignatureLength, len(signature))
		}
		if publicKey != nil && len(publicKey) != MLDSA87PublicKeyLength {
			return HybridSignatureExtension{}, fmt.Errorf("dilithium5 public key must be %d bytes, got %d", MLDSA87PublicKeyLength, len(publicKey))
		}
	}
	ext := HybridSignatureExtension{
		AlgorithmID:  algorithmID,
		PqcSignature: signature,
	}
	if publicKey != nil {
		ext.PqcPublicKey = publicKey
	}
	return ext, nil
}
