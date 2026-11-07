package unified

// PQC recovery codes (QRC1).
//
// A recovery code is a second secret, generated at random and held by the user,
// that the account's classical secp256k1 key says nothing about. The ML-DSA-87
// key is derived from it and from the account address, so the post-quantum half
// of a hybrid signature needs something the classical half does not have.
//
// Format: "QRC1-" followed by 14 groups of 4 Crockford base32 characters
// (56 characters, 280 bits). The payload is the 32-byte secret followed by a
// 3-byte checksum, shake256("qorechain:pqc:recovery:v1:checksum" || secret, 3).
// Input is case-insensitive, separators and spaces are ignored, and the letters
// people confuse are read as what was meant (O as 0, I and L as 1).
//
// The code is the secret. Show it once, have the user write it down, and never
// store it next to the account's seed phrase.
//
// The format and the key derivation match @qorechain/wallet-adapter
// (generatePqcRecoveryCode / pqcKeyFromRecoveryCode) byte for byte.

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcutil/bech32"
)

// RecoveryCodePrefix names and versions a PQC recovery code.
const RecoveryCodePrefix = "QRC1"

const (
	recoveryAlphabet      = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" // Crockford: no I L O U
	recoverySecretBytes   = 32
	recoveryChecksumBytes = 3
	recoveryPayloadBytes  = recoverySecretBytes + recoveryChecksumBytes // 35 bytes = 280 bits
	recoveryCodeChars     = recoveryPayloadBytes * 8 / 5                // 56
	recoveryGroup         = 4

	recoveryChecksumDomain = "qorechain:pqc:recovery:v1:checksum"
	recoveryKeyDomain      = "qorechain:pqc:recovery:v1"
)

func recoveryChecksum(secret []byte) []byte {
	in := make([]byte, 0, len(recoveryChecksumDomain)+len(secret))
	in = append(in, recoveryChecksumDomain...)
	in = append(in, secret...)
	sum := shake256(in, recoveryChecksumBytes)
	zero(in)
	return sum
}

func encodeBase32(data []byte) string {
	var sb strings.Builder
	var value uint32
	bits := 0
	for _, b := range data {
		value = (value << 8) | uint32(b)
		bits += 8
		for bits >= 5 {
			sb.WriteByte(recoveryAlphabet[(value>>(bits-5))&31])
			bits -= 5
		}
	}
	if bits > 0 {
		sb.WriteByte(recoveryAlphabet[(value<<(5-bits))&31])
	}
	return sb.String()
}

func decodeBase32(chars string) ([]byte, error) {
	out := make([]byte, 0, len(chars)*5/8)
	var value uint32
	bits := 0
	for i := 0; i < len(chars); i++ {
		v := strings.IndexByte(recoveryAlphabet, chars[i])
		if v < 0 {
			zero(out)
			return nil, fmt.Errorf("recovery code contains an invalid character %q", chars[i])
		}
		value = (value << 5) | uint32(v)
		bits += 5
		if bits >= 8 {
			out = append(out, byte(value>>(bits-8)))
			bits -= 8
		}
	}
	return out, nil
}

// normalizeRecoveryCode turns what a person typed into the 56 data characters:
// upper-case, separators and spaces dropped, confusable letters read as meant,
// and the "QRC1" prefix removed when the length says it is there.
func normalizeRecoveryCode(code string) (string, error) {
	var sb strings.Builder
	for _, r := range strings.ToUpper(code) {
		switch {
		case r == '-' || r == '_' || r == '.':
			continue
		case r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f':
			continue
		case r == 'O':
			sb.WriteByte('0')
		case r == 'I' || r == 'L':
			sb.WriteByte('1')
		default:
			sb.WriteRune(r)
		}
	}
	s := sb.String()
	// 56 data characters can begin with "QRC1" by chance, so strip the prefix
	// only when the length shows it is present.
	if len(s) == recoveryCodeChars+len(RecoveryCodePrefix) && strings.HasPrefix(s, RecoveryCodePrefix) {
		s = s[len(RecoveryCodePrefix):]
	}
	if len(s) != recoveryCodeChars {
		return "", fmt.Errorf("recovery code must have %d characters after %q, got %d", recoveryCodeChars, RecoveryCodePrefix+"-", len(s))
	}
	if strings.ContainsRune(s, 'U') {
		return "", errors.New(`recovery code contains an invalid character "U"`)
	}
	return s, nil
}

// decodeRecoveryCode returns the 32-byte secret of a well-formed code. The
// caller owns the returned slice and should zero it after use.
func decodeRecoveryCode(code string) ([]byte, error) {
	chars, err := normalizeRecoveryCode(code)
	if err != nil {
		return nil, err
	}
	payload, err := decodeBase32(chars)
	if err != nil {
		return nil, err
	}
	defer zero(payload)
	if len(payload) != recoveryPayloadBytes {
		return nil, errors.New("recovery code has the wrong length")
	}
	secret := make([]byte, recoverySecretBytes)
	copy(secret, payload[:recoverySecretBytes])
	want := recoveryChecksum(secret)
	if subtle.ConstantTimeCompare(payload[recoverySecretBytes:], want) != 1 {
		zero(secret)
		return nil, errors.New("recovery code checksum does not match, a character is mistyped")
	}
	return secret, nil
}

func formatRecoveryCode(chars string) string {
	groups := make([]string, 0, len(chars)/recoveryGroup)
	for i := 0; i < len(chars); i += recoveryGroup {
		groups = append(groups, chars[i:i+recoveryGroup])
	}
	return RecoveryCodePrefix + "-" + strings.Join(groups, "-")
}

// PQCRecoveryCodeFromSecret encodes 32 bytes of secret entropy as a QRC1
// recovery code. Use it when the app already holds the secret; otherwise call
// GeneratePQCRecoveryCode.
func PQCRecoveryCodeFromSecret(secret32 []byte) (string, error) {
	if len(secret32) != recoverySecretBytes {
		return "", fmt.Errorf("recovery secret must be %d bytes, got %d", recoverySecretBytes, len(secret32))
	}
	payload := make([]byte, 0, recoveryPayloadBytes)
	payload = append(payload, secret32...)
	payload = append(payload, recoveryChecksum(secret32)...)
	code := formatRecoveryCode(encodeBase32(payload))
	zero(payload)
	return code, nil
}

// GeneratePQCRecoveryCode returns a new QRC1 recovery code from 32 bytes of
// crypto/rand entropy. Show it to the user once; it is the secret.
func GeneratePQCRecoveryCode() (string, error) {
	secret := make([]byte, recoverySecretBytes)
	defer zero(secret)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("read random secret: %w", err)
	}
	return PQCRecoveryCodeFromSecret(secret)
}

// IsValidRecoveryCode reports whether code is a well-formed QRC1 recovery code
// with a valid checksum.
func IsValidRecoveryCode(code string) bool {
	secret, err := decodeRecoveryCode(code)
	if err != nil {
		return false
	}
	zero(secret)
	return true
}

// PQCKeyFromRecoveryCode derives the account's ML-DSA-87 keypair from its
// recovery code and its qor1 address:
//
//	seed = shake256("qorechain:pqc:recovery:v1|" + lower(address) + "|" || secret32, 32)
//
// The key is bound to the address, so one code yields a different key for every
// account, and nothing here depends on the account's classical key. A malformed
// code or a checksum mismatch returns an error; no key is ever derived from a
// mistyped code.
func PQCKeyFromRecoveryCode(code, qor1Address string) (PQCKeypair, error) {
	addr, err := normalizeQorAddress(qor1Address)
	if err != nil {
		return PQCKeypair{}, err
	}
	secret, err := decodeRecoveryCode(code)
	if err != nil {
		return PQCKeypair{}, err
	}
	defer zero(secret)
	return pqcFromRecoverySecret(secret, addr)
}

// pqcFromRecoverySecret derives the ML-DSA-87 keypair from a 32-byte recovery
// secret and an already-lowercased qor1 address.
func pqcFromRecoverySecret(secret32 []byte, lowerAddress string) (PQCKeypair, error) {
	if len(secret32) != recoverySecretBytes {
		return PQCKeypair{}, fmt.Errorf("pqc secret must be %d bytes, got %d", recoverySecretBytes, len(secret32))
	}
	prefix := recoveryKeyDomain + "|" + lowerAddress + "|"
	in := make([]byte, 0, len(prefix)+len(secret32))
	in = append(in, prefix...)
	in = append(in, secret32...)
	seed := shake256(in, 32)
	zero(in)
	defer zero(seed)
	return pqcFromSeed(seed)
}

// normalizeQorAddress checks that address is a qor1 bech32 address and returns
// it lowercased.
func normalizeQorAddress(address string) (string, error) {
	lower := strings.ToLower(address)
	hrp, _, err := bech32.Decode(lower)
	if err != nil || hrp != NativePrefix {
		return "", errors.New("address must be the account's qor1 address")
	}
	return lower, nil
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
