package networks

import (
	"errors"
	"strings"
	"testing"
)

func TestPresetChainIDs(t *testing.T) {
	cases := map[string]struct {
		chainID string
		evm     uint64
	}{
		Mainnet:  {"qorechain-vladi", 9801},
		Testnet:  {"qorechain-diana", 9800},
		Localnet: {"qorechain-devnet", 0},
	}
	for name, want := range cases {
		cfg, err := GetNetwork(name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !cfg.Live || cfg.Name != name {
			t.Errorf("%s: live=%v name=%q", name, cfg.Live, cfg.Name)
		}
		if cfg.ChainID != want.chainID || cfg.EVMChainID != want.evm {
			t.Errorf("%s: chain id %q / %d, want %q / %d", name, cfg.ChainID, cfg.EVMChainID, want.chainID, want.evm)
		}
		if cfg.Bech32.Account != "qor" || cfg.Bech32.Validator != "qorvaloper" || cfg.Bech32.Consensus != "qorvalcons" {
			t.Errorf("%s: bech32 prefixes wrong: %+v", name, cfg.Bech32)
		}
		if cfg.Coin.Display != "QOR" || cfg.Coin.Base != "uqor" || cfg.Coin.Exponent != 6 {
			t.Errorf("%s: coin info wrong: %+v", name, cfg.Coin)
		}
	}
}

func TestPublicPresetsUseHTTPSAndLeaveMissingEndpointsEmpty(t *testing.T) {
	for _, name := range []string{Mainnet, Testnet} {
		e := Networks[name].Endpoints
		for kind, v := range map[string]string{"rest": e.REST, "rpc": e.RPC, "evm": e.EVMRPC} {
			if !strings.HasPrefix(v, "https://") {
				t.Errorf("%s %s = %q, want a public https endpoint", name, kind, v)
			}
		}
		if e.GRPC != "" || e.SVMRPC != "" {
			t.Errorf("%s: grpc %q / svm %q should not be preset", name, e.GRPC, e.SVMRPC)
		}
	}
	if Networks[Mainnet].Endpoints.EVMWS != "" {
		t.Errorf("mainnet evm ws should not be preset")
	}
	if !strings.HasPrefix(Networks[Testnet].Endpoints.EVMWS, "wss://") {
		t.Errorf("testnet evm ws = %q", Networks[Testnet].Endpoints.EVMWS)
	}
}

func TestLocalnetKeepsTheLocalhostDefaults(t *testing.T) {
	e := Networks[Localnet].Endpoints
	want := Endpoints{
		REST:   "http://localhost:1317",
		GRPC:   "http://localhost:9090",
		RPC:    "http://localhost:26657",
		EVMRPC: "http://localhost:8545",
		EVMWS:  "ws://localhost:8546",
		SVMRPC: "http://localhost:8899",
	}
	if *e != want {
		t.Errorf("localnet endpoints = %+v, want %+v", *e, want)
	}
}

func TestEndpointNotConfigured(t *testing.T) {
	cfg := Networks[Mainnet]
	for _, kind := range []string{EndpointGRPC, EndpointEVMWS, EndpointSVMRPC} {
		_, err := cfg.Endpoint(kind)
		var nc *EndpointNotConfiguredError
		if !errors.As(err, &nc) || nc.Kind != kind || nc.Network != Mainnet {
			t.Fatalf("%s: err = %v", kind, err)
		}
		if !strings.Contains(err.Error(), "not configured for the mainnet preset") || !strings.Contains(err.Error(), "set Endpoints.") {
			t.Errorf("%s: message = %q", kind, err.Error())
		}
	}
	if _, err := Networks[Testnet].Endpoint(EndpointEVMWS); err != nil {
		t.Errorf("testnet evm ws: %v", err)
	}
	got, err := cfg.Endpoint(EndpointREST)
	if err != nil || got != cfg.Endpoints.REST {
		t.Errorf("rest = %q, %v", got, err)
	}
	if _, err := cfg.Endpoint("nope"); err == nil {
		t.Error("unknown kind should fail")
	}
}

func TestGetNetworkUnknown(t *testing.T) {
	_, err := GetNetwork("nope")
	if err == nil || !strings.Contains(err.Error(), "unknown network") {
		t.Fatalf("err = %v", err)
	}
}

func TestListNetworks(t *testing.T) {
	got := strings.Join(ListNetworks(), ",")
	if got != "testnet,mainnet,localnet" {
		t.Errorf("ListNetworks = %s", got)
	}
}
