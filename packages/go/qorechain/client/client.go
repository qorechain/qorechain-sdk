// Package client provides the top-level CreateClient factory for the QoreChain
// Go SDK.
//
// CreateClient resolves a networks.NetworkConfig (applying any endpoint
// overrides) and composes the read clients (query.RestClient and the qor_*
// query.QorClient) plus a fee-estimate convenience.
//
// Network resolution rules:
//   - The default network is "testnet". "mainnet" and "testnet" use the public
//     endpoints (networks.Networks); "localnet" uses a node on this machine.
//   - An explicit override in Options.Endpoints replaces the preset value.
//   - An endpoint the preset leaves empty (gRPC and SVM on the public networks,
//     the EVM WebSocket on mainnet) is reported as not configured by the
//     accessors below; it never falls back to localhost.
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
	// Endpoints holds optional endpoint overrides; empty fields keep the
	// preset's value.
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
	staticFallbackGasPrice = "0.15" // above the 0.1uqor/gas genesis min-gas-price (BaseFee)
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

	// Overlay endpoint overrides onto the preset's values.
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

// GRPCEndpoint returns the network's gRPC endpoint, or a
// *networks.EndpointNotConfiguredError when it has none (the public presets
// expose no gRPC; pass Options.Endpoints.GRPC for your own node).
func (c *Client) GRPCEndpoint() (string, error) {
	return c.Network.Endpoint(networks.EndpointGRPC)
}

// EVMWSEndpoint returns the network's EVM WebSocket endpoint, or a
// *networks.EndpointNotConfiguredError when it has none (mainnet has no
// public EVM WebSocket; poll over EVMRPC or pass Options.Endpoints.EVMWS).
func (c *Client) EVMWSEndpoint() (string, error) {
	return c.Network.Endpoint(networks.EndpointEVMWS)
}

// SVMRPCEndpoint returns the network's SVM endpoint, or a
// *networks.EndpointNotConfiguredError when it has none (SVM transactions are
// not open on the public networks, so no preset names one).
func (c *Client) SVMRPCEndpoint() (string, error) {
	return c.Network.Endpoint(networks.EndpointSVMRPC)
}

// NewGRPCClient dials the network's gRPC endpoint. It fails with a
// *networks.EndpointNotConfiguredError when the network has none.
func (c *Client) NewGRPCClient() (*query.GRPCClient, error) {
	endpoint, err := c.GRPCEndpoint()
	if err != nil {
		return nil, err
	}
	return query.NewGRPCClient(endpoint)
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
	restURL, err := resolved.Endpoint(networks.EndpointREST)
	if err != nil {
		return nil, err
	}
	evmURL, err := resolved.Endpoint(networks.EndpointEVMRPC)
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
