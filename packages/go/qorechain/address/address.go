// Package address provides conversion and validation for QoreChain bech32
// addresses (e.g. "qor1...") and their underlying byte payloads expressed as
// "0x"-prefixed hex.
//
// bech32 stores data as 5-bit groups ("words"), so encoding/decoding converts
// between those groups and the 8-bit byte representation callers work with.
package address

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcutil/bech32"
)

// DefaultPrefix is the default bech32 human-readable prefix for QoreChain
// account addresses.
const DefaultPrefix = "qor"

func stripHexPrefix(s string) string {
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		return s[2:]
	}
	return s
}

func hexToBytes(s string) ([]byte, error) {
	body := stripHexPrefix(s)
	if body == "" || len(body)%2 != 0 {
		return nil, fmt.Errorf("invalid hex string: %s", s)
	}
	b, err := hex.DecodeString(body)
	if err != nil {
		return nil, fmt.Errorf("invalid hex string: %s", s)
	}
	return b, nil
}

// BytesToBech32 encodes raw bytes to a bech32 address with the given prefix.
//
// This is the primitive encoder; callers holding a byte payload (e.g. the
// 20-byte ripemd160(sha256(pubkey)) account hash) should use it directly
// rather than round-tripping through hex.
func BytesToBech32(data []byte, prefix string) (string, error) {
	words, err := bech32.ConvertBits(data, 8, 5, true)
	if err != nil {
		return "", fmt.Errorf("failed to convert bytes to bech32 words: %w", err)
	}
	encoded, err := bech32.Encode(prefix, words)
	if err != nil {
		return "", fmt.Errorf("failed to encode bech32 address: %w", err)
	}
	return encoded, nil
}

// HexToBech32 encodes hex bytes to a bech32 address with the given prefix. It
// returns an error if hexStr is not a valid hex string.
func HexToBech32(hexStr, prefix string) (string, error) {
	b, err := hexToBytes(hexStr)
	if err != nil {
		return "", err
	}
	return BytesToBech32(b, prefix)
}

// Bech32ToHex decodes a bech32 address to a "0x"-prefixed hex string of its
// payload. It returns an error if addr is not a valid bech32 string.
func Bech32ToHex(addr string) (string, error) {
	_, words, err := bech32.Decode(addr)
	if err != nil {
		return "", fmt.Errorf("invalid bech32 address: %s", addr)
	}
	data, err := bech32.ConvertBits(words, 5, 8, false)
	if err != nil {
		return "", fmt.Errorf("invalid bech32 payload: %s", addr)
	}
	return "0x" + hex.EncodeToString(data), nil
}

// IsValidBech32 validates a bech32 address, optionally requiring a specific
// prefix.
//
// It returns true if addr is a structurally valid bech32 string (correct
// checksum) and, when prefix is non-empty, its prefix matches; false
// otherwise. It never returns an error.
func IsValidBech32(addr, prefix string) bool {
	hrp, _, err := bech32.Decode(addr)
	if err != nil {
		return false
	}
	if prefix == "" {
		return true
	}
	return strings.EqualFold(hrp, prefix)
}
