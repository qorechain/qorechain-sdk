package query

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseEVMDelegationConsentAsDianaAnswers(t *testing.T) {
	c, err := ParseEVMDelegationConsent([]byte(`{"found":true,"live":true,"delegate":"0x63c0c19a282a1b52b07dd5a65b58948a07dae32b","granted_height":"6905100","expiry_height":"6905700","current_delegate":"","nonce":"7"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !c.Found || !c.Live || c.ExpiryHeight != 6905700 || c.Nonce != 7 {
		t.Fatalf("unexpected %+v", c)
	}
	if c.TupleNonce(true) != 7 || c.TupleNonce(false) != 8 {
		t.Fatal("sponsored tuple carries nonce, own type-4 carries nonce+1")
	}
}

func TestUpgradeDetection(t *testing.T) {
	ClearUpgradeCache()
	calls := 0
	answer := `{"height":"0"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/cosmos/upgrade/v1beta1/applied_plan/v3.2.2" {
			t.Errorf("path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(answer))
	}))
	defer srv.Close()
	c := NewRestClient(srv.URL, srv.Client())

	// Mainnet's answer before the plan: a truthy string that means "no".
	ok, err := c.IsUpgradeApplied(ChainUpgradeV3_2_2)
	if err != nil || ok {
		t.Fatalf("height \"0\" must read as not applied: %v %v", ok, err)
	}
	if err := c.RequireUpgradeApplied(ChainUpgradeV3_2_2, "native_only"); err == nil || !strings.Contains(err.Error(), "native_only needs chain v3.2.2") {
		t.Fatalf("expected a refusal naming the field, got %v", err)
	}

	ClearUpgradeCache()
	answer = `{"height":"6905034"}`
	h, err := c.UpgradeAppliedHeight(ChainUpgradeV3_2_2)
	if err != nil || h != 6905034 {
		t.Fatalf("got %d %v", h, err)
	}
	before := calls
	if ok, _ := c.IsUpgradeApplied(ChainUpgradeV3_2_2); !ok || calls != before {
		t.Fatal("a positive answer must be cached")
	}
}

func TestUpgradeDetectionErrorIsNotNo(t *testing.T) {
	ClearUpgradeCache()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	if _, err := NewRestClient(srv.URL, srv.Client()).IsUpgradeApplied(ChainUpgradeV3_2_2); err == nil {
		t.Fatal("an unreachable node must be an error, never 'not applied'")
	}
}
