package utils

import (
	"encoding/hex"
	"strings"

	"github.com/mr-tron/base58"
)

// IsValidEVMAddress reports whether s is a structurally valid EVM address: a
// "0x"-prefixed 40-hex-character string. It does not verify the EIP-55 checksum;
// use ToChecksumAddress to produce a checksummed form.
func IsValidEVMAddress(s string) bool {
	if len(s) != 42 {
		return false
	}
	if s[0] != '0' || (s[1] != 'x' && s[1] != 'X') {
		return false
	}
	_, err := hex.DecodeString(s[2:])
	return err == nil
}

// IsValidSVMAddress reports whether s is a structurally valid SVM address: a
// base58 string that decodes to exactly 32 bytes.
func IsValidSVMAddress(s string) bool {
	decoded, err := base58.Decode(s)
	if err != nil {
		return false
	}
	return len(decoded) == 32
}

// ToChecksumAddress returns the EIP-55 mixed-case checksum form of an EVM
// address. It returns an error if s is not a valid 20-byte hex address.
func ToChecksumAddress(s string) (string, error) {
	if !IsValidEVMAddress(s) {
		return "", errInvalidEVMAddress(s)
	}
	lower := strings.ToLower(s[2:])
	hash := Keccak256([]byte(lower))
	out := []byte("0x")
	for i := 0; i < len(lower); i++ {
		c := lower[i]
		if c >= '0' && c <= '9' {
			out = append(out, c)
			continue
		}
		// Uppercase the hex letter when the corresponding hash nibble >= 8.
		nibble := hash[i/2]
		if i%2 == 0 {
			nibble >>= 4
		}
		nibble &= 0x0f
		if nibble >= 8 {
			out = append(out, byte(strings.ToUpper(string(c))[0]))
		} else {
			out = append(out, c)
		}
	}
	return string(out), nil
}

type errInvalidEVMAddress string

func (e errInvalidEVMAddress) Error() string {
	return "invalid EVM address: " + string(e)
}
