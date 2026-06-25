package tx

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"strconv"
	"strings"
)

// Default auto-gas parameters, matching the TS SDK.
const (
	// DefaultGasMultiplier scales simulated gas to absorb estimation variance.
	DefaultGasMultiplier = 1.4
	// DefaultGasPrice is the default price per gas unit, in uqor.
	DefaultGasPrice = "0.025uqor"
	// GasAuto is the sentinel Fee.Gas value that requests gas simulation.
	GasAuto = "auto"
)

// GasPrice is a parsed price per unit of gas (amount in a given denom).
type GasPrice struct {
	// Amount is the per-gas price (e.g. 0.025).
	Amount *big.Float
	// Denom is the fee denom (e.g. "uqor").
	Denom string
}

// ParseGasPrice parses a gas price string like "0.025uqor" into a GasPrice.
func ParseGasPrice(s string) (GasPrice, error) {
	s = strings.TrimSpace(s)
	// Split the numeric prefix from the denom suffix.
	i := 0
	for i < len(s) && (s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
		i++
	}
	if i == 0 || i == len(s) {
		return GasPrice{}, fmt.Errorf("invalid gas price: %q", s)
	}
	amount, ok := new(big.Float).SetString(s[:i])
	if !ok {
		return GasPrice{}, fmt.Errorf("invalid gas price amount: %q", s[:i])
	}
	return GasPrice{Amount: amount, Denom: s[i:]}, nil
}

// CalculateFee computes a Fee from a gas limit, a multiplier, and a gas price.
//
// gasLimit is multiplied by multiplier (rounded up) to obtain the fee gas; the
// fee amount is ceil(feeGas * price) in the price's denom. A multiplier <= 0
// falls back to DefaultGasMultiplier.
func CalculateFee(gasLimit uint64, multiplier float64, price GasPrice) (Fee, error) {
	if multiplier <= 0 {
		multiplier = DefaultGasMultiplier
	}
	feeGas := uint64(math.Ceil(float64(gasLimit) * multiplier))
	// amount = ceil(feeGas * price.Amount)
	feeGasF := new(big.Float).SetUint64(feeGas)
	amountF := new(big.Float).Mul(feeGasF, price.Amount)
	amountInt := new(big.Int)
	// Round up: add (1 - epsilon) before truncation by using big.Float.Int with
	// an explicit ceiling.
	amountF.Int(amountInt) // truncates toward zero
	// If there is a fractional remainder, round up.
	check := new(big.Float).SetInt(amountInt)
	if amountF.Cmp(check) > 0 {
		amountInt.Add(amountInt, big.NewInt(1))
	}
	return Fee{
		Amount: []Coin{{Denom: price.Denom, Amount: amountInt.String()}},
		Gas:    strconv.FormatUint(feeGas, 10),
	}, nil
}

// EstimateGas simulates a signed tx against the REST simulate endpoint and
// returns the gas the chain reports it would use.
//
// txBytes must be a fully assembled (signed) TxRaw; the simulate endpoint does
// not verify signatures but does require the tx structure. If httpClient is nil,
// http.DefaultClient is used.
func EstimateGas(restURL string, txBytes []byte, httpClient *http.Client) (uint64, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	payload, err := json.Marshal(map[string]string{
		"tx_bytes": base64.StdEncoding.EncodeToString(txBytes),
	})
	if err != nil {
		return 0, err
	}
	u := strings.TrimRight(restURL, "/") + "/cosmos/tx/v1beta1/simulate"
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("simulate HTTP %d for %s: %s", resp.StatusCode, u, string(body))
	}
	var sim struct {
		GasInfo struct {
			GasUsed string `json:"gas_used"`
		} `json:"gas_info"`
	}
	if err := json.Unmarshal(body, &sim); err != nil {
		return 0, fmt.Errorf("parse simulate response: %w", err)
	}
	if sim.GasInfo.GasUsed == "" {
		return 0, fmt.Errorf("simulate response missing gas_used: %s", string(body))
	}
	gasUsed, err := strconv.ParseUint(sim.GasInfo.GasUsed, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse gas_used %q: %w", sim.GasInfo.GasUsed, err)
	}
	return gasUsed, nil
}

// EstimateFee simulates txBytes and returns the auto-gas Fee (gasUsed ×
// multiplier × price). Pass an empty priceStr to use DefaultGasPrice and a
// multiplier <= 0 to use DefaultGasMultiplier.
func EstimateFee(restURL string, txBytes []byte, multiplier float64, priceStr string, httpClient *http.Client) (Fee, error) {
	if priceStr == "" {
		priceStr = DefaultGasPrice
	}
	price, err := ParseGasPrice(priceStr)
	if err != nil {
		return Fee{}, err
	}
	gasUsed, err := EstimateGas(restURL, txBytes, httpClient)
	if err != nil {
		return Fee{}, err
	}
	return CalculateFee(gasUsed, multiplier, price)
}
