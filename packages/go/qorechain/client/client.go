// Package client provides the top-level CreateClient factory for the QoreChain
// Go SDK.
//
// CreateClient resolves a networks.NetworkConfig (applying any endpoint
// overrides) and composes the read clients (query.RestClient and the qor_*
// query.QorClient) plus a fee-estimate convenience.
//
// Network resolution rules:
//   - The default network is "testnet". Both "testnet" and "mainnet" are live
//     and ship localhost endpoint defaults; callers can override them with real
//     hostnames.
package client

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/networks"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// EndpointOverrides holds optional per-endpoint URL overrides. Empty fields are
// left at their preset defaults.
type EndpointOverrides struct {
	REST   string
	GRPC   string
	RPC    string
	EVMRPC string
	EVMWS  string
	SVMRPC string
}

// Options configures CreateClient.
type Options struct {
	// Network is the preset to target. Empty means "testnet".
	Network string
	// Endpoints holds optional endpoint overrides. Both presets default to localhost.
	Endpoints EndpointOverrides
	// ChainID overrides the resolved chain ID.
	ChainID string
	// HTTPClient is the http.Client used for all requests. Optional.
	HTTPClient *http.Client
}

// Fees is the fee-estimate convenience surface bound to a RestClient.
type Fees struct {
	rest *query.RestClient
}

// Static-fallback parameters used when the AI fee oracle is unavailable.
const (
	staticFallbackGasPrice = "0.025"
	staticFallbackDenom    = "uqor"
	staticFallbackGas      = "200000"
)

// Estimate estimates a fee for the given urgency via the AI fee oracle, falling
// back to a deterministic static fee when the oracle is unavailable. The
// returned value is a Cosmos StdFee-shaped JSON document
// ({"amount":[...],"gas":...}).
func (f *Fees) Estimate(urgency string) (json.RawMessage, error) {
	if urgency == "" {
		urgency = "normal"
	}
	if raw, err := f.rest.GetFeeEstimate(urgency); err == nil {
		var parsed struct {
			SuggestedFeeUqor json.Number `json:"suggested_fee_uqor"`
		}
		if json.Unmarshal(raw, &parsed) == nil {
			amount := parsed.SuggestedFeeUqor.String()
			if amount != "" && amount != "0" {
				return staticFee(staticFallbackGas, "", staticFallbackDenom, amount)
			}
		}
	}
	return staticFee(staticFallbackGas, staticFallbackGasPrice, staticFallbackDenom, "")
}

// staticFee builds a StdFee JSON doc. When amount is non-empty it is used
// directly; otherwise the fee is computed as ceil(gas * gasPrice).
func staticFee(gas, gasPrice, denom, amount string) (json.RawMessage, error) {
	if amount == "" {
		var err error
		amount, err = computeCeilFee(gas, gasPrice)
		if err != nil {
			return nil, err
		}
	}
	type coin struct {
		Denom  string `json:"denom"`
		Amount string `json:"amount"`
	}
	type fee struct {
		Amount []coin `json:"amount"`
		Gas    string `json:"gas"`
	}
	return json.Marshal(fee{Amount: []coin{{Denom: denom, Amount: amount}}, Gas: gas})
}

// computeCeilFee returns ceil(gas * gasPrice) using integer (big.Int) math to
// avoid floating-point drift. gasPrice is a non-negative decimal string.
func computeCeilFee(gas, gasPrice string) (string, error) {
	gasUnits, ok := new(big.Int).SetString(gas, 10)
	if !ok {
		return "", fmt.Errorf("invalid gas: %s", gas)
	}
	intPart, fracPart, _ := strings.Cut(gasPrice, ".")
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(len(fracPart))), nil)
	ip, ok := new(big.Int).SetString(orZero(intPart), 10)
	if !ok {
		return "", fmt.Errorf("invalid gas price: %s", gasPrice)
	}
	fp, ok := new(big.Int).SetString(orZero(fracPart), 10)
	if !ok {
		return "", fmt.Errorf("invalid gas price: %s", gasPrice)
	}
	numerator := new(big.Int).Add(new(big.Int).Mul(ip, scale), fp)
	raw := new(big.Int).Mul(gasUnits, numerator)
	// ceil division: (raw + scale - 1) / scale
	raw.Add(raw, new(big.Int).Sub(scale, big.NewInt(1)))
	raw.Div(raw, scale)
	return raw.String(), nil
}

func orZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

// Client is a composed QoreChain client: resolved config, read clients, fee
// helper.
type Client struct {
	Network networks.NetworkConfig
	REST    *query.RestClient
	Qor     *query.QorClient
	Fees    *Fees
}

func overridesMap(o EndpointOverrides) map[string]string {
	m := map[string]string{}
	if o.REST != "" {
		m["rest"] = o.REST
	}
	if o.GRPC != "" {
		m["grpc"] = o.GRPC
	}
	if o.RPC != "" {
		m["rpc"] = o.RPC
	}
	if o.EVMRPC != "" {
		m["evm_rpc"] = o.EVMRPC
	}
	if o.EVMWS != "" {
		m["evm_ws"] = o.EVMWS
	}
	if o.SVMRPC != "" {
		m["svm_rpc"] = o.SVMRPC
	}
	return m
}

func resolveNetwork(network string, overrides map[string]string, chainID string) (networks.NetworkConfig, error) {
	base, ok := networks.Networks[network]
	if !ok {
		return networks.NetworkConfig{}, fmt.Errorf("unknown network: %s", network)
	}

	// Live preset (testnet or mainnet): overlay endpoint overrides onto the defaults.
	current := *base.Endpoints // copy
	if v, ok := overrides["rest"]; ok {
		current.REST = v
	}
	if v, ok := overrides["grpc"]; ok {
		current.GRPC = v
	}
	if v, ok := overrides["rpc"]; ok {
		current.RPC = v
	}
	if v, ok := overrides["evm_rpc"]; ok {
		current.EVMRPC = v
	}
	if v, ok := overrides["evm_ws"]; ok {
		current.EVMWS = v
	}
	if v, ok := overrides["svm_rpc"]; ok {
		current.SVMRPC = v
	}
	base.Endpoints = &current
	if chainID != "" {
		base.ChainID = chainID
	}
	return base, nil
}

func requireEndpoint(key, value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("endpoint %q is not configured — pass it via CreateClient Endpoints", key)
	}
	return value, nil
}

// CreateClient creates a composed Client. It returns an error if the network is
// unknown or a required endpoint is missing.
func CreateClient(opts Options) (*Client, error) {
	network := opts.Network
	if network == "" {
		network = "testnet"
	}
	resolved, err := resolveNetwork(network, overridesMap(opts.Endpoints), opts.ChainID)
	if err != nil {
		return nil, err
	}
	restURL, err := requireEndpoint("rest", resolved.Endpoints.REST)
	if err != nil {
		return nil, err
	}
	evmURL, err := requireEndpoint("evm_rpc", resolved.Endpoints.EVMRPC)
	if err != nil {
		return nil, err
	}
	rest := query.NewRestClient(restURL, opts.HTTPClient)
	qor := query.NewQorClient(evmURL, opts.HTTPClient)
	return &Client{
		Network: resolved,
		REST:    rest,
		Qor:     qor,
		Fees:    &Fees{rest: rest},
	}, nil
}
