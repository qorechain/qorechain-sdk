// Package evm provides a minimal EVM JSON-RPC client and typed bindings for
// QoreChain's EVM precompiles — the AI pre-flight surface in particular.
//
// The QoreChain EVM Engine exposes on-chain AI capabilities (transaction risk
// scoring and anomaly detection) as fixed-address precompiles callable via
// `eth_call`. This package issues those calls, ABI-encodes the calldata by hand
// (selector + arguments) and decodes the 32-byte return words, so a developer
// never has to wire up a full contract-ABI toolchain just to run a pre-flight
// check.
//
// Availability note: on a default or community node these precompiles may return
// a "not available"/revert error; they are available on QoreChain network nodes.
// Treat a returned error from any precompile helper as "feature not present on
// this node".
package evm

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"

	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/query"
)

// Client is a thin EVM JSON-RPC client. It wraps query.JSONRPCClient and adds
// the `eth_call` / `eth_estimateGas` methods plus the typed precompile bindings
// defined in this package. Point it at the network's EVM JSON-RPC endpoint
// (NetworkConfig.Endpoints.EVMRPC).
type Client struct {
	*query.JSONRPCClient
}

// NewClient creates an EVM Client targeting the given EVM JSON-RPC URL. If
// httpClient is nil, http.DefaultClient is used.
func NewClient(rpcURL string, httpClient *http.Client) *Client {
	return &Client{JSONRPCClient: query.NewJSONRPCClient(rpcURL, httpClient)}
}

// CallMsg is the subset of the EVM call object used by EthCall / EthEstimateGas.
// Empty fields are omitted from the JSON params.
type CallMsg struct {
	// From is the (optional) caller address, "0x"-prefixed hex.
	From string
	// To is the target contract / precompile address, "0x"-prefixed hex.
	To string
	// Data is the ABI-encoded calldata.
	Data []byte
	// Value is the (optional) call value in wei.
	Value *big.Int
}

// toParams renders a CallMsg into the JSON object eth_call/eth_estimateGas
// expect, with hex-encoded fields and empty members omitted.
func (m CallMsg) toParams() map[string]string {
	obj := map[string]string{}
	if m.From != "" {
		obj["from"] = m.From
	}
	if m.To != "" {
		obj["to"] = m.To
	}
	if len(m.Data) > 0 {
		obj["data"] = "0x" + hexEncode(m.Data)
	}
	if m.Value != nil {
		obj["value"] = "0x" + m.Value.Text(16)
	}
	return obj
}

// EthCall invokes `eth_call` against the given message at the given block
// (default "latest") and returns the raw return bytes (the decoded hex result).
func (c *Client) EthCall(msg CallMsg, block string) ([]byte, error) {
	if block == "" {
		block = "latest"
	}
	raw, err := c.Call("eth_call", []any{msg.toParams(), block})
	if err != nil {
		return nil, err
	}
	var hexResult string
	if err := json.Unmarshal(raw, &hexResult); err != nil {
		return nil, fmt.Errorf("decode eth_call result: %w", err)
	}
	return hexDecode(hexResult)
}

// EthEstimateGas invokes `eth_estimateGas` for the given message and returns the
// estimated gas as a uint64.
func (c *Client) EthEstimateGas(msg CallMsg) (uint64, error) {
	raw, err := c.Call("eth_estimateGas", []any{msg.toParams()})
	if err != nil {
		return 0, err
	}
	var hexQty string
	if err := json.Unmarshal(raw, &hexQty); err != nil {
		return 0, fmt.Errorf("decode eth_estimateGas result: %w", err)
	}
	n, ok := new(big.Int).SetString(stripHexPrefix(hexQty), 16)
	if !ok {
		return 0, fmt.Errorf("invalid gas quantity: %q", hexQty)
	}
	return n.Uint64(), nil
}
