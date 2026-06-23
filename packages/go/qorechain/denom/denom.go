// Package denom converts between human display amounts and integer base
// amounts.
//
// All value math is performed with integer (big.Int) arithmetic on decimal
// strings — there is no floating-point arithmetic anywhere in this package, so
// conversions are exact for any magnitude and never drift (e.g.
// ToBase("0.1", 6) == "100000").
//
// QoreChain's staking coin uses a default exponent of 6 (1 QOR = 10^6 uqor),
// but every function accepts a custom exponent for other denominations.
package denom

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// DefaultExponent is the QoreChain staking coin's default decimal exponent
// (1 QOR = 10^6 uqor).
const DefaultExponent = 6

var (
	decimalRE = regexp.MustCompile(`^\d+(\.\d+)?$`)
	intRE     = regexp.MustCompile(`^\d+$`)
)

func resolveExponent(exponent int) error {
	if exponent < 0 {
		return fmt.Errorf("invalid exponent: %d (must be a non-negative integer)", exponent)
	}
	return nil
}

// ToBase converts a human display amount to its integer base amount string.
//
// amount is a non-negative decimal string, e.g. "1.5". Surrounding whitespace
// and a single leading "+" are tolerated. Scientific notation, thousands
// separators, and other formatting are rejected. It returns an error if amount
// is not a valid decimal string, is negative, or has more fractional digits
// than exponent allows.
func ToBase(amount string, exponent int) (string, error) {
	if err := resolveExponent(exponent); err != nil {
		return "", err
	}
	body := strings.TrimSpace(amount)

	if strings.HasPrefix(body, "-") {
		return "", fmt.Errorf("negative amounts are not supported: %s", amount)
	}
	body = strings.TrimPrefix(body, "+")

	if !decimalRE.MatchString(body) {
		return "", fmt.Errorf("invalid decimal amount: %s", amount)
	}

	intPart, fracPart, _ := strings.Cut(body, ".")
	if len(fracPart) > exponent {
		return "", fmt.Errorf("too many decimal places in %s: %d > exponent %d", amount, len(fracPart), exponent)
	}

	padded := fracPart + strings.Repeat("0", exponent-len(fracPart))
	n, ok := new(big.Int).SetString(intPart+padded, 10)
	if !ok {
		return "", fmt.Errorf("invalid decimal amount: %s", amount)
	}
	return n.String(), nil
}

// FromBase converts an integer base amount string to a normalized display
// string.
//
// base is a non-negative integer string, e.g. "1500000". The returned display
// amount has no trailing zeros and no trailing dot, e.g. "1.5". "1000000"
// becomes "1", "1" becomes "0.000001", "0" becomes "0". It returns an error if
// base is not a valid non-negative integer string.
func FromBase(base string, exponent int) (string, error) {
	if err := resolveExponent(exponent); err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(base)

	if strings.HasPrefix(trimmed, "-") {
		return "", fmt.Errorf("negative amounts are not supported: %s", base)
	}
	if !intRE.MatchString(trimmed) {
		return "", fmt.Errorf("invalid base amount: %s", base)
	}

	// Normalize leading zeros via big.Int.
	n, ok := new(big.Int).SetString(trimmed, 10)
	if !ok {
		return "", fmt.Errorf("invalid base amount: %s", base)
	}
	if exponent == 0 {
		return n.String(), nil
	}

	digits := n.String()
	if len(digits) <= exponent {
		digits = strings.Repeat("0", exponent+1-len(digits)) + digits
	}
	intPart := digits[:len(digits)-exponent]
	fracPart := digits[len(digits)-exponent:]

	trimmedFrac := strings.TrimRight(fracPart, "0")
	if trimmedFrac == "" {
		return intPart, nil
	}
	return intPart + "." + trimmedFrac, nil
}
