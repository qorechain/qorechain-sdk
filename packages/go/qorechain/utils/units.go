package utils

import (
	"fmt"
	"math/big"
	"strings"
)

// ParseUnits converts a human display amount string (e.g. "1.5") into its
// integer base amount string given a number of decimals (e.g. 18 → wei). All
// math is exact (big.Int); no floating point. It rejects negatives, scientific
// notation, and more fractional digits than decimals allow.
func ParseUnits(amount string, decimals int) (string, error) {
	if decimals < 0 {
		return "", fmt.Errorf("invalid decimals: %d", decimals)
	}
	body := strings.TrimSpace(amount)
	if strings.HasPrefix(body, "-") {
		return "", fmt.Errorf("negative amounts are not supported: %s", amount)
	}
	body = strings.TrimPrefix(body, "+")
	if body == "" {
		return "", fmt.Errorf("empty amount")
	}
	intPart, fracPart, hasFrac := strings.Cut(body, ".")
	if intPart == "" {
		intPart = "0"
	}
	if !isDigits(intPart) || (hasFrac && !isDigits(fracPart)) {
		return "", fmt.Errorf("invalid decimal amount: %s", amount)
	}
	if len(fracPart) > decimals {
		return "", fmt.Errorf("too many decimal places in %s: %d > decimals %d", amount, len(fracPart), decimals)
	}
	padded := fracPart + strings.Repeat("0", decimals-len(fracPart))
	n, ok := new(big.Int).SetString(intPart+padded, 10)
	if !ok {
		return "", fmt.Errorf("invalid decimal amount: %s", amount)
	}
	return n.String(), nil
}

// FormatUnits converts an integer base amount string into a normalized human
// display string given a number of decimals. Trailing zeros and a trailing dot
// are stripped (e.g. base "1500000000000000000", 18 → "1.5").
func FormatUnits(base string, decimals int) (string, error) {
	if decimals < 0 {
		return "", fmt.Errorf("invalid decimals: %d", decimals)
	}
	trimmed := strings.TrimSpace(base)
	if strings.HasPrefix(trimmed, "-") {
		return "", fmt.Errorf("negative amounts are not supported: %s", base)
	}
	if !isDigits(trimmed) {
		return "", fmt.Errorf("invalid base amount: %s", base)
	}
	n, ok := new(big.Int).SetString(trimmed, 10)
	if !ok {
		return "", fmt.Errorf("invalid base amount: %s", base)
	}
	if decimals == 0 {
		return n.String(), nil
	}
	digits := n.String()
	if len(digits) <= decimals {
		digits = strings.Repeat("0", decimals+1-len(digits)) + digits
	}
	intPart := digits[:len(digits)-decimals]
	fracPart := digits[len(digits)-decimals:]
	trimmedFrac := strings.TrimRight(fracPart, "0")
	if trimmedFrac == "" {
		return intPart, nil
	}
	return intPart + "." + trimmedFrac, nil
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
