// Package networks provides built-in network presets for the QoreChain Go SDK.
//
// The "testnet" preset is fully populated and live; its endpoints default to
// localhost ports so the SDK works out of the box against a locally running
// node, and callers can override them with real hostnames. The "mainnet"
// preset is a placeholder: mainnet is not yet live, so it carries no chain ID
// and no endpoints, and GetNetwork returns an error if asked for it.
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

// NetworkConfig is a fully described network preset. Endpoints is nil for
// networks that are not yet live (e.g. mainnet).
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
		Name:      "mainnet",
		Live:      false,
		ChainID:   "",
		Bech32:    bech32Prefixes,
		Coin:      coinInfo,
		Endpoints: nil,
	},
}

// GetNetwork resolves a network preset by name.
//
// It returns an error if the named network is unknown or not yet live (e.g.
// mainnet); for not-yet-live networks the caller should pass custom endpoints.
func GetNetwork(name string) (NetworkConfig, error) {
	config, ok := Networks[name]
	if !ok {
		return NetworkConfig{}, fmt.Errorf("unknown network: %s", name)
	}
	if !config.Live {
		return NetworkConfig{}, fmt.Errorf("%s is not yet live — pass custom endpoints", name)
	}
	return config, nil
}

// ListNetworks lists the known network preset names without any liveness check.
func ListNetworks() []string {
	return []string{"testnet", "mainnet"}
}
