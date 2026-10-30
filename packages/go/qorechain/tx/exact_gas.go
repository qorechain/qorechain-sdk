package tx

import (
	"math"
	"net/http"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// Gas for hybrid-signed transactions on chain v3.2.5 and later.
//
// From v3.2.5 a simulation already charges the post-quantum (ML-DSA-87)
// verification, once per signer, so the gas a hybrid transaction uses is the
// simulated gas plus a little variance. The gas limit is then set close to it:
// on the native lane the fee is the gas LIMIT times the price, so a generous
// limit costs real fees. Nodes below v3.2.5 keep the earlier rule
// (simulated gas times DefaultGasMultiplier).
const (
	// ExactGasMultiplier scales the simulated gas of a hybrid transaction on
	// a v3.2.5 network.
	ExactGasMultiplier = 1.02
	// ExactGasHeadroom is added once per transaction (not per signer) on top
	// of the scaled simulation.
	ExactGasHeadroom = 2000
)

// ExactHybridGas is the gas limit for a hybrid transaction whose simulation
// reported simulated on a v3.2.5 network: ceil(simulated * 1.02) + 2000.
func ExactHybridGas(simulated uint64) uint64 {
	// ceil(simulated * 102 / 100) in integers, so no float rounding creeps in.
	return (simulated*102+99)/100 + ExactGasHeadroom
}

// HybridGasDecision reports how HybridGasWanted chose a gas limit.
type HybridGasDecision struct {
	// Simulated is the gas the simulation reported.
	Simulated uint64
	// GasWanted is the gas limit to sign.
	GasWanted uint64
	// Exact is true when the v3.2.5 rule (ExactHybridGas) was used.
	Exact bool
	// PlanLookupErr is set when the applied_plan lookup failed and the
	// earlier rule was used instead.
	PlanLookupErr error
}

// HybridGasWanted turns a hybrid transaction's simulated gas into the gas
// limit to sign.
//
//   - multiplier > 0: the caller's choice, ceil(simulated * multiplier).
//   - otherwise, when the network at restURL has applied v3.2.5
//     (query.ChainUpgradeV3_2_5, looked up once and cached per REST endpoint):
//     ExactHybridGas(simulated).
//   - otherwise (an older node, no restURL, or a failed lookup): the earlier
//     rule, ceil(simulated * DefaultGasMultiplier).
//
// Use it for hybrid-signed native-lane transactions only. A classical
// transaction keeps CalculateFee / EstimateFee.
func HybridGasWanted(restURL string, simulated uint64, multiplier float64, httpClient *http.Client) HybridGasDecision {
	d := HybridGasDecision{Simulated: simulated}
	if multiplier > 0 {
		d.GasWanted = uint64(math.Ceil(float64(simulated) * multiplier))
		return d
	}
	if restURL != "" {
		applied, err := query.NewRestClient(restURL, httpClient).IsUpgradeApplied(query.ChainUpgradeV3_2_5)
		switch {
		case err != nil:
			d.PlanLookupErr = err
		case applied:
			d.GasWanted = ExactHybridGas(simulated)
			d.Exact = true
			return d
		}
	}
	d.GasWanted = uint64(math.Ceil(float64(simulated) * DefaultGasMultiplier))
	return d
}

// EstimateHybridFee simulates a hybrid-signed tx and returns its fee with the
// gas limit from HybridGasWanted (exact on a v3.2.5 network unless multiplier
// > 0), priced at priceStr (empty = DefaultGasPrice). The decision is returned
// alongside, for logging the simulated and wanted gas.
func EstimateHybridFee(restURL string, txBytes []byte, multiplier float64, priceStr string, httpClient *http.Client) (Fee, HybridGasDecision, error) {
	if priceStr == "" {
		priceStr = DefaultGasPrice
	}
	price, err := ParseGasPrice(priceStr)
	if err != nil {
		return Fee{}, HybridGasDecision{}, err
	}
	simulated, err := EstimateGas(restURL, txBytes, httpClient)
	if err != nil {
		return Fee{}, HybridGasDecision{}, err
	}
	d := HybridGasWanted(restURL, simulated, multiplier, httpClient)
	fee, err := CalculateFee(d.GasWanted, 1, price)
	return fee, d, err
}
