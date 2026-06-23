package query

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRestMethodPaths(t *testing.T) {
	cases := []struct {
		name     string
		call     func(c *RestClient) (json.RawMessage, error)
		wantPath string
		wantQ    string
	}{
		{"GetAllBalances", func(c *RestClient) (json.RawMessage, error) { return c.GetAllBalances("qor1abc") }, "/cosmos/bank/v1beta1/balances/qor1abc", ""},
		{"GetAIStats", func(c *RestClient) (json.RawMessage, error) { return c.GetAIStats() }, "/qorechain/ai/v1/stats", ""},
		{"GetFeeEstimate", func(c *RestClient) (json.RawMessage, error) { return c.GetFeeEstimate("fast") }, "/qorechain/ai/v1/fee-estimate", "urgency=fast"},
		{"GetBridgeChains", func(c *RestClient) (json.RawMessage, error) { return c.GetBridgeChains() }, "/qorechain/bridge/v1/chains", ""},
		{"GetPQCAccount", func(c *RestClient) (json.RawMessage, error) { return c.GetPQCAccount("qor1abc") }, "/qorechain/pqc/v1/accounts/qor1abc", ""},
		{"GetReputation", func(c *RestClient) (json.RawMessage, error) { return c.GetReputation("qorvaloper1xyz") }, "/qorechain/reputation/v1/validators/qorvaloper1xyz", ""},
		{"GetBurnStats", func(c *RestClient) (json.RawMessage, error) { return c.GetBurnStats() }, "/qorechain/burn/v1/stats", ""},
		{"GetXQOREPosition", func(c *RestClient) (json.RawMessage, error) { return c.GetXQOREPosition("qor1abc") }, "/qorechain/xqore/v1/position/qor1abc", ""},
		{"GetInflationRate", func(c *RestClient) (json.RawMessage, error) { return c.GetInflationRate() }, "/qorechain/inflation/v1/rate", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var gotPath, gotQ string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotQ = r.URL.RawQuery
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer srv.Close()

			client := NewRestClient(srv.URL, srv.Client())
			res, err := c.call(client)
			if err != nil {
				t.Fatalf("call error: %v", err)
			}
			if gotPath != c.wantPath {
				t.Errorf("path = %q, want %q", gotPath, c.wantPath)
			}
			if gotQ != c.wantQ {
				t.Errorf("query = %q, want %q", gotQ, c.wantQ)
			}
			var parsed map[string]any
			if err := json.Unmarshal(res, &parsed); err != nil {
				t.Errorf("response not parseable: %v", err)
			}
		})
	}
}

func TestRestHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()
	client := NewRestClient(srv.URL, srv.Client())
	_, err := client.GetAIStats()
	if err == nil {
		t.Fatal("expected HTTP error")
	}
	he, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("expected *HTTPError, got %T", err)
	}
	if he.Status != 500 {
		t.Errorf("status = %d", he.Status)
	}
}

// TestQorWireStrings asserts every qor_ method sends its exact wire method
// name. The table is the source of truth for the 25 methods.
func TestQorWireStrings(t *testing.T) {
	cases := []struct {
		name     string
		call     func(c *QorClient) (json.RawMessage, error)
		wantWire string
	}{
		{"GetPQCKeyStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetPQCKeyStatus("a") }, "qor_getPQCKeyStatus"},
		{"GetHybridSignatureMode", func(c *QorClient) (json.RawMessage, error) { return c.GetHybridSignatureMode() }, "qor_getHybridSignatureMode"},
		{"GetAIStats", func(c *QorClient) (json.RawMessage, error) { return c.GetAIStats() }, "qor_getAIStats"},
		{"GetCrossVMMessage", func(c *QorClient) (json.RawMessage, error) { return c.GetCrossVMMessage("m") }, "qor_getCrossVMMessage"},
		{"GetReputationScore", func(c *QorClient) (json.RawMessage, error) { return c.GetReputationScore("v") }, "qor_getReputationScore"},
		{"GetLayerInfo", func(c *QorClient) (json.RawMessage, error) { return c.GetLayerInfo("l") }, "qor_getLayerInfo"},
		{"GetBridgeStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetBridgeStatus("c") }, "qor_getBridgeStatus"},
		{"GetRLAgentStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetRLAgentStatus() }, "qor_getRLAgentStatus"},
		{"GetRLObservation", func(c *QorClient) (json.RawMessage, error) { return c.GetRLObservation() }, "qor_getRLObservation"},
		{"GetRLReward", func(c *QorClient) (json.RawMessage, error) { return c.GetRLReward() }, "qor_getRLReward"},
		{"GetPoolClassification", func(c *QorClient) (json.RawMessage, error) { return c.GetPoolClassification("v") }, "qor_getPoolClassification"},
		{"GetBurnStats", func(c *QorClient) (json.RawMessage, error) { return c.GetBurnStats() }, "qor_getBurnStats"},
		{"GetXQOREPosition", func(c *QorClient) (json.RawMessage, error) { return c.GetXQOREPosition("a") }, "qor_getXQOREPosition"},
		{"GetInflationRate", func(c *QorClient) (json.RawMessage, error) { return c.GetInflationRate() }, "qor_getInflationRate"},
		{"GetTokenomicsOverview", func(c *QorClient) (json.RawMessage, error) { return c.GetTokenomicsOverview() }, "qor_getTokenomicsOverview"},
		{"GetRollupStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetRollupStatus("r") }, "qor_getRollupStatus"},
		{"ListRollups", func(c *QorClient) (json.RawMessage, error) { return c.ListRollups() }, "qor_listRollups"},
		{"GetSettlementBatch", func(c *QorClient) (json.RawMessage, error) { return c.GetSettlementBatch("r", 0) }, "qor_getSettlementBatch"},
		{"SuggestRollupProfile", func(c *QorClient) (json.RawMessage, error) { return c.SuggestRollupProfile("u") }, "qor_suggestRollupProfile"},
		{"GetDABlobStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetDABlobStatus("r", 0) }, "qor_getDABlobStatus"},
		{"GetBTCStakingPosition", func(c *QorClient) (json.RawMessage, error) { return c.GetBTCStakingPosition("a") }, "qor_getBTCStakingPosition"},
		{"GetAbstractAccount", func(c *QorClient) (json.RawMessage, error) { return c.GetAbstractAccount("a") }, "qor_getAbstractAccount"},
		{"GetFairBlockStatus", func(c *QorClient) (json.RawMessage, error) { return c.GetFairBlockStatus() }, "qor_getFairBlockStatus"},
		{"GetGasAbstractionConfig", func(c *QorClient) (json.RawMessage, error) { return c.GetGasAbstractionConfig() }, "qor_getGasAbstractionConfig"},
		{"GetLaneConfiguration", func(c *QorClient) (json.RawMessage, error) { return c.GetLaneConfiguration() }, "qor_getLaneConfiguration"},
	}
	if len(cases) != 25 {
		t.Fatalf("expected 25 qor_ methods, got %d", len(cases))
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var gotMethod string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				var req struct {
					Method string `json:"method"`
				}
				_ = json.Unmarshal(body, &req)
				gotMethod = req.Method
				_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
			}))
			defer srv.Close()
			client := NewQorClient(srv.URL, srv.Client())
			if _, err := c.call(client); err != nil {
				t.Fatalf("call error: %v", err)
			}
			if gotMethod != c.wantWire {
				t.Errorf("wire method = %q, want %q", gotMethod, c.wantWire)
			}
		})
	}
}

func TestQorMethodsTableMatches(t *testing.T) {
	if len(QorMethods) != 25 {
		t.Errorf("QorMethods has %d entries, want 25", len(QorMethods))
	}
}

func TestJSONRPCErrorMapping(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}`))
	}))
	defer srv.Close()
	client := NewJSONRPCClient(srv.URL, srv.Client())
	_, err := client.Call("qor_nope", nil)
	if err == nil {
		t.Fatal("expected JSON-RPC error")
	}
	je, ok := err.(*JSONRPCError)
	if !ok {
		t.Fatalf("expected *JSONRPCError, got %T", err)
	}
	if je.Code != -32601 || je.Message != "method not found" {
		t.Errorf("error = %+v", je)
	}
}

func TestJSONRPCAutoIncrementID(t *testing.T) {
	var ids []int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			ID int `json:"id"`
		}
		_ = json.Unmarshal(body, &req)
		ids = append(ids, req.ID)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":1}`))
	}))
	defer srv.Close()
	client := NewJSONRPCClient(srv.URL, srv.Client())
	_, _ = client.Call("a", nil)
	_, _ = client.Call("b", nil)
	if len(ids) != 2 || ids[0] != 1 || ids[1] != 2 {
		t.Errorf("ids = %v, want [1 2]", ids)
	}
}

func TestJSONRPCResultReturned(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"value":42}}`))
	}))
	defer srv.Close()
	client := NewJSONRPCClient(srv.URL, srv.Client())
	res, err := client.Call("x", []any{"p"})
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Value int `json:"value"`
	}
	if err := json.Unmarshal(res, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Value != 42 {
		t.Errorf("value = %d", parsed.Value)
	}
}
