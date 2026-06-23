package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateClientTestnetDefault(t *testing.T) {
	c, err := CreateClient(Options{})
	if err != nil {
		t.Fatal(err)
	}
	if c.Network.Name != "testnet" {
		t.Errorf("network = %q, want testnet", c.Network.Name)
	}
	if c.Network.ChainID != "qorechain-diana" {
		t.Errorf("chain id = %q", c.Network.ChainID)
	}
	if c.REST == nil || c.Qor == nil || c.Fees == nil {
		t.Error("client surfaces should be populated")
	}
}

func TestCreateClientMainnetWithoutEndpointsErrors(t *testing.T) {
	_, err := CreateClient(Options{Network: "mainnet"})
	if err == nil {
		t.Fatal("expected error for mainnet without endpoints")
	}
	if !strings.Contains(err.Error(), "not yet live") {
		t.Errorf("error = %q", err.Error())
	}
}

func TestCreateClientMainnetWithEndpoints(t *testing.T) {
	c, err := CreateClient(Options{
		Network: "mainnet",
		Endpoints: EndpointOverrides{
			REST:   "https://rest.example",
			EVMRPC: "https://evm.example",
		},
		ChainID: "qorechain-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if c.Network.ChainID != "qorechain-1" {
		t.Errorf("chain id = %q", c.Network.ChainID)
	}
	if c.Network.Endpoints.REST != "https://rest.example" {
		t.Errorf("rest = %q", c.Network.Endpoints.REST)
	}
}

func TestCreateClientOverrideApplied(t *testing.T) {
	c, err := CreateClient(Options{
		Endpoints: EndpointOverrides{REST: "https://custom.rest"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if c.Network.Endpoints.REST != "https://custom.rest" {
		t.Errorf("override not applied: %q", c.Network.Endpoints.REST)
	}
	// Non-overridden endpoint keeps its default.
	if c.Network.Endpoints.EVMRPC != "http://localhost:8545" {
		t.Errorf("default lost: %q", c.Network.Endpoints.EVMRPC)
	}
}

func TestUnknownNetwork(t *testing.T) {
	_, err := CreateClient(Options{Network: "nope"})
	if err == nil {
		t.Fatal("expected error for unknown network")
	}
}

func TestFeesEstimateUsesOracle(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"suggested_fee_uqor":"12345"}`))
	}))
	defer srv.Close()
	c, err := CreateClient(Options{
		Endpoints:  EndpointOverrides{REST: srv.URL, EVMRPC: srv.URL},
		HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := c.Fees.Estimate("fast")
	if err != nil {
		t.Fatal(err)
	}
	var fee struct {
		Amount []struct {
			Denom  string `json:"denom"`
			Amount string `json:"amount"`
		} `json:"amount"`
		Gas string `json:"gas"`
	}
	if err := json.Unmarshal(raw, &fee); err != nil {
		t.Fatal(err)
	}
	if len(fee.Amount) != 1 || fee.Amount[0].Amount != "12345" || fee.Amount[0].Denom != "uqor" {
		t.Errorf("fee = %+v", fee)
	}
	if fee.Gas != "200000" {
		t.Errorf("gas = %q", fee.Gas)
	}
}

func TestFeesEstimateFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	c, err := CreateClient(Options{
		Endpoints:  EndpointOverrides{REST: srv.URL, EVMRPC: srv.URL},
		HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := c.Fees.Estimate("")
	if err != nil {
		t.Fatal(err)
	}
	var fee struct {
		Amount []struct {
			Amount string `json:"amount"`
		} `json:"amount"`
		Gas string `json:"gas"`
	}
	if err := json.Unmarshal(raw, &fee); err != nil {
		t.Fatal(err)
	}
	// ceil(200000 * 0.025) = 5000
	if fee.Amount[0].Amount != "5000" {
		t.Errorf("fallback fee = %q, want 5000", fee.Amount[0].Amount)
	}
}

func TestComputeCeilFee(t *testing.T) {
	cases := []struct {
		gas, price, want string
	}{
		{"200000", "0.025", "5000"},
		{"100000", "0.0001", "10"},
		{"1", "0.025", "1"},   // ceil(0.025) = 1
		{"3", "0.025", "1"},   // ceil(0.075) = 1
		{"1000", "1", "1000"}, // no fractional part
	}
	for _, c := range cases {
		got, err := computeCeilFee(c.gas, c.price)
		if err != nil {
			t.Fatal(err)
		}
		if got != c.want {
			t.Errorf("computeCeilFee(%s,%s) = %s, want %s", c.gas, c.price, got, c.want)
		}
	}
}
