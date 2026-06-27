package evm

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// rpcRequest is the minimal shape of a JSON-RPC request captured by the mock.
type rpcRequest struct {
	Method string `json:"method"`
	Params []any  `json:"params"`
}

// mockServer records the last request and replies with a fixed result map keyed
// by method name. Each result value is the JSON-RPC `result` member.
func mockServer(t *testing.T, results map[string]string, captured *rpcRequest) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req rpcRequest
		_ = json.Unmarshal(body, &req)
		if captured != nil {
			*captured = req
		}
		res, ok := results[req.Method]
		if !ok {
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"not found"}}`))
			return
		}
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + res + `}`))
	}))
}

// word renders a uint as a 32-byte ABI word hex (no 0x).
func word(n uint64) string {
	b := new(big.Int).SetUint64(n).Bytes()
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return hex.EncodeToString(out)
}

func TestAIRiskScoreEncodingAndDecoding(t *testing.T) {
	var captured rpcRequest
	// Return score=42, level=2.
	ret := `"0x` + word(42) + word(2) + `"`
	srv := mockServer(t, map[string]string{"eth_call": ret}, &captured)
	defer srv.Close()

	c := NewClient(srv.URL, srv.Client())
	score, level, err := c.AIRiskScore([]byte{0xde, 0xad, 0xbe, 0xef})
	if err != nil {
		t.Fatalf("AIRiskScore: %v", err)
	}
	if score.Cmp(big.NewInt(42)) != 0 {
		t.Errorf("score = %s, want 42", score)
	}
	if level != 2 {
		t.Errorf("level = %d, want 2", level)
	}

	// Verify the calldata: selector 68e2a75b + offset(0x20) + length(4) + data
	// right-padded to 32 bytes.
	to, _ := captured.Params[0].(map[string]any)
	data, _ := to["data"].(string)
	wantSel := "0x68e2a75b"
	if !strings.HasPrefix(data, wantSel) {
		t.Fatalf("calldata %q does not start with selector %q", data, wantSel)
	}
	wantData := wantSel +
		word(32) + // offset
		word(4) + // length
		"deadbeef" + strings.Repeat("0", 56) // 4 bytes right-padded to 32
	if data != wantData {
		t.Errorf("calldata =\n  %q\nwant\n  %q", data, wantData)
	}
	if captured.Params[1] != "latest" {
		t.Errorf("block = %v, want latest", captured.Params[1])
	}
}

func TestAIAnomalyCheckEncodingAndDecoding(t *testing.T) {
	var captured rpcRequest
	// Return anomalyScore=7, flagged=true.
	ret := `"0x` + word(7) + word(1) + `"`
	srv := mockServer(t, map[string]string{"eth_call": ret}, &captured)
	defer srv.Close()

	c := NewClient(srv.URL, srv.Client())
	sender := "0x00112233445566778899aabbccddeeff00112233"
	score, flagged, err := c.AIAnomalyCheck(sender, big.NewInt(1000))
	if err != nil {
		t.Fatalf("AIAnomalyCheck: %v", err)
	}
	if score.Cmp(big.NewInt(7)) != 0 {
		t.Errorf("anomalyScore = %s, want 7", score)
	}
	if !flagged {
		t.Error("flagged = false, want true")
	}

	to, _ := captured.Params[0].(map[string]any)
	data, _ := to["data"].(string)
	// selector 53313835 + left-padded address + uint256(1000).
	wantData := "0x53313835" +
		strings.Repeat("0", 24) + "00112233445566778899aabbccddeeff00112233" +
		word(1000)
	if data != wantData {
		t.Errorf("calldata =\n  %q\nwant\n  %q", data, wantData)
	}
}

func TestAIAnomalyCheckAcceptsBech32(t *testing.T) {
	srv := mockServer(t, map[string]string{"eth_call": `"0x` + word(0) + word(0) + `"`}, nil)
	defer srv.Close()
	c := NewClient(srv.URL, srv.Client())
	// A structurally valid qor1 address (20-byte zero payload).
	_, flagged, err := c.AIAnomalyCheck("qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8ghujl", big.NewInt(0))
	if err != nil {
		t.Fatalf("AIAnomalyCheck bech32: %v", err)
	}
	if flagged {
		t.Error("flagged = true, want false")
	}
}

// simulateServer routes eth_call by target precompile address so the risk and
// anomaly calls can return distinct results, and answers eth_estimateGas.
func simulateServer(t *testing.T, gasHex, riskRet, anomalyRet string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req rpcRequest
		_ = json.Unmarshal(body, &req)
		switch req.Method {
		case "eth_estimateGas":
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"` + gasHex + `"}`))
		case "eth_call":
			to, _ := req.Params[0].(map[string]any)
			addr, _ := to["to"].(string)
			ret := riskRet
			if strings.EqualFold(addr, normalizeHexAddr(AIAnomalyCheckAddress)) {
				ret = anomalyRet
			}
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"` + ret + `"}`))
		default:
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"not found"}}`))
		}
	}))
}

func TestSimulateWithRiskScoreSafe(t *testing.T) {
	// gas=0x5208 (21000); risk level=1; anomaly flagged=false → Safe.
	srv := simulateServer(t, "0x5208",
		"0x"+word(10)+word(1), // risk: score=10, level=1
		"0x"+word(5)+word(0),  // anomaly: score=5, flagged=false
	)
	defer srv.Close()
	c := NewClient(srv.URL, srv.Client())
	res, err := c.SimulateWithRiskScore(SimulateTx{
		From: "0x00112233445566778899aabbccddeeff00112233",
		To:   "0x0000000000000000000000000000000000001234",
		Data: []byte{0x01, 0x02},
	})
	if err != nil {
		t.Fatalf("SimulateWithRiskScore: %v", err)
	}
	if res.Gas != 21000 {
		t.Errorf("gas = %d, want 21000", res.Gas)
	}
	if res.Risk.Level != 1 {
		t.Errorf("risk level = %d, want 1", res.Risk.Level)
	}
	if res.Anomaly.Flagged {
		t.Error("flagged = true, want false")
	}
	if !res.Safe {
		t.Error("Safe = false, want true (level<3 && !flagged)")
	}
}

func TestSimulateWithRiskScoreUnsafe(t *testing.T) {
	// risk level=3 → not safe even though not flagged.
	srv := simulateServer(t, "0x5208",
		"0x"+word(99)+word(3), // risk: level=3 (high)
		"0x"+word(0)+word(0),  // anomaly: not flagged
	)
	defer srv.Close()
	c := NewClient(srv.URL, srv.Client())
	res, err := c.SimulateWithRiskScore(SimulateTx{
		From: "0x00112233445566778899aabbccddeeff00112233",
		Data: []byte{0x01},
	})
	if err != nil {
		t.Fatalf("SimulateWithRiskScore: %v", err)
	}
	if res.Safe {
		t.Error("Safe = true, want false (level 3 is high risk)")
	}
}

func TestPrecompileAddressConstants(t *testing.T) {
	if AIRiskScoreAddress != "0x0000000000000000000000000000000000000B01" {
		t.Errorf("AIRiskScoreAddress = %s", AIRiskScoreAddress)
	}
	if AIAnomalyCheckAddress != "0x0000000000000000000000000000000000000B02" {
		t.Errorf("AIAnomalyCheckAddress = %s", AIAnomalyCheckAddress)
	}
}

func TestSelectors(t *testing.T) {
	if got := hex.EncodeToString(selector(aiRiskScoreSignature)); got != "68e2a75b" {
		t.Errorf("aiRiskScore selector = %s, want 68e2a75b", got)
	}
	if got := hex.EncodeToString(selector(aiAnomalyCheckSignature)); got != "53313835" {
		t.Errorf("aiAnomalyCheck selector = %s, want 53313835", got)
	}
}

func TestEthCallError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"precompile not available"}}`))
	}))
	defer srv.Close()
	c := NewClient(srv.URL, srv.Client())
	_, _, err := c.AIRiskScore([]byte{0x01})
	if err == nil {
		t.Fatal("expected error from unavailable precompile")
	}
}
