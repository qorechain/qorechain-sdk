package evm

import (
	"strings"
	"testing"
)

func TestCheckEVMGasLimit(t *testing.T) {
	if err := CheckEVMGasLimit(30_000_000, 0); err != nil {
		t.Fatalf("cap refused: %v", err)
	}
	if err := CheckEVMGasLimit(30_000_001, 0); err == nil {
		t.Fatal("above default cap accepted")
	}
	if err := CheckEVMGasLimit(20_000_001, 20_000_000); err == nil {
		t.Fatal("above queried cap accepted")
	}
}

func TestEthEstimateGasAboveCap(t *testing.T) {
	srv := mockServer(t, map[string]string{"eth_estimateGas": `"0x1c9c381"`}, nil) // 30,000,001
	defer srv.Close()
	c := NewClient(srv.URL, srv.Client())
	gas, err := c.EthEstimateGas(CallMsg{To: "0x0000000000000000000000000000000000000001"})
	if err == nil || !strings.Contains(err.Error(), "gas cap") || gas != 30_000_001 {
		t.Fatalf("gas %d, err %v", gas, err)
	}
	c.TxMaxGas = 40_000_000
	if _, err := c.EthEstimateGas(CallMsg{To: "0x0000000000000000000000000000000000000001"}); err != nil {
		t.Fatalf("raised cap: %v", err)
	}
}
