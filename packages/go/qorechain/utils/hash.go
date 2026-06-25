// Package utils provides hashing, unit conversion, and address-validation
// helpers shared across the QoreChain SDK.
package utils

import (
	"crypto/sha256"

	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // ripemd160 is required by the Cosmos address derivation scheme.
	"golang.org/x/crypto/sha3"
)

// SHA256 returns the SHA-256 digest of data.
func SHA256(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}

// Keccak256 returns the Keccak-256 digest of data (the EVM hash, distinct from
// the FIPS-202 SHA3-256 padding).
func Keccak256(data ...[]byte) []byte {
	h := sha3.NewLegacyKeccak256()
	for _, d := range data {
		h.Write(d)
	}
	return h.Sum(nil)
}

// RIPEMD160 returns the RIPEMD-160 digest of data.
func RIPEMD160(data []byte) []byte {
	h := ripemd160.New()
	h.Write(data)
	return h.Sum(nil)
}

// Hash160 returns RIPEMD160(SHA256(data)) — the Cosmos account-address hash of a
// public key.
func Hash160(data []byte) []byte {
	return RIPEMD160(SHA256(data))
}
