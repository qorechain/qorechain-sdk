// Package networks provides built-in network presets for the QoreChain Go SDK.
//
// The "mainnet" and "testnet" presets point at the public endpoints, and
// "localnet" at a node on this machine (the localhost ports). Every hostname
// lives in the preset table below and nowhere else in the SDK. An empty
// endpoint means the preset has none: the public networks expose no gRPC, no
// SVM endpoint (SVM transactions are not open on either network) and, on
// mainnet, no EVM WebSocket. Code that needs such an endpoint returns an
// EndpointNotConfiguredError instead of falling back to localhost; set it with
// an explicit override (client.Options.Endpoints) to use your own node.
//
// The testnet endpoints have a per-IP rate limit at the edge. Production
// traffic should run or use its own node. The release manifest
// https://download.qore.host/<net>/latest.json (version, peers, state sync) is
// a file, not an endpoint.
//
// GetNetwork returns a preset by name.
package networks

import "fmt"

// Bech32Prefixes holds the bech32 human-readable prefixes used across
// QoreChain address types.
type Bech32Prefixes struct {
	Account   string
	Validator string
	Consensus string
}

// CoinInfo holds display and base denomination metadata for the network's
// staking coin.
type CoinInfo struct {
	Display  string
	Base     string
	Exponent int
}

// Endpoints holds the service endpoints for talking to a network across its
// supported VMs. An empty field means the preset has no such endpoint.
type Endpoints struct {
	REST   string
	GRPC   string
	RPC    string
	EVMRPC string
	EVMWS  string
	SVMRPC string
}

// NetworkConfig is a fully described network preset.
type NetworkConfig struct {
	Name    string
	Live    bool
	ChainID string
	// EVMChainID is the EIP-155 chain id of the network's EVM (0 = unknown).
	EVMChainID uint64
	Bech32     Bech32Prefixes
	Coin       CoinInfo
	Endpoints  *Endpoints
}

// Preset names.
const (
	Mainnet  = "mainnet"
	Testnet  = "testnet"
	Localnet = "localnet"
)

// QoreChain uses the same token and address prefixes on every network.
var (
	bech32Prefixes = Bech32Prefixes{Account: "qor", Validator: "qorvaloper", Consensus: "qorvalcons"}
	coinInfo       = CoinInfo{Display: "QOR", Base: "uqor", Exponent: 6}
)

// Networks is the set of built-in network presets, keyed by name. It is the
// one place that names the public hostnames.
var Networks = map[string]NetworkConfig{
	Mainnet: {
		Name:       Mainnet,
		Live:       true,
		ChainID:    "qorechain-vladi",
		EVMChainID: 9801,
		Bech32:     bech32Prefixes,
		Coin:       coinInfo,
		Endpoints: &Endpoints{
			REST:   "https://api.qore.host",
			RPC:    "https://rpc.qore.host",
			EVMRPC: "https://evm.qore.host",
		},
	},
	Testnet: {
		Name:       Testnet,
		Live:       true,
		ChainID:    "qorechain-diana",
		EVMChainID: 9800,
		Bech32:     bech32Prefixes,
		Coin:       coinInfo,
		Endpoints: &Endpoints{
			REST:   "https://api-testnet.qore.host",
			RPC:    "https://rpc-testnet.qore.host",
			EVMRPC: "https://evm-testnet.qore.host",
			EVMWS:  "wss://evm-ws-testnet.qore.host",
		},
	},
	Localnet: {
		Name:    Localnet,
		Live:    true,
		ChainID: "qorechain-devnet",
		// EVMChainID is left 0: a local chain sets its own; ask the node
		// (eth_chainId).
		EVMChainID: 0,
		Bech32:     bech32Prefixes,
		Coin:       coinInfo,
		Endpoints: &Endpoints{
			REST:   "http://localhost:1317",
			GRPC:   "http://localhost:9090",
			RPC:    "http://localhost:26657",
			EVMRPC: "http://localhost:8545",
			EVMWS:  "ws://localhost:8546",
			SVMRPC: "http://localhost:8899",
		},
	},
}

// GetNetwork resolves a network preset by name.
//
// It returns an error if the named network is unknown.
func GetNetwork(name string) (NetworkConfig, error) {
	config, ok := Networks[name]
	if !ok {
		return NetworkConfig{}, fmt.Errorf("unknown network: %s", name)
	}
	return config, nil
}

// ListNetworks lists the known network preset names without any liveness check.
func ListNetworks() []string {
	return []string{Testnet, Mainnet, Localnet}
}

// Endpoint kinds, as named by EndpointNotConfiguredError and Endpoint.
const (
	EndpointREST   = "rest"
	EndpointGRPC   = "grpc"
	EndpointRPC    = "rpc"
	EndpointEVMRPC = "evm rpc"
	EndpointEVMWS  = "evm ws"
	EndpointSVMRPC = "svm rpc"
)

// endpointField names the Endpoints field (and client.Options.Endpoints
// override) for each kind.
var endpointField = map[string]string{
	EndpointREST:   "REST",
	EndpointGRPC:   "GRPC",
	EndpointRPC:    "RPC",
	EndpointEVMRPC: "EVMRPC",
	EndpointEVMWS:  "EVMWS",
	EndpointSVMRPC: "SVMRPC",
}

// EndpointNotConfiguredError reports an endpoint the network has none of: the
// preset leaves it empty and no override set it.
type EndpointNotConfiguredError struct {
	// Network is the preset name.
	Network string
	// Kind is one of the Endpoint* kinds.
	Kind string
}

func (e *EndpointNotConfiguredError) Error() string {
	return fmt.Sprintf("%s is not configured for the %s preset; set Endpoints.%s (or use your own node)",
		e.Kind, e.Network, endpointField[e.Kind])
}

// Endpoint returns the endpoint of the given kind (one of the Endpoint*
// constants), or an *EndpointNotConfiguredError when it is empty.
func (c NetworkConfig) Endpoint(kind string) (string, error) {
	if _, ok := endpointField[kind]; !ok {
		return "", fmt.Errorf("unknown endpoint kind: %q", kind)
	}
	var v string
	if c.Endpoints != nil {
		switch kind {
		case EndpointREST:
			v = c.Endpoints.REST
		case EndpointGRPC:
			v = c.Endpoints.GRPC
		case EndpointRPC:
			v = c.Endpoints.RPC
		case EndpointEVMRPC:
			v = c.Endpoints.EVMRPC
		case EndpointEVMWS:
			v = c.Endpoints.EVMWS
		case EndpointSVMRPC:
			v = c.Endpoints.SVMRPC
		}
	}
	if v == "" {
		return "", &EndpointNotConfiguredError{Network: c.Name, Kind: kind}
	}
	return v, nil
}
