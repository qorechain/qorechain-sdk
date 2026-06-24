// Package networks provides built-in network presets for the QoreChain Go SDK.
//
// Both the "testnet" and "mainnet" presets are fully populated and live; their
// endpoints default to localhost ports so the SDK works out of the box against a
// locally running node, and callers can override them with real hostnames.
// GetNetwork returns either preset.
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
// supported VMs.
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
	Name      string
	Live      bool
	ChainID   string
	Bech32    Bech32Prefixes
	Coin      CoinInfo
	Endpoints *Endpoints
}

// QoreChain uses the same token and address prefixes on every network.
var (
	bech32Prefixes = Bech32Prefixes{Account: "qor", Validator: "qorvaloper", Consensus: "qorvalcons"}
	coinInfo       = CoinInfo{Display: "QOR", Base: "uqor", Exponent: 6}
)

// Networks is the set of built-in network presets, keyed by name.
var Networks = map[string]NetworkConfig{
	"testnet": {
		Name:    "testnet",
		Live:    true,
		ChainID: "qorechain-diana",
		Bech32:  bech32Prefixes,
		Coin:    coinInfo,
		Endpoints: &Endpoints{
			REST:   "http://localhost:1317",
			GRPC:   "http://localhost:9090",
			RPC:    "http://localhost:26657",
			EVMRPC: "http://localhost:8545",
			EVMWS:  "ws://localhost:8546",
			SVMRPC: "http://localhost:8899",
		},
	},
	"mainnet": {
		Name:    "mainnet",
		Live:    true,
		ChainID: "qorechain-vladi",
		Bech32:  bech32Prefixes,
		Coin:    coinInfo,
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
	return []string{"testnet", "mainnet"}
}
