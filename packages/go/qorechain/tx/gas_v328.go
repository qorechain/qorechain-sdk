package tx

import (
	"fmt"
	gomath "math"
	"net/http"
	"strings"

	"cosmossdk.io/math"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/gogoproto/proto"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// Gas rules for chain v3.2.8.
//
// Use auto / simulation for wasm and cross-VM gas: the first call of a
// contract code in a block costs much more than a repeat (a cw20 transfer
// about 533k gas, repeats about 84k), so no fixed gas fits. A transaction
// carrying a CosmWasm execute / instantiate / migrate or a MsgCrossVMCall is
// never given a fixed fallback gas by this SDK, and its simulated gas is
// scaled by at least WasmGasMultiplier.
const (
	// MaxCosmosTxGas is the largest gas limit a Native-lane transaction may
	// carry; a larger one is refused before signing.
	MaxCosmosTxGas uint64 = 50_000_000
	// WasmGasMultiplier is the least a simulated gas is scaled by for a
	// transaction that carries CosmWasm or cross-VM messages.
	WasmGasMultiplier = 1.3
)

// SimulatedGasTypeURLs are the messages whose gas must come from simulation.
var SimulatedGasTypeURLs = []string{
	"/cosmwasm.wasm.v1.MsgExecuteContract",
	"/cosmwasm.wasm.v1.MsgInstantiateContract",
	"/cosmwasm.wasm.v1.MsgInstantiateContract2",
	"/cosmwasm.wasm.v1.MsgMigrateContract",
	"/qorechain.crossvm.v1.MsgCrossVMCall",
}

// RequiresSimulatedGasTypeURL reports whether a message type URL is one of
// SimulatedGasTypeURLs.
func RequiresSimulatedGasTypeURL(typeURL string) bool {
	if !strings.HasPrefix(typeURL, "/") {
		typeURL = "/" + typeURL
	}
	for _, u := range SimulatedGasTypeURLs {
		if u == typeURL {
			return true
		}
	}
	return false
}

// RequiresSimulatedGas reports whether msgs carry a CosmWasm execute /
// instantiate / migrate or a MsgCrossVMCall, whose gas must be simulated (or
// given explicitly) rather than taken from a fixed fallback.
func RequiresSimulatedGas(msgs []sdk.Msg) bool {
	for _, m := range msgs {
		if m != nil && RequiresSimulatedGasTypeURL("/"+proto.MessageName(m)) {
			return true
		}
	}
	return false
}

// ErrFixedGasForWasm is returned where a fixed fallback gas would otherwise be
// used for a transaction that needs simulation.
var ErrFixedGasForWasm = fmt.Errorf("this transaction carries CosmWasm or cross-VM messages, whose gas varies widely " +
	"(the first call of a contract code in a block costs much more): use simulation (Fee.Gas = \"auto\") or give an explicit gas limit")

// WasmGasWanted scales a simulated gas for a CosmWasm / cross-VM transaction:
// ceil(simulated * max(multiplier, WasmGasMultiplier)).
func WasmGasWanted(simulated uint64, multiplier float64) uint64 {
	if multiplier < WasmGasMultiplier {
		multiplier = WasmGasMultiplier
	}
	return uint64(gomath.Ceil(float64(simulated) * multiplier))
}

// checkCosmosGas refuses a gas limit above MaxCosmosTxGas.
func checkCosmosGas(gas uint64) error {
	if gas > MaxCosmosTxGas {
		return fmt.Errorf("gas limit %d is above the chain's transaction cap of %d", gas, MaxCosmosTxGas)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Minimum gas price (opt-in network read)
// ---------------------------------------------------------------------------

// MinGasPriceFloorUqor is the chain's minimum gas price floor (0.1 uqor/gas)
// and RecommendedGasPriceFloorUqor the least RecommendedGasPriceUqor returns
// (DefaultGasPrice's 0.15).
const (
	MinGasPriceFloorUqor         = "0.1"
	RecommendedGasPriceFloorUqor = "0.15"
	// DefaultGasPriceMargin is RecommendedGasPriceUqor's margin when none is
	// given.
	DefaultGasPriceMargin = "1.5"
)

// FetchMinGasPriceUqor reads the minimum gas price the chain enforces
// (params.min_gas_price of GET /cosmos/evm/feemarket/v1/params, in the
// 18-decimal EVM unit) and returns it in uqor per gas, max(min_gas_price /
// 1e12, 0.1), as a decimal string without trailing zeros (for example "0.1").
// The value is parsed exactly, never through a float; a quotient with more
// than 18 decimals is rounded up.
//
// It is opt-in: DefaultGasPrice and every default path stay as they are and
// make no such network call. The chain may later move its minimum inside a
// governance band; use this (or RecommendedGasPriceUqor) to follow it.
func FetchMinGasPriceUqor(restURL string, httpClient *http.Client) (string, error) {
	d, err := fetchMinGasPriceDec(restURL, httpClient)
	if err != nil {
		return "", err
	}
	return trimDec(d), nil
}

// RecommendedGasPriceUqor returns max(0.15, FetchMinGasPriceUqor x margin) in
// uqor per gas, as a decimal string. margin is a decimal string; empty uses
// DefaultGasPriceMargin ("1.5"). Append "uqor" to use it as a gas price
// (EstimateFee's priceStr, BroadcastHybridParams.GasPrice). Opt-in, like
// FetchMinGasPriceUqor.
func RecommendedGasPriceUqor(restURL, margin string, httpClient *http.Client) (string, error) {
	if margin == "" {
		margin = DefaultGasPriceMargin
	}
	m, err := math.LegacyNewDecFromStr(margin)
	if err != nil || !m.IsPositive() {
		return "", fmt.Errorf("gas price margin %q is not a positive decimal", margin)
	}
	floor, err := fetchMinGasPriceDec(restURL, httpClient)
	if err != nil {
		return "", err
	}
	out := floor.Mul(m)
	if minRec := math.LegacyMustNewDecFromStr(RecommendedGasPriceFloorUqor); out.LT(minRec) {
		out = minRec
	}
	return trimDec(out), nil
}

func fetchMinGasPriceDec(restURL string, httpClient *http.Client) (math.LegacyDec, error) {
	raw, err := query.NewRestClient(restURL, httpClient).GetFeemarketMinGasPrice()
	if err != nil {
		return math.LegacyDec{}, err
	}
	evm, err := math.LegacyNewDecFromStr(strings.TrimSpace(raw))
	if err != nil || evm.IsNegative() {
		return math.LegacyDec{}, fmt.Errorf("feemarket min_gas_price %q is not a non-negative decimal", raw)
	}
	// Round up at the 18th decimal: a price below the minimum is refused.
	uqor := evm.QuoRoundUp(math.LegacyNewDec(1_000_000_000_000))
	if floor := math.LegacyMustNewDecFromStr(MinGasPriceFloorUqor); uqor.LT(floor) {
		uqor = floor
	}
	return uqor, nil
}

// trimDec renders a LegacyDec without trailing fractional zeros.
func trimDec(d math.LegacyDec) string {
	s := d.String()
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}
