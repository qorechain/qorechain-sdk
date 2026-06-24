package networks

import (
	"strings"
	"testing"
)

func TestGetNetworkTestnet(t *testing.T) {
	cfg, err := GetNetwork("testnet")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ChainID != "qorechain-diana" {
		t.Errorf("chain id = %q, want qorechain-diana", cfg.ChainID)
	}
	if !cfg.Live {
		t.Error("testnet should be live")
	}
	if cfg.Endpoints == nil {
		t.Fatal("testnet endpoints should not be nil")
	}
	if cfg.Endpoints.REST != "http://localhost:1317" {
		t.Errorf("rest = %q", cfg.Endpoints.REST)
	}
	if cfg.Endpoints.GRPC != "http://localhost:9090" {
		t.Errorf("grpc = %q", cfg.Endpoints.GRPC)
	}
	if cfg.Endpoints.RPC != "http://localhost:26657" {
		t.Errorf("rpc = %q", cfg.Endpoints.RPC)
	}
	if cfg.Endpoints.EVMRPC != "http://localhost:8545" {
		t.Errorf("evmrpc = %q", cfg.Endpoints.EVMRPC)
	}
	if cfg.Endpoints.EVMWS != "ws://localhost:8546" {
		t.Errorf("evmws = %q", cfg.Endpoints.EVMWS)
	}
	if cfg.Endpoints.SVMRPC != "http://localhost:8899" {
		t.Errorf("svmrpc = %q", cfg.Endpoints.SVMRPC)
	}
	if cfg.Bech32.Account != "qor" || cfg.Bech32.Validator != "qorvaloper" {
		t.Errorf("bech32 prefixes wrong: %+v", cfg.Bech32)
	}
	if cfg.Coin.Display != "QOR" || cfg.Coin.Base != "uqor" || cfg.Coin.Exponent != 6 {
		t.Errorf("coin info wrong: %+v", cfg.Coin)
	}
}

func TestGetNetworkMainnetLive(t *testing.T) {
	cfg, err := GetNetwork("mainnet")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.Live {
		t.Error("mainnet should be live")
	}
	if cfg.ChainID != "qorechain-vladi" {
		t.Errorf("chain id = %q, want qorechain-vladi", cfg.ChainID)
	}
	if cfg.Endpoints == nil {
		t.Fatal("mainnet endpoints should not be nil")
	}
	if cfg.Endpoints.REST != "http://localhost:1317" {
		t.Errorf("rest = %q", cfg.Endpoints.REST)
	}
	if cfg.Bech32.Account != "qor" || cfg.Bech32.Validator != "qorvaloper" || cfg.Bech32.Consensus != "qorvalcons" {
		t.Errorf("bech32 prefixes wrong: %+v", cfg.Bech32)
	}
	if cfg.Coin.Display != "QOR" || cfg.Coin.Base != "uqor" || cfg.Coin.Exponent != 6 {
		t.Errorf("coin info wrong: %+v", cfg.Coin)
	}
}

func TestGetNetworkUnknown(t *testing.T) {
	_, err := GetNetwork("nope")
	if err == nil {
		t.Fatal("expected error for unknown network")
	}
	if !strings.Contains(err.Error(), "unknown network") {
		t.Errorf("error = %q", err.Error())
	}
}

func TestMainnetPresetShape(t *testing.T) {
	cfg := Networks["mainnet"]
	if !cfg.Live {
		t.Error("mainnet should be live")
	}
	if cfg.ChainID != "qorechain-vladi" {
		t.Errorf("mainnet chain id should be qorechain-vladi, got %q", cfg.ChainID)
	}
	if cfg.Endpoints == nil {
		t.Error("mainnet endpoints should not be nil")
	}
}
